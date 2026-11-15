# Maria Sanchez: synthetic bill, MSN and EOB

Synthetic test data for one office visit on 03/12/2025 at Lakeside Family Medicine
(fictional), account 55201938. Every page is stamped as synthetic. Regenerate with
`python3 samples/maria-sanchez/make_maria_docs.py samples/maria-sanchez` (needs reportlab).

| File | What it is |
|------|-----------|
| `itemized_bill.pdf` | Provider's itemized statement asking the patient for $1,677.58 |
| `msn.pdf` | Medicare Summary Notice for the same claim (Part B, assignment accepted) |
| `eob.pdf` | Supplemental (Medigap Plan G, fictional insurer) EOB: patient owes $0.00 |

The three documents agree with each other: Medicare approved $207.70 and paid $170.42.
The maximum the patient may be billed was $37.28, and the supplemental plan paid that.
The correct patient balance is **$0.00**.

## Planted problems (answer key)

| # | Problem | Where | Needs MSN/EOB to spot? |
|---|---------|-------|------------------------|
| 1 | Duplicate charge: CBC 85025 billed twice ($95) | Bill lines 6-7 | No |
| 2 | Overcharges vs Medicare: chest X-ray $310 (Medicare $32.84), EKG $180 ($15.69), visit $395 ($196.01 for 99215) | Bill lines 1, 8, 9 | No |
| 3 | Unexplained $125: printed total $1,823 vs $1,698 of listed lines | Bill total | No |
| 4 | Upcoding: bill shows 99215 (high complexity, $395); Medicare was billed 99214 ($250) | Bill line 1 vs MSN | Yes |
| 5 | Unbundling: glucose 82947 and potassium 84132 are part of the CMP 80053; Medicare denied them as bundled | Bill lines 4-5 vs MSN note B | Yes (or coding knowledge) |
| 6 | Billing for services never sent to insurance: injection 96372 with no drug, and uncoded "supplies" | Bill lines 10-11 | Yes |
| 7 | Balance billing: provider accepted assignment, so patient max is $37.28, but bill asks $1,677.58 | Bill balance vs MSN | Yes |
| 8 | Unposted payment: supplemental paid $37.28 by EFT on 04/18; bill says no secondary payment | Bill vs EOB | Yes |
| 9 | Unfair late fee: $25 charged before the first payment due date | Bill account activity | No |

Gem's current review checks each document on its own and only prices codes on the
physician fee schedule, so items 1, 2 and 3 are what it can catch today. Lab prices
(36415, 80053, 82947, 84132, 85025) are not priced because the lab fee schedule
(CLFS) returns no rate.
