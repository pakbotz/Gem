"""Single demo server: upload/OCR -> saved case -> CMS/Gemini review -> hospital call.

Run from the repository root:
    python3 -m uvicorn functionality.api:app --env-file .env --host 0.0.0.0 --port 8000
While GEM_DEMO_PHONE_NUMBER is set, every call goes to that test phone instead of the
hospital. GEM_DEMO_TOKEN is optional; when set, requests need `Bearer <token>`.
This is a single-user hackathon demo, not a multi-user auth system.
"""
from __future__ import annotations

from contextlib import contextmanager
import hmac
import importlib.util
import os
from pathlib import Path
import sys
from typing import Annotated, Literal
from urllib.error import HTTPError, URLError

from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import Field

from functionality.calls import (CallAttempt, CallPlan, Patient, get_call_provider, normalize_phone,
                                 place_call, prepare_call, refresh_call)
from functionality.comparision import PricingContext
from functionality.gemini import Gemini, GeminiError
from functionality.models import OCRResponse, StrictModel
from functionality.pipeline import review_stored_bill
from functionality.store_bill import BillStore, BillView


def demo_owner(authorization: Annotated[str | None, Header()] = None) -> str:
    token = os.getenv('GEM_DEMO_TOKEN', '')
    if token and not (authorization and hmac.compare_digest(authorization.encode(), f'Bearer {token}'.encode())):
        raise HTTPException(401, 'A valid demo session token is required.', headers={'WWW-Authenticate': 'Bearer'})
    return 'local-demo'


def get_store() -> BillStore:
    return BillStore()


def get_provider():
    try:
        return get_call_provider()  # CALL_PROVIDER=bland switches from Vapi.
    except ValueError as exc:
        raise HTTPException(503, str(exc)) from None


def test_destination() -> str | None:
    """Test mode: route every call to this phone instead of the hospital."""
    number = os.getenv('GEM_DEMO_PHONE_NUMBER', '')
    if not number:
        return None
    normalized = normalize_phone(number)  # Accepts 5551234567, (555) 123-4567 or +15551234567.
    if normalized is None:
        raise HTTPException(503, 'GEM_DEMO_PHONE_NUMBER is not a valid phone number; unset it to call hospitals.')
    return normalized


def optional_gemini() -> Gemini | None:
    try:
        return Gemini()
    except GeminiError:
        return None


@contextmanager
def api_errors():
    try:
        yield
    except LookupError:
        raise HTTPException(404, 'Case or call not found.') from None
    except GeminiError as exc:
        raise HTTPException(502, str(exc)) from None
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from None
    except RuntimeError as exc:
        raise HTTPException(502, str(exc)) from None
    except (HTTPError, URLError, TimeoutError):
        raise HTTPException(502, 'Could not reach the call provider. Check its credentials and configuration, or retry the status check.') from None


Owner = Annotated[str, Depends(demo_owner)]
Store = Annotated[BillStore, Depends(get_store)]
Provider = Annotated[object, Depends(get_provider)]
router = APIRouter(prefix='/cases', tags=['Cases'])


class CaseView(BillView):
    """A case plus the call attempt for its current review, so the app can resume."""
    call: CallAttempt | None = None


class ReviewOptions(StrictModel):
    state: str | None = Field(default=None, pattern=r'^[A-Z]{2}$')


class CallRequest(StrictModel):
    patient: Patient
    hospital_phone: str | None = None


class ApprovedCall(StrictModel):
    plan: CallPlan
    approved: Literal[True]


def case_view(store: BillStore, owner: str, bill: BillView) -> CaseView:
    payload = store.get_call(owner, bill.id, bill.review.id) if bill.review else None
    return CaseView(**bill.model_dump(), call=CallAttempt.model_validate_json(payload) if payload else None)


@router.post('', response_model=CaseView, status_code=201)
def save_case(extraction: OCRResponse, owner: Owner, store: Store):
    with api_errors():
        return case_view(store, owner, store.save_extracted_bills(owner, extraction))


