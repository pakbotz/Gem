/** Client for the Gem demo server (functionality/api.py) and case -> audit mapping. */
import type { AuditCharge, AuditRecord } from './Audits';
import type { OCRResult } from './document extraction/FileUpload';

// One server serves /ocr and /cases. Use the computer's LAN IP on a physical phone.
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000').replace(/\/$/, '');
export const OCR_ENDPOINT = `${API_URL}/ocr`;
const TOKEN = process.env.EXPO_PUBLIC_DEMO_TOKEN ?? '';

export type IssueKind = 'duplicate_charge' | 'overcharge' | 'unitemized_charges' | 'other_concern';
export type Issue = {
  id: string; kind: IssueKind; source_index: number; line_numbers: number[]; evidence: string;
  disputed_amount: string | null; explanation: string; ask: string;
};
type Benchmark = { amount: string; description: string };
type AuditLine = {
  line_number: number; code: string | null; description: string | null; billed_amount: string | null;
  benchmark: Benchmark | null; fair_amount: string | null; overcharge_amount: string | null; suspected_duplicate: boolean;
};
export type Review = {
  id: string; created_at: string; summary: string; call_script: string; total_disputed: string; notice: string;
  issues: Issue[]; not_disputed: { finding_id: string; explanation: string }[];
  audits: { source_index: number; discrepancies: AuditLine[] }[];
  hospital: { name: string | null; phone: string | null; state: string | null; patient_name: string | null; account_number: string | null };
};
export type Patient = { name: string; account_number: string | null; date_of_birth: string | null };
export type Plan = {
  bill_id: string; review_id: string; destination: string; hospital_name: string | null; patient: Patient;
  purpose: string; issues: Issue[]; total_disputed: string; script: string; opening: string; limits: string;
};
export type Outcome = {
  summary: string; reference_number: string | null; representative: string | null; next_steps: string[];
  issue_results: { issue_id: string; result: string; new_amount: string | null; note: string }[];
};
export type Attempt = {
  plan: Plan; state: 'dispatching' | 'submitted' | 'unknown' | 'ended'; provider_status: string | null;
  ended_reason: string | null; transcript: string | null; outcome: Outcome | null;
};
export type Case = {
  id: string; created_at: string; extraction: OCRResult; review: Review | null; call: Attempt | null;
  negotiation: { status: string; summary: string };
};

export async function api<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method, signal,
      headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw e;
    throw new Error(`Could not reach the Gem server at ${API_URL}. Is it running?`);
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = (result as { detail?: unknown }).detail;
    throw new Error(typeof detail === 'string' ? detail : `Request failed (${response.status}).`);
  }
  return result as T;
}

export const KIND_LABEL: Record<IssueKind, string> = {
  duplicate_charge: 'Duplicate charge', overcharge: 'Above fair price',
  unitemized_charges: 'Unitemized charges', other_concern: 'Questionable charge',
};

/** The call is finished once there's an outcome, or the dispatch outcome can't be known. */
export function callFinished(attempt: Attempt | null) {
  return !!attempt && (!!attempt.outcome || attempt.state === 'unknown');
}

const num = (value: string | null | undefined) => (value ? Number(value) : 0);

export function caseToAudit(c: Case): AuditRecord {
  const docs = c.extraction.documents;
  const review = c.review;
  const issues = review?.issues ?? [];
  const lines = review?.audits.flatMap(a => a.discrepancies.map(d => ({ ...d, source: a.source_index }))) ?? [];
  const charges: AuditCharge[] = lines.map(line => {
    const issue = issues.find(i => i.source_index === line.source && i.line_numbers.includes(line.line_number));
    const medicare = line.benchmark ? Number(line.benchmark.amount) : null;
    const billed = num(line.billed_amount);
    const note = issue ? `${KIND_LABEL[issue.kind]}: ${issue.ask}`
      : medicare ? `Billed ${(billed / medicare).toFixed(1)}x the Medicare reference`
        : 'No Medicare fee schedule rate for this code';
    return { id: `${line.source}-${line.line_number}`, description: line.description ?? 'Service', code: line.code ?? '—',
      billedAmount: billed, medicareAmount: medicare, note };
  });
  const billedTotal = review ? lines.reduce((sum, l) => sum + num(l.billed_amount), 0)
    : docs.reduce((sum, d) => sum + num(d.total_billed.value), 0);
  const call = c.call;
  const outcome = call?.outcome;
  const [status, statusLabel] = !review ? ['yellow', 'Not checked yet'] as const
    : !issues.length ? ['green', 'No issues found'] as const
      : outcome ? ['green', 'Hospital responded'] as const
        : call ? ['yellow', 'Calling hospital'] as const
          : ['red', 'Ready to dispute'] as const;
  const progress = [
    { title: 'Read the bill', description: 'Extract charge lines, codes, dates, and provider details.',
      detail: `${docs.length} document(s) · ${docs.reduce((n, d) => n + d.line_items.length, 0)} line items` },
    { title: 'Organize the charges', description: 'Match codes, units and the provider state for pricing.' },
    { title: 'Compare with Medicare references', description: 'Compare each item with the applicable Medicare reference amount.',
      detail: `${lines.filter(l => l.benchmark).length} of ${lines.length} lines priced · ${issues.length} issue(s)` },
    { title: 'Review and approve', description: 'Review the findings and approve the dispute call.',
      detail: call ? `Call approved to ${call.plan.destination}` : undefined },
    { title: 'Follow up with the provider', description: 'Keep the response and next steps with this bill check.',
      detail: outcome?.reference_number ? `Reference ${outcome.reference_number}` : undefined },
  ];
  const done = !review ? 1 : !call ? 3 : !outcome ? 4 : 5;
  return {
    id: c.id.slice(0, 6).toUpperCase(),
    caseId: c.id,
    date: c.created_at.slice(0, 10),
    patientName: review?.hospital.patient_name ?? docs[0]?.patient_name.value ?? 'Patient',
    provider: review?.hospital.name ?? docs[0]?.provider_name.value ?? 'Provider',
    status, statusLabel,
    result: review?.summary ?? 'This bill has been read but not compared with Medicare rates yet.',
    billedTotal,
    medicareApproved: lines.reduce((sum, l) => sum + (l.benchmark ? Number(l.benchmark.amount) : 0), 0),
    potentialSavings: num(review?.total_disputed),
    flaggedCount: issues.length,
    charges,
    progress: progress.slice(0, done),
    outreachSummary: outcome ? [outcome.summary, ...outcome.next_steps.map(s => `• ${s}`)].join('\n') : undefined,
    documents: docs.map(d => ({ id: `doc-${d.source_index}`, name: d.source_file,
      type: /\.pdf$/i.test(d.source_file) ? 'PDF' : 'Photo', pages: d.pages.length })),
    canContinue: !!review && issues.length > 0 && !outcome,
  };
}
