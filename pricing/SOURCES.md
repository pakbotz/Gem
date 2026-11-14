# Pricing data only

## Consolidated workbook

`outputs/cms-pricing/CMS_Pricing_2026_January.xlsx` consolidates the six CSV
datasets from the CMS archive below. It preserves all 46,625 nonblank records,
text identifiers, numeric pricing inputs and source rows on one worksheet.
Six separately headed, filterable tables distinguish physician RVUs, GPCI,
locality mapping, anesthesia and caps. An opening index links to each table.
Blank fields mean not supplied for that dataset; they are not zero.
Physician RVUs are pricing inputs, not final dollar allowances. The archive
retains the original headings and footnotes, including service-date GPCI floors. It covers the January 2026 release only. CLFS laboratory data is not
included because no verified official laboratory file has been acquired.
The workbook must be explicitly parsed or uploaded by the Gemini integration;
its presence does not automatically make it accessible to the model.

## Downloaded

- File: `downloads/medicare/rvu26a.zip`
- Publisher: CMS
- Release: January 2026, updated December 29, 2025
- Source: https://www.cms.gov/files/zip/rvu26a-updated-12-29-2025.zip
- SHA-256: `91b9bdd5459bc4c19d4f8203410b29a672db37def2e70f01ef627b8b18fc7482`
- Validation: ZIP integrity check passed; contains physician RVUs, GPCI,
  locality mapping, anesthesia conversion factors and OPPS caps.

## California pricing sources — not downloaded

- Medi-Cal FFS rates: https://mcweb.apps.prd.cammis.medi-cal.ca.gov/rates
- Hospital DRG rates/calculator: https://www.dhcs.ca.gov/providers-partners/diagnosis-related-group-hospital-inpatient-payment-methodology/pricing-resources-sfy-2026-27/
- Behavioral health rates: https://www.dhcs.ca.gov/services/mental-health-services-division-default/medi-cal-behavioral-health-fee-schedules-fiscal-year-2026-27/
- Long-term-care rates: https://www.dhcs.ca.gov/services/medi-cal-resources/medi-cal-long-term-care-reimbursement/

California DRG download attempts returned HTML security pages; those files were
deleted. No verified California pricing dataset is present yet.

Only public pricing resources are in scope. Do not submit information, sign in,
or accept agreements to acquire files.
