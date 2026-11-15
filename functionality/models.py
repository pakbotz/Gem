"""Shared extraction contract used by Gemini, comparison and storage."""
from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid')


class PageText(StrictModel):
    page_number: int = Field(ge=1)
    text: str


class BillingField(StrictModel):
    value: str | None
    page_number: int | None = Field(ge=1)
    source_text: str | None
    review_reason: str | None


class LineItem(StrictModel):
    service_date: BillingField
    code: BillingField
    description: BillingField
    charged_amount: BillingField
    adjustments: BillingField
    patient_responsibility: BillingField


class BillingExtraction(StrictModel):
    pages: list[PageText]
    provider_name: BillingField
    total_billed: BillingField
    total_adjustments: BillingField
    patient_responsibility: BillingField
    currency: BillingField
    line_items: list[LineItem]
    review_notes: list[str]


class ExtractedDocument(BillingExtraction):
    source_file: str
    source_index: int


class OCRResponse(StrictModel):
    documents: list[ExtractedDocument]
    requires_review: bool = True


