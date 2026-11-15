"""Backend entry point connecting stored bills, CMS pricing and Gemini review."""
from functionality.cms_pricing import default_pricing
from functionality.gemini import Gemini
from functionality.review import review_bill


def review_stored_bill(store, owner_id: str, bill_id: str, *, context=None,
                       gemini=None, benchmark_provider=None):
    """context: optional PricingContext; defaults to the bill's provider state."""
    bill = store.get_bill(owner_id, bill_id)
    if bill is None:
        raise LookupError('Bill not found')
    report = review_bill(bill.extraction, gemini=gemini if gemini is not None else Gemini(),
                         context=context, benchmark_provider=(
                             benchmark_provider if benchmark_provider is not None else default_pricing()))
    return store.save_review(owner_id, bill_id, report, expected_updated_at=bill.updated_at)
