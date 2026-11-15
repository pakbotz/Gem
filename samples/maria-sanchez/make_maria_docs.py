"""Generate a synthetic, internally consistent bill / MSN / EOB set for Maria Sanchez."""
from decimal import Decimal as D, ROUND_HALF_UP
from pathlib import Path
import sys

from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

OUT = Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)
STAMP = 'SYNTHETIC TEST DATA - NOT A REAL BILL OR GOVERNMENT NOTICE'
c2 = lambda v: v.quantize(D('0.01'), ROUND_HALF_UP)
money = lambda v: f'${v:,.2f}'


def write_pdf(name, lines):
    pdf = canvas.Canvas(str(OUT / name), pagesize=letter)
    pdf.setTitle(name)
    y = 750
    for line in [STAMP, ''] + lines + ['', STAMP]:
        if y < 50:
            pdf.showPage(); y = 750
        pdf.setFont('Courier-Bold' if line.isupper() and line.strip() else 'Courier', 8.5)
        pdf.drawString(36, y, line)
        y -= 12
    pdf.save()


# code, rev, description, billed, medicare_approved (None = not on MSN), msn_note, schedule
# Approved amounts for MPFS codes match Gem's own CMS benchmark (IL); labs use typical CLFS rates.
LINES = [
    ('99215', '0510', 'Office visit, est. patient, high complexity', D('395.00')),
    ('36415', '0300', 'Venipuncture (routine blood draw)', D('45.00')),
    ('80053', '0300', 'Comprehensive metabolic panel', D('220.00')),
    ('82947', '0300', 'Glucose, quantitative, blood', D('65.00')),
    ('84132', '0300', 'Potassium, serum', D('58.00')),
    ('85025', '0305', 'Complete blood count w/ auto diff', D('95.00')),
    ('85025', '0305', 'Complete blood count w/ auto diff', D('95.00')),
    ('71046', '0320', 'Chest X-ray, 2 views', D('310.00')),
    ('93000', '0730', 'Electrocardiogram, complete', D('180.00')),
    ('96372', '0510', 'Therapeutic injection, SC/IM', D('150.00')),
    ('',      '0270', 'Supplies, miscellaneous', D('85.00')),
]
LINE_SUM = sum(l[3] for l in LINES)
PRINTED_TOTAL = LINE_SUM + D('125.00')  # $125 not itemized anywhere
LATE_FEE = D('25.00')

# What the provider actually sent to Medicare (MSN). Note 99214 here vs 99215 on the bill.
# (code, description, charged, approved, mpfs?, note)
MSN = [
    ('99214', 'Office/outpatient visit, established', D('250.00'), D('137.84'), True, 'A'),
    ('36415', 'Routine venipuncture', D('45.00'), D('3.00'), False, 'A'),
    ('80053', 'Comprehensive metabolic panel', D('220.00'), D('10.56'), False, 'A'),
    ('82947', 'Glucose; quantitative, blood', D('65.00'), D('0.00'), False, 'B'),
    ('84132', 'Assay of serum potassium', D('58.00'), D('0.00'), False, 'B'),
    ('85025', 'Complete CBC w/auto diff WBC', D('95.00'), D('7.77'), False, 'A'),
    ('85025', 'Complete CBC w/auto diff WBC', D('95.00'), D('0.00'), False, 'C'),
    ('71046', 'X-ray exam chest 2 views', D('310.00'), D('32.84'), True, 'A'),
    ('93000', 'Electrocardiogram complete', D('180.00'), D('15.69'), True, 'A'),
]
msn_rows = []
for code, desc, charged, approved, mpfs, note in MSN:
    paid = c2(approved * D('0.80')) if mpfs else approved  # Clinical labs: no Part B coinsurance.
    msn_rows.append((code, desc, charged, approved, paid, approved - paid, note))
MEDICARE_PAID = sum(r[4] for r in msn_rows)
MAX_BILL = sum(r[5] for r in msn_rows)
BALANCE = PRINTED_TOTAL + LATE_FEE - MEDICARE_PAID

write_pdf('itemized_bill.pdf', [
    'LAKESIDE FAMILY MEDICINE -- ITEMIZED STATEMENT OF CHARGES (UB-04 detail)',
    '2200 Lakeshore Drive, Springfield, IL 62703      NPI 1234567893',
    'Billing questions: (217) 555-0142   Mon-Fri 8am-5pm',
    '',
    'Patient: SANCHEZ, MARIA          DOB 06/21/1957       Acct 55201938',
    'Statement date 05/02/2025        Date of service 03/12/2025   Office visit',
    'Primary: Medicare Part B         Secondary: Prairie Mutual Medicare Supplement Plan G',
    '',
    'Line Rev   CPT/HCPCS  Date      Units  Description                              Amount',
    '---- ----  ---------  --------  -----  ---------------------------------------  ---------',
    *[f'{i:>4} {rev}  {code or "--":<9}  03/12/25  1      {desc:<39}  {money(amt):>9}'
      for i, (code, rev, desc, amt) in enumerate(LINES, 1)],
    '',
    f'{"TOTAL CHARGES":>83} {money(PRINTED_TOTAL):>10}',
    '',
    'ACCOUNT ACTIVITY',
    f'  04/09/25  Medicare Part B payment                                         -{money(MEDICARE_PAID)}',
    f'  04/30/25  Late payment fee                                                 {money(LATE_FEE)}',
    '  Secondary insurance: no payment received',
    '',
    f'{"PATIENT BALANCE DUE":>83} {money(BALANCE):>10}',
    '',
    'Please pay by 05/30/2025. Unpaid balances may be referred to a collection agency.',
])

