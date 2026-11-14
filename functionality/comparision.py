"""Deterministic review of the repository's structured Gemini documents.

The original filename is retained for callers. No Jac runtime or LLM is needed.
CMS pricing is an injected backend adapter, not implemented in this repository.
Never interpret a fee-schedule difference as confirmed overbilling or savings.
"""
from __future__ import annotations

from collections import Counter
from datetime import date
from decimal import Decimal
import re
from typing import Callable, Literal
from urllib.parse import urlparse

from pydantic import Field, field_validator
from functionality.models import BillingField, ExtractedDocument, StrictModel


class PricingContext(StrictModel):
    """Explicit, human-verified context; do not default missing units/site/modifiers."""
    state: str = Field(pattern=r'^[A-Z]{2}$')
    locality: str = Field(min_length=1)
    place_of_service: Literal['facility', 'non-facility']
    units: int = Field(gt=0)
    modifiers: list[str]
    qpp: bool


class BenchmarkRequest(StrictModel):
    code: str
    service_date: date
    context: PricingContext


class Benchmark(StrictModel):
    request: BenchmarkRequest
    amount: Decimal = Field(gt=0, max_digits=18, decimal_places=2)
    schedule: Literal['MPFS', 'CLFS']
    effective_from: date
    effective_to: date
    source_url: str
    release: str = Field(min_length=1)
    description: str

    @field_validator('source_url')
    @classmethod
    def official_source(cls, value: str) -> str:
        url = urlparse(value)
        if url.scheme != 'https' or not (url.hostname == 'cms.gov' or (url.hostname or '').endswith('.cms.gov')):
            raise ValueError('Benchmark must reference an official HTTPS CMS source')
        return value


class LineDiscrepancy(StrictModel):
    line_number: int
    code: str | None
    billed_amount: str | None
    evidence: dict[str, BillingField]
    benchmark: Benchmark | None = None
    benchmark_difference: str | None = None
    suspected_duplicate: bool = False
    review_reasons: list[str] = Field(default_factory=list)
    recommended_questions: list[str] = Field(default_factory=list)


class BillAudit(StrictModel):
    source_file: str
    source_index: int
    total_extracted_charges: str | None
    charges_complete: bool
    compared_count: int
    unresolved_count: int
    flagged_count: int
    discrepancies: list[LineDiscrepancy]
    review_notes: list[str]
    requires_review: bool = True


BenchmarkProvider = Callable[[BenchmarkRequest], Benchmark | None]


def _trusted(field: BillingField) -> str | None:
    return field.value if field.value and not field.review_reason and field.page_number and field.source_text else None


def _amount(field: BillingField) -> Decimal | None:
    value = _trusted(field)
    if value is None or not re.fullmatch(r'-?\d{1,15}\.\d{2}', value):
        return None
    return Decimal(value)


def analyze_bill(document: ExtractedDocument | dict, *,
                 contexts: dict[int, PricingContext] | None = None,
                 benchmark_provider: BenchmarkProvider | None = None) -> BillAudit:
    """Audit ONE source document, preserving 1-based line identities and evidence.

    contexts is keyed by 1-based line number and supplied by trusted backend code
    after human review. A pricing adapter must return a total for the exact units,
    modifiers, locality, site, service date and QPP status requested, or None.
    It must verify schedule applicability and official data before returning a rate.
    Do not expose benchmark_provider or rates as client-controlled API inputs.
    """
    doc = ExtractedDocument.model_validate(document)
    contexts = contexts or {}
    # Missing dates/codes must never collapse into a shared duplicate key.
    def duplicate_key(item):
        code, day = _trusted(item.code), _trusted(item.service_date)
        if not code or not day or not re.fullmatch(r'(?:\d{5}|[A-Z]\d{4}|\d{4}[A-Z])', code):
            return None
        try:
            if date.fromisoformat(day).isoformat() != day:
                return None
        except ValueError:
            return None
        return code, day
    counts = Counter(key for item in doc.line_items if (key := duplicate_key(item)))
    rows = []
    known_amounts = []
    compared = 0
    for number, item in enumerate(doc.line_items, start=1):
        billed = _amount(item.charged_amount)
        if billed is not None:
            known_amounts.append(billed)
        row = LineDiscrepancy(line_number=number, code=item.code.value,
                              billed_amount=f'{billed:.2f}' if billed is not None else None,
                              evidence={name: getattr(item, name).model_copy(deep=True) for name in type(item).model_fields})
        for name, field in row.evidence.items():
            if field.review_reason or _trusted(field) is None:
                row.review_reasons.append(f'{name}: {field.review_reason or "Missing or unsupported extraction; review the original."}')
        key = duplicate_key(item)
        if key and counts[key] > 1:
            row.suspected_duplicate = True
            row.review_reasons.append('Repeated code and service date within this document; separate services, units or modifiers may explain it.')
            row.recommended_questions.append('Do these repeated rows represent separate services or a duplicate charge?')
        context = contexts.get(number)
        if billed is None:
            row.review_reasons.append('No reliable charged amount; no monetary comparison performed.')
        elif billed < 0:
            row.review_reasons.append('Credit/negative charge requires manual review; no benchmark comparison performed.')
        elif key is None:
            row.review_reasons.append('A reliable code and complete service date are required for pricing.')
        elif _trusted(doc.currency) != 'USD':
            row.review_reasons.append('Confirm USD currency before comparing to CMS rates.')
        elif context is None:
            row.review_reasons.append('Confirm locality, site, units, modifiers and QPP status before pricing.')
        elif benchmark_provider is None:
            row.review_reasons.append('CMS pricing is not configured in this repository.')
        else:
            request = BenchmarkRequest(code=key[0], service_date=date.fromisoformat(key[1]), context=context)
            try:
                benchmark = benchmark_provider(request.model_copy(deep=True))
                if benchmark is not None:
                    benchmark = Benchmark.model_validate(benchmark)
                    if benchmark.request != request or not benchmark.effective_from <= request.service_date <= benchmark.effective_to:
                        raise ValueError('Benchmark context/date mismatch')
            except Exception:
                # An external pricing adapter failure must not manufacture a rate.
                row.review_reasons.append('CMS lookup failed or returned an incompatible benchmark; review required.')
            else:
                if benchmark is None:
                    row.review_reasons.append('No supported applicable CMS rate found for this service and context.')
                else:
                    row.benchmark = benchmark
                    row.benchmark_difference = f'{billed - benchmark.amount:.2f}'
                    compared += 1
                    if billed > benchmark.amount:
                        row.review_reasons.append('Charge exceeds the matched CMS reference amount. This is context only, not proof of a billing error or recoverable savings.')
                        row.recommended_questions.append('Which allowed amount and payment rules apply to this service under my coverage?')
        if row.review_reasons and not row.recommended_questions:
            row.recommended_questions.append('Can you confirm the code, service date, units and amounts on this line?')
        rows.append(row)
    complete = bool(rows) and len(known_amounts) == len(rows)
    return BillAudit(source_file=doc.source_file, source_index=doc.source_index,
                     total_extracted_charges=f'{sum(known_amounts, Decimal("0")):.2f}' if complete else None,
                     charges_complete=complete, compared_count=compared,
                     unresolved_count=len(rows) - compared,
                     flagged_count=sum(bool(row.review_reasons) for row in rows),
                     discrepancies=rows, review_notes=list(doc.review_notes))


# Existing name retained; reasoning is deterministic, not an LLM agent.
audit_bill = analyze_bill
