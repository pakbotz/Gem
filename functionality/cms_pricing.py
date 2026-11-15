"""Medicare Physician Fee Schedule reference prices from the checked-in CMS archive.

Covers every separately priced MPFS code (status A, R or T) in the January 2026
release, including -26/-TC rows. Labs (CLFS), drugs, DRGs and hospital facility
fees are not in this archive and receive no reference price.
"""
from __future__ import annotations

import csv
import hashlib
import io
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from functools import lru_cache
from pathlib import Path
import zipfile

from functionality.comparision import Benchmark, BenchmarkRequest

SOURCE = 'https://www.cms.gov/files/zip/rvu26a-updated-12-29-2025.zip'
SHA256 = '91b9bdd5459bc4c19d4f8203410b29a672db37def2e70f01ef627b8b18fc7482'
ARCHIVE = Path(__file__).resolve().parents[1] / 'pricing/downloads/medicare/rvu26a.zip'
RELEASE = 'CMS MPFS RVU26A (January 2026, released 2025-12-29)'
PRICED_STATUS = {'A', 'R', 'T'}
# Modifiers with their own RVU rows. Others (25, 59, LT, RT, ...) price as the base
# code; ignoring multiple-procedure/bilateral reductions keeps the reference high.
PRICED_MODIFIERS = {'26', 'TC', '53'}


class CMSPricing:
    def __init__(self, archive: str | Path = ARCHIVE):
        content = Path(archive).read_bytes()
        if hashlib.sha256(content).hexdigest() != SHA256:
            raise ValueError('CMS archive checksum mismatch')
        with zipfile.ZipFile(io.BytesIO(content)) as z:
            def rows(name):
                return list(csv.reader(io.StringIO(z.read(name).decode('cp1252'))))
            self.rvus = {
                qpp: {(r[0], r[1]): r for r in rows(f'PPRRVU2026_Jan_{suffix}.csv')
                      if len(r) == 32 and r[3] in PRICED_STATUS}
                for qpp, suffix in [(False, 'nonQPP'), (True, 'QPP')]
            }
            self.gpcis = {}
            for r in rows('GPCI2026.csv'):
                if len(r) == 8 and len(r[0]) == 5 and r[0].isdigit():
                    self.gpcis.setdefault(r[1], []).append(r)

    def _gpci(self, state: str | None, locality: str | None):
        """Return (work, pe, mp) GPCIs and a label: the locality, else state average, else national."""
        candidates = self.gpcis.get(state or '', [])
        if locality and any(g[2] == locality for g in candidates):
            candidates = [g for g in candidates if g[2] == locality]
        if len(candidates) == 1:
            g = candidates[0]
            return (Decimal(g[5]), Decimal(g[6]), Decimal(g[7])), f'{g[1]} locality {g[2]} ({g[3].strip()})'
        if candidates:
            n = Decimal(len(candidates))
            return tuple(sum(Decimal(g[i]) for g in candidates) / n for i in (5, 6, 7)), \
                f'{state} average of {len(candidates)} localities'
        return (Decimal(1), Decimal(1), Decimal(1)), 'national average'

    def __call__(self, request: BenchmarkRequest) -> Benchmark | None:
        c = request.context
        table = self.rvus[c.qpp]
        modifier = next((m for m in request.modifiers if m in PRICED_MODIFIERS), '')
        r = table.get((request.code, modifier)) or table.get((request.code, ''))
        if r is None:
            return None
        facility = c.place_of_service == 'facility' or r[7].strip() == 'NA'
        pe = Decimal(r[8] if facility else r[6])
        (pw, pe_g, mp), where = self._gpci(c.state, c.locality)
        per_unit = (Decimal(r[5]) * pw + pe * pe_g + Decimal(r[10]) * mp) * Decimal(r[25])
        amount = (per_unit * request.units).quantize(Decimal('.01'), rounding=ROUND_HALF_UP)
        if amount <= 0:
            return None
        notes = [f'{r[2].strip()}', f'{"facility" if facility else "non-facility"} rate', where,
                 f'{request.units} unit(s)']
        if r[1]:
            notes.append(f'modifier {r[1]}')
        if not date(2026, 1, 1) <= request.service_date <= date(2026, 12, 31):
            notes.append('2026 rates used as a reference for a service outside 2026')
        return Benchmark(request=request, amount=amount, schedule='MPFS', source_url=SOURCE,
                         release=RELEASE, description='; '.join(notes))


@lru_cache(maxsize=1)
def default_pricing() -> CMSPricing:
    return CMSPricing()