@router.get('', response_model=list[CaseView])
def list_cases(owner: Owner, store: Store):
    return [case_view(store, owner, bill) for bill in store.my_bills(owner, limit=100)]


@router.get('/{bill_id}', response_model=CaseView)
def get_case(bill_id: str, owner: Owner, store: Store):
    bill = store.get_bill(owner, bill_id)
    if bill is None:
        raise HTTPException(404, 'Case not found.')
    return case_view(store, owner, bill)


@router.post('/{bill_id}/review', response_model=CaseView)
def review_case(bill_id: str, owner: Owner, store: Store, options: ReviewOptions | None = None):
    # Clients may pick the state for Medicare locality pricing, never prices or rates.
    context = PricingContext(state=options.state) if options and options.state else None
    with api_errors():
        return case_view(store, owner, review_stored_bill(store, owner, bill_id, context=context))


@router.post('/{bill_id}/call-plan', response_model=CallPlan)
def call_plan(bill_id: str, body: CallRequest, owner: Owner, store: Store):
    bill = store.get_bill(owner, bill_id)
    if bill is None or bill.review is None:
        raise HTTPException(404, 'Review the case before preparing a call.')
    destination = test_destination() or normalize_phone(body.hospital_phone or bill.review.hospital.phone)
    if destination is None:
        raise HTTPException(422, 'Enter the hospital billing phone number printed on the bill.')
    with api_errors():
        return prepare_call(store, owner, bill_id, destination, body.patient)


@router.post('/{bill_id}/calls', response_model=CallAttempt, status_code=201)
def start_call(bill_id: str, body: ApprovedCall, owner: Owner, store: Store, provider: Provider):
    if body.plan.bill_id != bill_id:
        raise HTTPException(409, 'Call plan does not match this case.')
    test = test_destination()
    if test and body.plan.destination != test:
        raise HTTPException(403, 'Test mode only calls GEM_DEMO_PHONE_NUMBER.')
    with api_errors():
        return place_call(store, owner, body.plan, approved=body.approved, provider=provider)


@router.get('/{bill_id}/calls/{review_id}', response_model=CallAttempt)
def call_status(bill_id: str, review_id: str, owner: Owner, store: Store, provider: Provider):
    with api_errors():
        return refresh_call(store, owner, bill_id, review_id, provider=provider, gemini=optional_gemini())


def _load_ocr():
    """Serve the existing extraction route (document extraction/ocr.py) from this app."""
    path = Path(__file__).resolve().parents[1] / 'document extraction' / 'ocr.py'
    spec = importlib.util.spec_from_file_location('gem_ocr', path)
    module = importlib.util.module_from_spec(spec)
    sys.modules['gem_ocr'] = module
    spec.loader.exec_module(module)
    return module


app = FastAPI(title='Gem demo server')
origins = [x.strip() for x in os.getenv('ALLOWED_ORIGINS', '*').split(',') if x.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins,
                   allow_methods=['GET', 'POST'], allow_headers=['Authorization', 'Content-Type'])
app.include_router(router)
app.add_api_route('/ocr', _load_ocr().ocr, methods=['POST'], response_model=OCRResponse, tags=['Extraction'])


@app.get('/health')
def health():
    """Shows which integrations are configured, without revealing any values."""
    names = ['GEMINI_API_KEY', 'BLAND_API_KEY', 'VAPI_API_KEY', 'VAPI_PHONE_NUMBER_ID', 'VAPI_ASSISTANT_ID', 'VAPI_VOICE_ID']
    return {'ok': True, 'call_provider': os.getenv('CALL_PROVIDER', 'vapi'), 'configured': {n: bool(os.getenv(n)) for n in names},
            'test_phone_mode': bool(os.getenv('GEM_DEMO_PHONE_NUMBER'))}
