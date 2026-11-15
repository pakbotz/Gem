"""Deterministic comparison of extracted bill lines against CMS reference prices.

The original filename is retained for callers. Python owns all arithmetic here;
Gemini later judges these candidates (see review.py) but cannot change amounts.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date
from decimal import Decimal
import os
import re
from typing import Callable, Literal
from urllib.parse import urlparse

from pydantic import Field, field_validator
from functionality.models import BillingField, ExtractedDocument, StrictModel

CODE = re.compile(r'(\d{5}|[A-Z]\d{4}|\d{4}[A-Z])((?:-[A-Z0-9]{2})*)')


def overcharge_multiple() -> Decimal:
    """Charges above this multiple of the Medicare rate are disputed as overcharges."""
    return Decimal(os.getenv('GEM_OVERCHARGE_MULTIPLE', '2'))


class PricingContext(StrictModel):
    """Where the service was performed. Unknown state/locality prices nationally."""
    state: str | None = Field(default=None, pattern=r'^[A-Z]{2}$')
    locality: str | None = None
    place_of_service: Literal['facility', 'non-facility'] = 'non-facility'
    qpp: bool = False


class BenchmarkRequest(StrictModel):
    code: str
    modifiers: list[str]
    units: int = Field(gt=0)
    service_date: date
    context: PricingContext


class Benchmark(StrictModel):
    request: BenchmarkRequest
    amount: Decimal = Field(gt=0, max_digits=18, decimal_places=2)
    schedule: Literal['MPFS', 'CLFS']
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
    description: str | None
    service_date: str | None
    units: int
    units_assumed: bool
    billed_amount: str | None
    evidence: dict[str, BillingField]
    benchmark: Benchmark | None = None
    fair_amount: str | None = None
    overcharge_amount: str | None = None
    suspected_duplicate: bool = False
    duplicate_of: int | None = None
    review_reasons: list[str] = Field(default_factory=list)


class BillAudit(StrictModel):
    source_file: str
    source_index: int
    total_extracted_charges: str | None
    charges_complete: bool
    compared_count: int
    unresolved_count: int
    flagged_count: int
    overcharge_multiple: str
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


def _date(field: BillingField) -> date | None:
    value = _trusted(field)
    try:
        return date.fromisoformat(value) if value and re.fullmatch(r'\d{4}-\d{2}-\d{2}', value) else None
    except ValueError:
        return None


def parse_code(field: BillingField) -> tuple[str, list[str]] | None:
    match = CODE.fullmatch(_trusted(field) or '')
    if not match:
        return None
    return match[1], [m for m in match[2].split('-') if m]


def analyze_bill(document: ExtractedDocument | dict, *,
                 context: PricingContext | None = None,
                 benchmark_provider: BenchmarkProvider | None = None) -> BillAudit:
    """Audit ONE source document, preserving 1-based line identities and evidence."""
    doc = ExtractedDocument.model_validate(document)
    context = context or PricingContext()
    multiple = overcharge_multiple()
    non_usd = _trusted(doc.currency) not in (None, 'USD')
    rows, known_amounts, compared = [], [], 0
    first_seen: dict[tuple, int] = {}
    groups: dict[tuple, list[int]] = defaultdict(list)
    for number, item in enumerate(doc.line_items, start=1):
        billed = _amount(item.charged_amount)
        if billed is not None:
            known_amounts.append(billed)
        units_text = _trusted(item.units)
        units = int(units_text) if units_text and units_text.isdigit() and int(units_text) > 0 else 1
        parsed, served = parse_code(item.code), _date(item.service_date)
        row = LineDiscrepancy(line_number=number, code=item.code.value, description=item.description.value,
                              service_date=item.service_date.value, units=units,
                              units_assumed=units_text is None, billed_amount=f'{billed:.2f}' if billed is not None else None,
                              evidence={name: getattr(item, name).model_copy(deep=True) for name in type(item).model_fields})
        if parsed and served:
            key = (item.code.value, served)
            groups[key].append(number)
            if key in first_seen:
                row.suspected_duplicate = True
                row.duplicate_of = first_seen[key]
            else:
                first_seen[key] = number
        if billed is None:
            row.review_reasons.append('No reliable charged amount; not compared.')
        elif billed <= 0:
            row.review_reasons.append('Credit or zero charge; not compared.')
        elif parsed is None or served is None:
            row.review_reasons.append('No reliable CPT/HCPCS code and service date; not compared.')
        elif non_usd:
            row.review_reasons.append('Charges are not in USD; not compared to CMS rates.')
        elif benchmark_provider is None:
            row.review_reasons.append('CMS pricing is not configured for this review.')
        else:
            request = BenchmarkRequest(code=parsed[0], modifiers=parsed[1], units=units,
                                       service_date=served, context=context)
            try:
                benchmark = benchmark_provider(request.model_copy(deep=True))
                if benchmark is not None:
                    benchmark = Benchmark.model_validate(benchmark)
                    if benchmark.request != request:
                        raise ValueError('Benchmark request mismatch')
            except Exception:
                # A pricing adapter failure must not manufacture a rate.
                row.review_reasons.append('CMS lookup failed; not compared.')
            else:
                if benchmark is None:
                    row.review_reasons.append('No Medicare physician fee schedule rate for this code (labs, drugs and facility fees are not covered).')
                else:
                    compared += 1
                    row.benchmark = benchmark
                    fair = (benchmark.amount * multiple).quantize(Decimal('.01'))
                    row.fair_amount = f'{fair:.2f}'
                    if billed > fair:
                        row.overcharge_amount = f'{billed - fair:.2f}'
                        row.review_reasons.append(f'Billed {billed / benchmark.amount:.1f}x the Medicare rate.')
                    if row.units_assumed:
                        row.review_reasons.append('Units not printed; priced as 1 unit.')
        rows.append(row)
    for numbers in groups.values():
        if len(numbers) > 1:
            for n in numbers:
                rows[n - 1].suspected_duplicate = True
                rows[n - 1].review_reasons.append(f'Same code and date as line(s) {", ".join(str(x) for x in numbers if x != n)}.')
    complete = bool(rows) and len(known_amounts) == len(rows)
    return BillAudit(source_file=doc.source_file, source_index=doc.source_index,
                     total_extracted_charges=f'{sum(known_amounts, Decimal("0")):.2f}' if complete else None,
                     charges_complete=complete, compared_count=compared,
                     unresolved_count=len(rows) - compared,
                     flagged_count=sum(bool(r.overcharge_amount or r.suspected_duplicate) for r in rows),
                     overcharge_multiple=f'{multiple}', discrepancies=rows, review_notes=list(doc.review_notes))


# Existing name retained.
audit_bill = analyze_bill
