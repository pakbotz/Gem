import tempfile
import unittest
from datetime import date
from decimal import Decimal
from pathlib import Path
from uuid import uuid4
import io
import json
from unittest.mock import patch

from functionality.calls import Bland, CallOutcome, IssueResult, Vapi, normalize_phone, place_call, prepare_call, refresh_call
from functionality.gemini import Gemini, GeminiError
from functionality.cms_pricing import CMSPricing
from functionality.comparision import BenchmarkRequest, PricingContext
from functionality.models import BillingField, ExtractedDocument, LineItem, OCRResponse, PageText
from functionality.pipeline import review_stored_bill
from functionality.review import Assessment, AssessmentResponse, OtherConcern, SummaryResponse
from functionality.store_bill import BillStore

PATIENT = {'name': 'Pat Synthetic', 'account_number': 'A-1001'}


def field(value):
    return BillingField(value=value, page_number=1, source_text=value, review_reason=None)


def missing():
    return BillingField(value=None, page_number=None, source_text=None, review_reason='Missing')


def line(code, amount, description='Office visit', units='1'):
    return LineItem(service_date=field('2026-01-12'), code=field(code), description=field(description),
                    units=field(units) if units else missing(), charged_amount=field(amount),
                    adjustments=missing(), patient_responsibility=missing())


def extraction():
    # 99213 twice (duplicate), a chest x-ray far above Medicare, a lab with no MPFS rate.
    return OCRResponse(documents=[ExtractedDocument(
        source_file='synthetic.pdf', source_index=1, pages=[PageText(page_number=1, text='Synthetic')],
        provider_name=field('Synthetic Hospital'), provider_phone=field('(800) 555-0199'),
        provider_state=field('CA'), patient_name=field('Pat Synthetic'), account_number=field('A-1001'),
        total_billed=field('1180.00'), total_adjustments=missing(), patient_responsibility=missing(),
        currency=missing(),
        line_items=[line('99213', '250.00'), line('99213', '250.00'),
                    line('71046', '600.00', 'Chest x-ray 2 views'), line('85025', '80.00', 'CBC')],
        review_notes=[],
    )])


class FakeGemini:
    model = 'fake-offline'

    def generate(self, instruction, data, schema):
        if schema is AssessmentResponse:
            return AssessmentResponse(assessments=[Assessment(
                finding_id=c['id'], dispute=True, explanation='Potential issue.', ask='Please remove or reduce this.')
                for c in data['candidates']], other_concerns=[])
        if schema is SummaryResponse:
            return SummaryResponse(summary=f'Disputing USD {data["total_disputed"]}.', call_script='1. Confirm billing.')
        if schema is CallOutcome:
            return CallOutcome(summary='Duplicate removed.', reference_number='REF-1', representative='Sam',
                               next_steps=['Wait for corrected bill'], issue_results=[
                                   IssueResult(issue_id=i['id'], result='under_review', note='') for i in data['issues']])
        raise AssertionError(schema)