write_pdf('msn.pdf', [
    'MEDICARE SUMMARY NOTICE  -  Part B (Medical Insurance)',
    'Sample layout for testing only. Not issued by Medicare or CMS.',
    '',
    'MARIA SANCHEZ                         Medicare Number: XXX-XX-7QX2 (synthetic)',
    '1418 W Maple St                       Notice date: April 11, 2025',
    'Springfield, IL 62704                 Claims processed Mar 15 - Apr 10, 2025',
    '',
    'YOUR DEDUCTIBLE STATUS: You have met your Part B deductible for 2025.',
    '',
    'CLAIM 25-071-44821-01   LAKESIDE FAMILY MEDICINE, (217) 555-0142',
    'Service date 03/12/2025   Provider accepted assignment: YES',
    '',
    'Code   Description                       Approved? Charged    Approved   Medicare   Max you  Note',
    '                                                               amount     paid       may be billed',
    '-----  --------------------------------  --------- ---------- ---------- ---------- -------- ----',
    *[f'{code}  {desc:<32}  {"Yes" if note == "A" else "No":<9} {money(ch):>10} {money(ap):>10} {money(pd):>10} {money(mx):>8}  {note}'
      for code, desc, ch, ap, pd, mx, note in msn_rows],
    '',
    f'TOTALS{"":>36}{money(sum(r[2] for r in msn_rows)):>12} {money(sum(r[3] for r in msn_rows)):>10} '
    f'{money(MEDICARE_PAID):>10} {money(MAX_BILL):>8}',
    '',
    'NOTES FOR CLAIM',
    'A  This provider accepted assignment. You can\'t be billed more than the "Maximum You May Be Billed".',
    'B  This service is included in another service you received the same day (bundled).',
    '   Medicare does not pay for it separately, and you cannot be billed for it.',
    'C  This is a duplicate of a service already processed on this claim. You cannot be billed for it.',
    '',
    'This claim was sent to your supplemental insurer, Prairie Mutual, for possible additional payment.',
])

write_pdf('eob.pdf', [
    'PRAIRIE MUTUAL INSURANCE CO. (fictional) -- EXPLANATION OF BENEFITS',
    'THIS IS NOT A BILL',
    '',
    'Member: MARIA SANCHEZ        Member ID PMX-448190-02     Plan: Medicare Supplement Plan G',
    'Provider: LAKESIDE FAMILY MEDICINE    Patient account 55201938',
    'Claim PM-2025-0418-7731      Received 04/12/2025 (Medicare crossover)   Processed 04/18/2025',
    '',
    'Date      Code   Description                   Billed     Medicare    Medicare   Plan paid  You owe',
    '                                                           approved    paid',
    '--------  -----  ----------------------------  ---------  ----------  ---------  ---------  -------',
    *[f'03/12/25  {code}  {desc[:28]:<28}  {money(ch):>9}  {money(ap):>10}  {money(pd):>9}  {money(mx):>9}  {money(D(0)):>7}'
      for code, desc, ch, ap, pd, mx, note in msn_rows],
    '',
    f'TOTALS{"":>34}{money(sum(r[2] for r in msn_rows)):>11}  {money(sum(r[3] for r in msn_rows)):>10}  '
    f'{money(MEDICARE_PAID):>9}  {money(MAX_BILL):>9}  {money(D(0)):>7}',
    '',
    f'Payment of {money(MAX_BILL)} sent to LAKESIDE FAMILY MEDICINE by EFT #88213407 on 04/18/2025.',
    'Your plan covered your Part B coinsurance for this claim.',
    'AMOUNT YOU OWE THIS PROVIDER: $0.00',
    'Charges Medicare denied as bundled or duplicate (codes 82947, 84132, second 85025) cannot be billed to you.',
    'Services not submitted to Medicare (none received for 96372 or supplies) are not covered by this plan.',
])

print(f'line sum {LINE_SUM}  printed total {PRINTED_TOTAL}  medicare paid {MEDICARE_PAID}  '
      f'max you may be billed {MAX_BILL}  balance billed {BALANCE}')
