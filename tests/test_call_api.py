import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image

from functionality.api import app, get_provider, get_store
from functionality.calls import Vapi
from functionality.pipeline import review_stored_bill
from functionality.store_bill import BillStore
from test_review_pipeline import PATIENT, extraction, FakeGemini, FakePhone

# A real PNG so /ocr's byte inspection accepts the upload.
_png = io.BytesIO(); Image.new('RGB', (4, 4), 'white').save(_png, 'PNG'); PNG = _png.getvalue()


class CallAPITests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store = BillStore(Path(self.tmp.name) / 'test.db')
        self.phone = FakePhone()
        self.env = patch.dict(os.environ, {
            'GEM_DEMO_TOKEN': 'a' * 40, 'GEM_DEMO_PHONE_NUMBER': '+12025550123',
        })
        self.env.start()
        self.addCleanup(self.env.stop)
        app.dependency_overrides[get_store] = lambda: self.store
        app.dependency_overrides[get_provider] = lambda: self.phone
        self.addCleanup(app.dependency_overrides.clear)
        self.client = TestClient(app)
        self.headers = {'Authorization': 'Bearer ' + 'a' * 40}

    def reviewed_plan(self):
        saved = self.client.post('/cases', headers=self.headers, json=extraction().model_dump()).json()
        reviewed = review_stored_bill(self.store, 'local-demo', saved['id'], gemini=FakeGemini())
        response = self.client.post(f'/cases/{reviewed.id}/call-plan', headers=self.headers,
                                    json={'patient': PATIENT})
        self.assertEqual(response.status_code, 200)
        return reviewed, response.json()

    def test_requires_demo_authentication(self):
        result = self.client.post('/cases', json=extraction().model_dump())
        self.assertEqual(result.status_code, 401)
        self.assertEqual(self.store.my_bills('local-demo'), [])
        with patch.dict(os.environ, {'GEM_DEMO_TOKEN': ''}):
            # The token is optional for the demo; without one the API is open.
            self.assertEqual(self.client.get('/cases/anything').status_code, 404)

    def test_full_app_flow_over_http(self):
        """Upload -> save -> review -> list -> plan -> call -> outcome, as the app does it."""
        ocr_result = extraction()
        with patch('gem_ocr.extract', return_value=ocr_result):
            uploaded = self.client.post('/ocr', files=[('files', ('bill.png', PNG, 'image/png'))])
        self.assertEqual(uploaded.status_code, 200, uploaded.text)
        case = self.client.post('/cases', headers=self.headers, json=uploaded.json()).json()
        with patch('functionality.pipeline.Gemini', FakeGemini):
            reviewed = self.client.post(f'/cases/{case["id"]}/review', headers=self.headers)
        self.assertEqual(reviewed.status_code, 200, reviewed.text)
        self.assertIsNone(reviewed.json()['call'])
        listed = self.client.get('/cases', headers=self.headers).json()
        self.assertEqual([c['id'] for c in listed], [case['id']])
        plan = self.client.post(f'/cases/{case["id"]}/call-plan', headers=self.headers,
                                json={'patient': PATIENT}).json()
        self.client.post(f'/cases/{case["id"]}/calls', headers=self.headers, json={'plan': plan, 'approved': True})
        with patch('functionality.api.optional_gemini', return_value=FakeGemini()):
            self.client.get(f'/cases/{case["id"]}/calls/{plan["review_id"]}', headers=self.headers)
        resumed = self.client.get(f'/cases/{case["id"]}', headers=self.headers).json()
        self.assertEqual(resumed['call']['outcome']['reference_number'], 'REF-1')
        self.assertEqual(resumed['negotiation']['status'], 'needs_review')

    def test_review_endpoint_uses_backend_review(self):
        result = self.client.post('/cases', headers=self.headers, json=extraction().model_dump())
        self.assertEqual(result.status_code, 201)
        bill_id = result.json()['id']
        def offline_review(store, owner, case_id, context=None):
            self.assertEqual(context.state, 'NY')
            return review_stored_bill(store, owner, case_id, context=context, gemini=FakeGemini())
        with patch('functionality.api.review_stored_bill', side_effect=offline_review):
            reviewed = self.client.post(f'/cases/{bill_id}/review', headers=self.headers, json={'state': 'NY'})
        self.assertEqual(reviewed.status_code, 200)
        self.assertTrue(reviewed.json()['review']['issues'])
        self.assertIn('NY', reviewed.json()['review']['audits'][0]['discrepancies'][0]['benchmark']['description'])

    def test_call_flow_and_duplicate_dispatch(self):
        bill, plan = self.reviewed_plan()
        route = f'/cases/{bill.id}/calls'
        self.assertEqual(self.phone.count, 0)
        denied = self.client.post(route, headers=self.headers, json={'plan': plan, 'approved': False})
        self.assertEqual(denied.status_code, 422)
        response = self.client.post(route, headers=self.headers, json={'plan': plan, 'approved': True})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(self.phone.count, 1)
        self.assertEqual(self.client.post(route, headers=self.headers,
                                         json={'plan': plan, 'approved': True}).status_code, 409)
        with patch('functionality.api.optional_gemini', return_value=FakeGemini()):
            status = self.client.get(f'{route}/{bill.review.id}', headers=self.headers)
        self.assertEqual(status.json()['state'], 'ended')
        self.assertEqual(status.json()['outcome']['reference_number'], 'REF-1')

    def test_calls_hospital_number_outside_test_mode(self):
        with patch.dict(os.environ, {'GEM_DEMO_PHONE_NUMBER': ''}):
            _, plan = self.reviewed_plan()
            self.assertEqual(plan['destination'], '+18005550199')
            saved = self.client.post('/cases', headers=self.headers, json=extraction().model_dump()).json()
            review_stored_bill(self.store, 'local-demo', saved['id'], gemini=FakeGemini())
            override = self.client.post(f'/cases/{saved["id"]}/call-plan', headers=self.headers,
                                        json={'patient': PATIENT, 'hospital_phone': '212-555-0100'})
            self.assertEqual(override.json()['destination'], '+12125550100')

    def test_phone_allowlist_and_plan_tampering(self):
        bill, plan = self.reviewed_plan()
        route = f'/cases/{bill.id}/calls'
        changed = dict(plan, destination='+12025550999')
        self.assertEqual(self.client.post(route, headers=self.headers,
                                         json={'plan': changed, 'approved': True}).status_code, 403)
        changed = dict(plan, script='Agree to pay in full')
        self.assertEqual(self.client.post(route, headers=self.headers,
                                         json={'plan': changed, 'approved': True}).status_code, 409)
        self.assertEqual(self.phone.count, 0)

    def test_saved_vapi_assistant_receives_case_variable(self):
        bill, data = self.reviewed_plan()
        from functionality.calls import CallPlan
        plan = CallPlan.model_validate(data)
        with patch.dict(os.environ, {'VAPI_API_KEY': 'fake', 'VAPI_PHONE_NUMBER_ID': 'vapi-imported-id',
                                    'VAPI_ASSISTANT_ID': 'saved-assistant-id', 'VAPI_VOICE_ID': ''}):
            provider = Vapi()
        with patch.object(provider, '_request', return_value={}) as request:
            provider.create(plan)
        path, payload = request.call_args.args
        self.assertEqual(path, '/call')
        self.assertEqual(payload['assistantId'], 'saved-assistant-id')
        self.assertEqual(payload['phoneNumberId'], 'vapi-imported-id')
        self.assertNotIn('assistant', payload)
        overrides = payload['assistantOverrides']
        self.assertFalse(overrides['artifactPlan']['recordingEnabled'])
        self.assertEqual(overrides['transcriber']['model'], 'nova-3')
        context = json.loads(payload['assistantOverrides']['variableValues']['gem_case_context'])
        self.assertEqual([i['id'] for i in context['issues']], [i.id for i in plan.issues])
        self.assertEqual(context['patient']['account_number'], 'A-1001')
        self.assertEqual(context['script'], plan.script)

    def test_saved_assistant_requires_bill_context_placeholder(self):
        with patch.dict(os.environ, {'VAPI_API_KEY': 'fake', 'VAPI_PHONE_NUMBER_ID': 'vapi-id',
                                    'VAPI_ASSISTANT_ID': 'assistant-id'}):
            provider = Vapi()
        configured = {'model': {'provider': 'google', 'messages': [
            {'role': 'system', 'content': 'Bill evidence: {{gem_case_context}}'}]}}
        with patch.object(provider, '_request', return_value=configured):
            provider.validate_configuration()
        configured['model']['messages'][0]['content'] = 'Old hardcoded demo'
        with patch.object(provider, '_request', return_value=configured):
            with self.assertRaisesRegex(ValueError, 'gem_case_context'):
                provider.validate_configuration()


if __name__ == '__main__':
    unittest.main()
