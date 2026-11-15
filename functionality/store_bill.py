"""SQLite persistence for the exact /ocr response, without Jac or row merging.

One case per save, preserving every source document, field and line in order.
Owner IDs MUST come from authenticated server context, never an untrusted body.
No HTTP routes are exposed here; authentication is not implemented in this repo.
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
import os
from pathlib import Path
import sqlite3
from typing import Literal
from uuid import uuid4

from pydantic import Field
from functionality.comparision import BillAudit, analyze_bill
from functionality.models import OCRResponse, StrictModel


class NegotiationResult(StrictModel):
    status: Literal['not_started', 'pending', 'needs_review', 'resolved', 'closed'] = 'not_started'
    summary: str = ''
    negotiated_amount: str | None = Field(default=None, pattern=r'^\d{1,15}\.\d{2}$')
    verified: bool = False


class BillView(StrictModel):
    id: str
    created_at: str
    updated_at: str
    extraction: OCRResponse
    audits: list[BillAudit]
    negotiation: NegotiationResult = Field(default_factory=NegotiationResult)


class BillStore:
    def __init__(self, db_path: str | Path | None = None):
        self.path = Path(db_path or os.getenv('BILL_DB_PATH', 'data/bills.sqlite3')).expanduser()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.execute('''CREATE TABLE IF NOT EXISTS bills (
                id TEXT PRIMARY KEY, owner_id TEXT NOT NULL,
                created_at TEXT NOT NULL, payload TEXT NOT NULL
            )''')
            connection.execute('CREATE INDEX IF NOT EXISTS bills_owner_created ON bills(owner_id, created_at)')

    @contextmanager
    def _connect(self):
        connection = sqlite3.connect(self.path, timeout=10)
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    @staticmethod
    def _owner(owner_id: str):
        if not isinstance(owner_id, str) or not owner_id.strip():
            raise ValueError('An authenticated owner_id is required')

    def save_extracted_bills(self, owner_id: str, extraction: OCRResponse | dict,
                             audits: list[BillAudit] | None = None) -> BillView:
        """Create a fresh case. Never deduplicate or sum across bill/EOB/MSN copies."""
        self._owner(owner_id)
        result = OCRResponse.model_validate(extraction).model_copy(deep=True)
        if not result.documents:
            raise ValueError('At least one extracted document is required')
        indices = [doc.source_index for doc in result.documents]
        if len(set(indices)) != len(indices) or any(i < 1 for i in indices):
            raise ValueError('Source indices must be unique positive upload indices')
        result.requires_review = True
        if audits is None:
            validated_audits = [analyze_bill(doc) for doc in result.documents]
        else:
            validated_audits = [BillAudit.model_validate(audit).model_copy(deep=True) for audit in audits]
            if len(validated_audits) != len(result.documents):
                raise ValueError('Supply exactly one audit per document, in source order')
            for doc, audit in zip(result.documents, validated_audits):
                if (audit.source_index, audit.source_file) != (doc.source_index, doc.source_file):
                    raise ValueError('Audit source does not match document')
                if len(audit.discrepancies) != len(doc.line_items):
                    raise ValueError('Audit must preserve every original line')
                for index, (item, row) in enumerate(zip(doc.line_items, audit.discrepancies), start=1):
                    evidence = {name: getattr(item, name) for name in type(item).model_fields}
                    if row.line_number != index or row.evidence != evidence:
                        raise ValueError('Audit line evidence does not match extraction')
        now = datetime.now(timezone.utc).isoformat()
        bill = BillView(id=str(uuid4()), created_at=now, updated_at=now,
                        extraction=result, audits=validated_audits)
        with self._connect() as connection:
            connection.execute('INSERT INTO bills(id, owner_id, created_at, payload) VALUES (?, ?, ?, ?)',
                               (bill.id, owner_id, now, bill.model_dump_json()))
        return bill

    def my_bills(self, owner_id: str, *, limit: int = 50, offset: int = 0) -> list[BillView]:
        self._owner(owner_id)
        if not 1 <= limit <= 100 or offset < 0:
            raise ValueError('Limit must be 1–100 and offset nonnegative')
        with self._connect() as connection:
            rows = connection.execute('SELECT payload FROM bills WHERE owner_id = ? '
                                      'ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?',
                                      (owner_id, limit, offset)).fetchall()
        return [BillView.model_validate_json(row[0]) for row in rows]

    def get_bill(self, owner_id: str, bill_id: str) -> BillView | None:
        self._owner(owner_id)
        with self._connect() as connection:
            row = connection.execute('SELECT payload FROM bills WHERE owner_id = ? AND id = ?',
                                     (owner_id, bill_id)).fetchone()
        return BillView.model_validate_json(row[0]) if row else None

    def save_negotiation_result(self, owner_id: str, bill_id: str,
                                result: NegotiationResult | dict) -> BillView | None:
        """Persist an overseen outcome; resolved requires explicit human verification."""
        self._owner(owner_id)
        outcome = NegotiationResult.model_validate(result)
        if outcome.status == 'resolved' and not outcome.verified:
            raise ValueError('A resolved outcome requires human verification')
        with self._connect() as connection:
            connection.execute('BEGIN IMMEDIATE')
            row = connection.execute('SELECT payload FROM bills WHERE owner_id = ? AND id = ?',
                                     (owner_id, bill_id)).fetchone()
            if row is None:
                return None
            bill = BillView.model_validate_json(row[0])
            bill.negotiation = outcome
            bill.updated_at = datetime.now(timezone.utc).isoformat()
            connection.execute('UPDATE bills SET payload = ? WHERE owner_id = ? AND id = ?',
                               (bill.model_dump_json(), owner_id, bill_id))
            return bill