class FakePhone:
    def __init__(self):
        self.count = 0
        self.id = str(uuid4())

    def create(self, plan):
        self.count += 1
        return {'id': self.id, 'status': 'queued'}

    def get(self, call_id):
        return {'id': call_id, 'status': 'ended', 'endedReason': 'customer-ended-call',
                'artifact': {'transcript': 'AI: I am disputing a duplicate. User: We will remove it. Reference REF-1.'}}


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store = BillStore(Path(self.tmp.name) / 'bills.db')
        self.bill = self.store.save_extracted_bills('alice', extraction())
        self.cms = CMSPricing()

    def review(self, gemini=None):
        return review_stored_bill(self.store, 'alice', self.bill.id,
                                  gemini=gemini or FakeGemini(), benchmark_provider=self.cms)

    def plan(self, bill):
        return prepare_call(self.store, 'alice', bill.id, '+18005550199', PATIENT)

    def test_pricing_real_archive(self):
        context = PricingContext(state='CA', locality='05')
        req = BenchmarkRequest(code='99213', modifiers=[], units=1, service_date=date(2026, 1, 12), context=context)
        benchmark = self.cms(req)
        expected = ((Decimal('1.30') * Decimal('1.095') + Decimal('1.46') * Decimal('1.410')
                     + Decimal('.09') * Decimal('.425')) * Decimal('33.4009')).quantize(Decimal('.01'))
        self.assertEqual(benchmark.amount, expected)
        doubled = self.cms(req.model_copy(update={'units': 2})).amount
        self.assertLessEqual(abs(doubled - expected * 2), Decimal('.01'))
        # Non-office codes are priced now; -26 has its own lower row; labs are not in the MPFS.
        xray = self.cms(req.model_copy(update={'code': '71046'}))
        prof = self.cms(req.model_copy(update={'code': '71046', 'modifiers': ['26']}))
        self.assertGreater(xray.amount, prof.amount)
        self.assertIsNone(self.cms(req.model_copy(update={'code': '85025'})))
        national = self.cms(req.model_copy(update={'context': PricingContext()}))
        self.assertIn('national', national.description)
        qp = self.cms(req.model_copy(update={'context': context.model_copy(update={'qpp': True})}))
        self.assertGreater(qp.amount, benchmark.amount)

    def test_review_finds_duplicates_and_overcharges(self):
        bill = self.review()
        kinds = {i.kind: i for i in bill.review.issues}
        self.assertEqual(set(kinds), {'duplicate_charge', 'overcharge'})
        self.assertEqual(kinds['duplicate_charge'].line_numbers, [1, 2])
        self.assertEqual(kinds['duplicate_charge'].disputed_amount, '250.00')
        overcharges = [i for i in bill.review.issues if i.kind == 'overcharge']
        # Line 2 is disputed in full as a duplicate, so it is not also an overcharge.
        self.assertEqual(sorted(i.line_numbers[0] for i in overcharges), [1, 3])
        total = sum(Decimal(i.disputed_amount) for i in bill.review.issues)
        self.assertEqual(bill.review.total_disputed, f'{total:.2f}')
        self.assertEqual(bill.review.hospital.phone, '(800) 555-0199')
        self.assertEqual(self.store.get_bill('alice', bill.id), bill)
        self.assertIsNone(self.store.get_bill('bob', bill.id))

    def test_gemini_can_dismiss_and_add_concerns(self):
        class Picky(FakeGemini):
            def generate(self, instruction, data, schema):
                if schema is AssessmentResponse:
                    return AssessmentResponse(assessments=[Assessment(
                        finding_id=c['id'], dispute=c['kind'] != 'duplicate_charge',
                        explanation='x', ask='y') for c in data['candidates']],
                        other_concerns=[OtherConcern(source_index=1, line_numbers=[4], explanation='Unbundled', ask='Explain')])
                return super().generate(instruction, data, schema)
        bill = self.review(Picky())
        self.assertNotIn('duplicate_charge', {i.kind for i in bill.review.issues})
        self.assertEqual(len(bill.review.not_disputed), 1)
        other = [i for i in bill.review.issues if i.kind == 'other_concern']
        self.assertEqual(other[0].line_numbers, [4])
        self.assertIsNone(other[0].disputed_amount)

    def test_fabricated_finding_or_line_is_rejected(self):
        class BadIds(FakeGemini):
            def generate(self, instruction, data, schema):
                return AssessmentResponse(assessments=[Assessment(
                    finding_id='invented', dispute=True, explanation='x', ask='y')], other_concerns=[])
        class BadLine(FakeGemini):
            def generate(self, instruction, data, schema):
                result = super().generate(instruction, data, schema)
                if schema is AssessmentResponse:
                    result.other_concerns = [OtherConcern(source_index=1, line_numbers=[99], explanation='x', ask='y')]
                return result
        for gemini in (BadIds(), BadLine()):
            with self.assertRaises(ValueError):
                self.review(gemini)
        self.assertIsNone(self.store.get_bill('alice', self.bill.id).review)

    def test_call_dispute_flow_and_outcome(self):
        bill = self.review()
        plan = self.plan(bill)
        self.assertEqual(plan.issues, bill.review.issues)
        self.assertIn('Pat Synthetic', plan.opening)
        phone = FakePhone()
        with self.assertRaises(ValueError):
            place_call(self.store, 'alice', plan, approved=False, provider=phone)
        with self.assertRaises(LookupError):
            place_call(self.store, 'bob', plan, approved=True, provider=phone)
        attempt = place_call(self.store, 'alice', plan, approved=True, provider=phone)
        self.assertEqual(attempt.state, 'submitted')
        with self.assertRaises(ValueError):
            place_call(self.store, 'alice', plan, approved=True, provider=phone)
        self.assertEqual(phone.count, 1)
        refreshed = refresh_call(self.store, 'alice', bill.id, bill.review.id, provider=phone, gemini=FakeGemini())
        self.assertEqual(refreshed.state, 'ended')
        self.assertIn('REF-1', refreshed.transcript)
        self.assertEqual(refreshed.outcome.reference_number, 'REF-1')
        self.assertEqual(self.store.get_bill('alice', bill.id).negotiation.status, 'needs_review')
        self.assertIsNone(self.store.get_call('bob', bill.id, bill.review.id))

    def test_timeout_retains_claim(self):
        bill = self.review()
        plan = self.plan(bill)
        class TimeoutPhone(FakePhone):
            def create(self, plan):
                raise TimeoutError()
        with self.assertRaises(RuntimeError):
            place_call(self.store, 'alice', plan, approved=True, provider=TimeoutPhone())
        with self.assertRaises(ValueError):
            place_call(self.store, 'alice', plan, approved=True, provider=FakePhone())
        self.assertIn('unknown', self.store.get_call('alice', bill.id, bill.review.id))

    def test_stale_plan_and_report_updates(self):
        bill = self.review()
        plan = self.plan(bill)
        self.review()
        with self.assertRaises(ValueError):
            place_call(self.store, 'alice', plan, approved=True, provider=FakePhone())
        with self.assertRaises(ValueError):
            self.store.save_review('alice', bill.id, bill.review, expected_updated_at=bill.updated_at)

    def test_voice_payload_carries_dispute(self):
        bill = self.review()
        plan = self.plan(bill)
        with patch.dict('os.environ', {'VAPI_API_KEY': 'fake', 'VAPI_PHONE_NUMBER_ID': 'fake',
                                      'VAPI_VOICE_ID': 'fake', 'VAPI_GEMINI_MODEL': 'test-model'}):
            provider = Vapi()
        with patch.object(provider, '_request', return_value={'id': str(uuid4())}) as request:
            provider.create(plan)
        path, payload = request.call_args.args
        self.assertEqual(path, '/call')
        self.assertEqual(payload['customer']['number'], '+18005550199')
        self.assertEqual(payload['assistant']['model']['provider'], 'google')
        self.assertFalse(payload['assistant']['artifactPlan']['recordingEnabled'])
        self.assertEqual(payload['assistant']['transcriber']['provider'], 'deepgram')
        prompt = payload['assistant']['model']['messages'][0]['content']
        self.assertIn('71046', prompt)
        self.assertIn('A-1001', prompt)
        self.assertIn('Never make a payment', prompt)
        self.assertIn('Medicare Physician Fee Schedule', prompt)
        self.assertIn('Just to confirm', prompt)
        self.assertNotIn('fallback_amount', prompt)

    def test_bland_payload_and_status(self):
        bill = self.review()
        plan = self.plan(bill)
        self.assertEqual(plan.opening, 'Hi, this is Gem. I am calling on behalf of Pat Synthetic, for bill number '
                                       'A dash 1 0 0 1, to dispute the following charges.')
        with patch.dict('os.environ', {'BLAND_API_KEY': 'fake'}):
            provider = Bland()
        call_id = str(uuid4())
        with patch.object(provider, '_request', return_value={'status': 'success', 'call_id': call_id}) as request:
            self.assertEqual(provider.create(plan), {'id': call_id, 'status': 'queued'})
        path, payload = request.call_args.args
        self.assertEqual(path, '/calls')
        self.assertEqual(payload['phone_number'], '+18005550199')
        self.assertEqual(payload['first_sentence'], plan.opening)
        self.assertEqual((payload['model'], payload['interruption_threshold']), ('turbo', 150))
        self.assertEqual(payload['interruptibility'], 1)
        self.assertTrue(payload['noise_cancellation'])
        self.assertIn('Never end the call because of silence', payload['task'])
        self.assertIn('when the corrected bill will be sent', payload['task'])
        self.assertFalse(payload['record'])
        self.assertIn('71046', payload['task'])
        self.assertIn('Medicare Physician Fee Schedule', payload['task'])
        self.assertEqual(payload['task'].count('Never make a payment'), 1)  # Rules are not sent twice.
        with patch.object(provider, '_request', return_value={
                'call_id': call_id, 'completed': True, 'queue_status': 'complete', 'status': 'completed',
                'concatenated_transcript': 'assistant: hi'}):
            self.assertEqual(provider.get(call_id)['status'], 'ended')
        with patch.object(provider, '_request', return_value={'status': 'error', 'message': 'bad number'}):
            with self.assertRaisesRegex(RuntimeError, 'bad number'):
                provider.create(plan)

    def test_phone_normalization(self):
        self.assertEqual(normalize_phone('(800) 555-0199'), '+18005550199')
        self.assertEqual(normalize_phone('1-800-555-0199'), '+18005550199')
        self.assertIsNone(normalize_phone('555-0199'))

    def test_gemini_rest_contract_and_truncated_response(self):
        with patch.dict('os.environ', {'GEMINI_API_KEY': 'fake', 'GEMINI_REVIEW_MODEL': 'test-model'}):
            gemini = Gemini()
        body = {'candidates': [{'finishReason': 'STOP', 'content': {'parts': [
            {'text': '{"assessments": [], "other_concerns": []}'}]}}]}
        with patch('functionality.gemini.urlopen', return_value=io.BytesIO(json.dumps(body).encode())) as request:
            result = gemini.generate('instructions', {'synthetic': True}, AssessmentResponse)
        self.assertEqual(result.assessments, [])
        payload = json.loads(request.call_args.args[0].data)
        self.assertIn('responseJsonSchema', payload['generationConfig'])
        self.assertNotIn('fake', request.call_args.args[0].full_url)
        body['candidates'][0]['finishReason'] = 'MAX_TOKENS'
        with patch('functionality.gemini.urlopen', return_value=io.BytesIO(json.dumps(body).encode())):
            with self.assertRaises(GeminiError):
                gemini.generate('instructions', {}, AssessmentResponse)


if __name__ == '__main__':
    unittest.main()
