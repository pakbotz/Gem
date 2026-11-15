/** Read a bill, show what's wrong and what could be saved, then call the hospital to dispute it. */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ScrollViewInstance } from 'react-native';
import type { DocumentFile } from './document extraction/FileUpload';
import { api, Attempt, callFinished, Case, Issue, Outcome, Plan, Review } from './api';
import { extract } from './capture';
import { colors as C, radius, type, ui } from './theme';

type Step = { active: string; done: string; detail: string };
const CHECK_STEPS: Step[] = [
  { active: 'Uploading your bill', done: 'Bill uploaded', detail: 'Sending your pages securely' },
  { active: 'Reading the document', done: 'Document read', detail: 'Finding every charge, code and date' },
  { active: 'Checking prices against Medicare', done: 'Prices checked', detail: 'Comparing each code with 2026 Medicare rates' },
  { active: 'Reviewing for duplicates and extra charges', done: 'Charges reviewed', detail: 'Looking for repeated and inflated lines' },
  { active: 'Thinking through your options', done: 'Plan ready', detail: 'Writing your summary and call plan' },
];
const CALL_STEPS: Step[] = [
  { active: 'Dialing the hospital', done: 'Connected', detail: 'Reaching the billing office' },
  { active: 'Talking with billing', done: 'Charges disputed', detail: 'Gem is walking through each charge' },
  { active: 'Thinking it through', done: 'Response recorded', detail: 'Reviewing what the hospital agreed to' },
];
const POLL_MS = 4000;
// After the call ends, the transcript and Gemini's summary can take a while (longer if Gemini is busy).
const POLLS_AFTER_END = 45;
// Pause on the fully-checked list so the user sees every step complete.
const REVEAL_MS = 900;

export default function BillCheck({ files, caseId, onDone }: {
  /** New documents to read and check. */
  files?: DocumentFile[];
  /** Or an existing case to resume. */
  caseId?: string;
  onDone: () => void;
}) {
  const [bill, setBill] = useState<Case | null>(null);
  const [step, setStep] = useState(0);
  const [ready, setReady] = useState(false);
  const [details, setDetails] = useState({ name: '', account: '', dob: '', phone: '' });
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [consenting, setConsenting] = useState(false);
  const [showScript, setShowScript] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [calling, setCalling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const abort = useRef(new AbortController());
  const started = useRef(false);
  const scroll = useRef<ScrollViewInstance>(null);
  useEffect(() => () => { mounted.current = false; abort.current.abort(); }, []);

  const preparePlan = useCallback(async (c: Case, d: typeof details) => {
    return api<Plan>(`/cases/${c.id}/call-plan`, 'POST', {
      patient: { name: d.name.trim(), account_number: d.account.trim() || null, date_of_birth: d.dob.trim() || null },
      hospital_phone: d.phone.trim() || null,
    });
  }, []);

  const loaded = useCallback((c: Case, fresh: boolean) => {
    setBill(c);
    setStep(CHECK_STEPS.length);
    const h = c.review?.hospital;
    const d = { name: personName(h?.patient_name ?? ''), account: h?.account_number ?? '', dob: '', phone: h?.phone ?? '' };
    setDetails(d);
    if (c.call) { setPlan(c.call.plan); setAttempt(c.call); setCalling(true); }
    else if (c.review?.issues.length && d.name) {
      // Prepare the call in the background so Dispute -> Call now is instant. Nothing is dialed.
      preparePlan(c, d).then(p => mounted.current && setPlan(p)).catch(() => {});
    }
    if (fresh) setTimeout(() => mounted.current && setReady(true), REVEAL_MS);
    else setReady(true);
  }, [preparePlan]);

  const check = useCallback(async () => {
    setError('');
    const signal = abort.current.signal;
    let timer: ReturnType<typeof setInterval> | undefined;
    try {
      let current = bill;
      if (!current && caseId) current = await api<Case>(`/cases/${caseId}`, 'GET', undefined, signal);
      if (current?.review) { if (mounted.current) loaded(current, false); return; }
      if (!current && files) {
        setStep(0);
        const extraction = await extract(files, () => mounted.current && setStep(1), signal);
        setStep(2);
        current = await api<Case>('/cases', 'POST', extraction, signal);
      }
      if (!current) throw new Error('No bill to check.');
      if (!mounted.current) return;
      setBill(current);
      setStep(2);
      // The review is one request; advance the visible steps while it runs.
      timer = setInterval(() => setStep(s => Math.min(s + 1, CHECK_STEPS.length - 1)), 9000);
      current = await api<Case>(`/cases/${current.id}/review`, 'POST', undefined, signal);
      if (mounted.current) loaded(current, true);
    } catch (e) {
      if (mounted.current && !(e instanceof Error && e.name === 'AbortError')) setError(e instanceof Error ? e.message : 'Check failed.');
    } finally {
      clearInterval(timer);
    }
  }, [bill, caseId, files, loaded]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    check();
  }, [check]);

  // Poll call status until the hospital's response is summarized.
  useEffect(() => {
    if (!calling || !plan || callFinished(attempt)) return;
    let afterEnd = 0;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const latest = await api<Attempt>(`/cases/${plan.bill_id}/calls/${plan.review_id}`, 'GET', undefined, abort.current.signal);
        if (!mounted.current) return;
        setAttempt(latest);
        if (callFinished(latest)) return;
        if (latest.state === 'ended' && ++afterEnd > POLLS_AFTER_END) return;
      } catch (e) {
        if (!mounted.current || (e instanceof Error && e.name === 'AbortError')) return;
        setError(e instanceof Error ? e.message : 'Could not refresh the call.');
      }
      timer = setTimeout(poll, POLL_MS);
    };
    timer = setTimeout(poll, POLL_MS);
    return () => clearTimeout(timer);
    // Restart only when a call starts, not on every status update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calling, plan]);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); }
    catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : 'Something went wrong.'); }
    finally { if (mounted.current) setBusy(false); }
  }

  const saveDetails = () => run(async () => {
    if (!bill) return;
    if (!details.name.trim()) throw new Error('Add the patient name the hospital has on file.');
    const prepared = await preparePlan(bill, details);
    if (mounted.current) { setPlan(prepared); setEditing(false); }
  });

  const dispute = () => {
    setConfirming(true);
    if (!plan) setEditing(true);
    setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 120);
  };

  const call = () => run(async () => {
    if (!plan) return;
    // A lost response may still mean the phone is ringing: never redial automatically.
    setCalling(true);
    const submitted = await api<Attempt>(`/cases/${plan.bill_id}/calls`, 'POST', { plan, approved: true });
    if (mounted.current) setAttempt(submitted);
  });

  const r = bill?.review;
  if (!r || !ready) return <CheckingScreen step={step} error={error} onRetry={check} onBack={onDone} />;
  if (calling) return <CallScreen attempt={attempt} plan={plan} review={r} error={error} onDone={onDone} />;

  const totals = billTotals(r);
  const hasIssues = r.issues.length > 0;
  const footer = !hasIssues ? <Button title="Done" onPress={onDone} />
    : !confirming ? <Button title="Dispute with the hospital" onPress={() => setConsenting(true)} />
      : editing || !plan ? <Button title={busy ? 'Saving…' : 'Save details'} onPress={saveDetails} disabled={busy} />
        : <Button title={busy ? 'Starting the call…' : 'Call now'} onPress={call} disabled={busy} />;

  return <View style={s.screen}>
    <ScrollView ref={scroll} contentContainerStyle={s.page}>
      <FadeIn>
        <View style={s.hero}>
          <View style={s.verified}><Check small /><Text style={s.verifiedText}>Review complete</Text></View>
          <Text style={s.heroLabel}>{hasIssues ? 'You could save' : 'Your bill looks fair'}</Text>
          <Text adjustsFontSizeToFit numberOfLines={1} style={s.heroAmount}>{hasIssues ? money(r.total_disputed) : '$0.00'}</Text>
          <Text style={s.heroMeta}>
            {hasIssues ? `${r.issues.length} issue${r.issues.length === 1 ? '' : 's'} found` : 'No duplicate or inflated charges'}
            {r.hospital.name ? ` · ${titleCase(r.hospital.name)}` : ''}
          </Text>
          <View style={s.heroDivider} />
          <View style={s.heroStats}>
            <Stat label="Billed" value={money(totals.billed)} />
            <Stat label="Medicare pays" value={totals.priced ? money(totals.medicare) : '—'} />
          </View>
        </View>

        {hasIssues && <>
          <Text style={s.sectionTitle}>What we found</Text>
          <View style={s.list}>
            {r.issues.map((issue, i) => <IssueRow key={issue.id} issue={issue} review={r} first={i === 0}
              open={expanded === issue.id} onToggle={() => setExpanded(expanded === issue.id ? null : issue.id)} />)}
          </View>
        </>}

        {confirming && <View style={s.confirm}>
          <Text style={s.sectionTitle}>Gem will call for you</Text>
          {plan && !editing ? <View style={s.list}>
            <Detail first label="Calling" value={`${titleCase(plan.hospital_name ?? 'Hospital')} · ${formatPhone(plan.destination)}`} />
            <Detail label="On behalf of" value={plan.patient.name} />
            {plan.patient.account_number && <Detail label="Account" value={plan.patient.account_number} />}
            <Detail label="Disputing" value={money(plan.total_disputed)} money />
            <View style={s.links}>
              <Pressable onPress={() => setShowScript(!showScript)} hitSlop={8}><Text style={type.link}>{showScript ? 'Hide script' : 'Preview what Gem will say'}</Text></Pressable>
              <Pressable onPress={() => setEditing(true)} hitSlop={8}><Text style={type.link}>Edit</Text></Pressable>
            </View>
            {showScript && <Text style={s.script}>{plan.script}</Text>}
          </View> : <View style={[s.list, s.form]}>
            <Field label="Patient name" value={details.name} onChange={name => setDetails({ ...details, name })} />
            <Field label="Account number" value={details.account} onChange={account => setDetails({ ...details, account })} />
            <Field label="Hospital billing phone" value={details.phone} phone onChange={phone => setDetails({ ...details, phone })} />
          </View>}
        </View>}
        {!!error && <Text accessibilityRole="alert" style={[type.error, s.error]}>{error}</Text>}
      </FadeIn>
    </ScrollView>
    <View style={s.footer}>{footer}</View>
    <ConsentDialog visible={consenting} hospital={r.hospital.name}
      onCancel={() => setConsenting(false)} onAccept={() => { setConsenting(false); dispute(); }} />
  </View>;
}

/** Asks the patient to authorize Gem to call for them before any call details are shown. */
function ConsentDialog({ visible, hospital, onCancel, onAccept }: {
  visible: boolean; hospital: string | null; onCancel: () => void; onAccept: () => void;
}) {
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
    <View style={s.backdrop}>
      <View style={s.dialog} accessibilityViewIsModal>
        <Text style={type.heading}>Allow Gem to call for you?</Text>
        <Text style={type.body}>
          By continuing, you authorize Gem, an AI assistant, to call {hospital ? titleCase(hospital) : 'the hospital'} on
          your behalf to dispute the charges on this bill. Gem will share your name, account number and the disputed
          charges with their billing office.
        </Text>
        <Text style={type.small}>
          Gem will never make a payment or accept a payment plan for you. The call isn't recorded; a transcript and
          summary are saved so you can see the results.
        </Text>
        <View style={s.footerRow}>
          <Button title="Not now" onPress={onCancel} secondary flex />
          <Button title="Yes, I agree" onPress={onAccept} flex />
        </View>
      </View>
    </View>
  </Modal>;
}

/** The call transcript with speaker labels, minus provider bookkeeping lines. */
function Transcript({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const lines = text.split('\n').map(l => l.trim()).filter(l => l && !/^agent-action:/i.test(l))
    .map(l => l.replace(/^(assistant|bot|ai):\s*/i, 'Gem: ').replace(/^(user|human|customer):\s*/i, 'Hospital: '));
  return <View style={s.list}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)}
      style={({ pressed }) => [s.links, s.noTopBorder, pressed && ui.pressed]}>
      <Text style={type.bodyStrong}>Call transcript</Text>
      <Text style={type.link}>{open ? 'Hide' : 'Show'}</Text>
    </Pressable>
    {open && <View style={s.transcript}>
      {lines.map((line, i) => <Text key={i} selectable style={[s.rowMeta, line.startsWith('Gem:') && s.gemLine]}>{line}</Text>)}
    </View>}
  </View>;
}

function CheckingScreen({ step, error, onRetry, onBack }: { step: number; error: string; onRetry: () => void; onBack: () => void }) {
  const finished = step >= CHECK_STEPS.length;
  return <View style={s.screen}>
    <ScrollView contentContainerStyle={[s.page, s.centered]}>
      <Text style={s.eyebrow}>{error ? 'PAUSED' : finished ? 'ALL DONE' : 'WORKING ON IT'}</Text>
      <Text style={s.bigTitle}>{finished ? 'Your bill is checked' : 'Checking your bill'}</Text>
      <Timeline steps={CHECK_STEPS} current={step} failed={!!error} />
      {!!error && <Text accessibilityRole="alert" style={[type.error, s.error]}>{error}</Text>}
    </ScrollView>
    {!!error && <View style={[s.footer, s.footerRow]}>
      <Button title="Back" onPress={onBack} secondary flex />
      <Button title="Try again" onPress={onRetry} flex />
    </View>}
  </View>;
}

function CallScreen({ attempt, plan, review, error, onDone }: {
  attempt: Attempt | null; plan: Plan | null; review: Review; error: string; onDone: () => void;
}) {
  const hospital = review.hospital.name;
  const outcome = attempt?.outcome;
  const failed = attempt?.state === 'unknown' || (attempt?.state === 'ended' && !attempt.transcript && !!attempt.ended_reason);
  const status = attempt?.provider_status;
  const phase = !attempt || status === 'queued' || status === 'ringing' ? 0 : attempt.state === 'ended' ? 2 : 1;
  const name = titleCase(plan?.hospital_name ?? hospital ?? 'the hospital');

  if (outcome) {
    const savings = callSavings(outcome.issue_results, plan?.issues ?? [], review);
    const billed = billTotals(review).billed;
    const fixed = savings.rows.filter(row => row.saved > 0).length;
    return <View style={s.screen}>
      <ScrollView contentContainerStyle={s.page}>
        <FadeIn>
          <View style={[s.hero, s.heroSaved]}>
            <View style={s.verified}><Check small green /><Text style={[s.verifiedText, { color: C.green }]}>Call complete · {name}</Text></View>
            <Text style={s.heroLabel}>{savings.saved > 0 ? 'You saved' : 'Saved so far'}</Text>
            <Text adjustsFontSizeToFit numberOfLines={1} style={[s.heroAmount, { color: C.green }]}>{money(savings.saved)}</Text>
            <Text style={s.heroMeta}>{fixed} of {outcome.issue_results.length} charges fixed on this call</Text>
            <View style={[s.heroDivider, { backgroundColor: '#BFE0CD' }]} />
            <View style={s.heroStats}>
              <Stat label="Original bill" value={money(billed)} />
              <Stat label="New total" value={money(Math.max(billed - savings.saved, 0))} strong />
            </View>
            {savings.pending > 0 && <View style={s.pendingNote}>
              <Text style={s.pendingText}>Plus <Text style={s.moneyInline}>{money(savings.pending)}</Text> still in review</Text>
            </View>}
            {outcome.reference_number && <View style={s.refRow}>
              <Text style={s.statLabel}>Reference #</Text>
              <Text selectable style={s.refValue}>{outcome.reference_number}</Text>
              {outcome.representative && <Text style={s.heroMeta}> · {outcome.representative}</Text>}
            </View>}
          </View>
          <Text style={s.sectionTitle}>What happened on the call</Text>
          <View style={[s.list, s.form]}><Text style={type.body}>{outcome.summary}</Text></View>
          <Text style={s.sectionTitle}>Charge by charge</Text>
          <View style={s.list}>
            {savings.rows.map(({ result: x, issue, saved }, i) => {
              const good = saved > 0;
              const bad = x.result === 'refused';
              return <View key={x.issue_id} style={[s.row, i > 0 && s.rowDivider]}>
                <StatusIcon kind={good ? 'good' : bad ? 'bad' : 'pending'} />
                <View style={s.rowBody}>
                  <View style={s.rowHead}>
                    <Text style={s.rowTitle}>{issue ? issueTitle(issue, review) : 'Charge'}</Text>
                    {good && <Text style={[s.rowAmount, { color: C.green }]}>−{money(saved)}</Text>}
                  </View>
                  <Text style={s.rowMeta}>
                    {resultLabel(x.result)}{x.new_amount ? <> to <Text style={s.moneyInline}>{money(x.new_amount)}</Text></> : ''}
                    {x.note ? ` · ${x.note}` : ''}
                  </Text>
                </View>
              </View>;
            })}
          </View>
          {outcome.next_steps.length > 0 && <>
            <Text style={s.sectionTitle}>Next steps</Text>
            <View style={s.list}>
              {outcome.next_steps.map((step, i) => <View key={i} style={[s.row, i > 0 && s.rowDivider]}>
                <Text style={s.stepNumber}>{i + 1}</Text>
                <Text style={[s.rowMeta, s.rowBody, s.nextStep]}>{step}</Text>
              </View>)}
            </View>
          </>}
          {!!attempt?.transcript && <Transcript text={attempt.transcript} />}
        </FadeIn>
      </ScrollView>
      <View style={s.footer}><Button title="Done" onPress={onDone} /></View>
    </View>;
  }

  return <View style={s.screen}>
    <ScrollView contentContainerStyle={[s.page, s.centered]}>
      <Text style={s.eyebrow}>{failed ? 'CALL NOT CONNECTED' : 'ON THE PHONE'}</Text>
      <Text style={s.bigTitle}>{failed ? 'The call didn\'t go through' : `Gem is calling ${name}`}</Text>
      {failed
        ? <Text style={[type.body, s.centerText]}>{attempt?.state === 'unknown'
          ? 'We couldn\'t confirm the call started. Check the call log before trying again.'
          : `The phone provider couldn't place the call (${prettyReason(attempt?.ended_reason)}).`}</Text>
        : <Timeline steps={CALL_STEPS} current={phase} />}
      {!failed && attempt?.state === 'ended' && !!attempt.transcript && <>
        <Text style={[type.body, s.centerText]}>The call has ended. Gem is writing up your results.</Text>
        <Transcript text={attempt.transcript} />
      </>}
      {!!error && <Text accessibilityRole="alert" style={[type.error, s.error]}>{error}</Text>}
    </ScrollView>
    {failed && <View style={s.footer}><Button title="Done" onPress={onDone} secondary /></View>}
  </View>;
}

/** Vertical step list: ✓ for done, a spinner for the current step, a hollow dot for upcoming ones. */
function Timeline({ steps, current, failed = false }: { steps: Step[]; current: number; failed?: boolean }) {
  return <View style={s.timeline}>
    {steps.map((step, i) => {
      const done = i < current, active = i === current && !failed, last = i === steps.length - 1;
      return <View key={step.active} style={s.tlRow}>
        <View style={s.tlRail}>
          <View style={[s.tlDot, done && s.tlDotDone, active && s.tlDotActive]}>
            {done ? <Text style={s.tlCheck}>✓</Text> : active ? <ActivityIndicator size="small" color={C.purple} /> : null}
          </View>
          {!last && <View style={[s.tlLine, done && s.tlLineDone]} />}
        </View>
        <View style={s.tlCopy}>
          <Text style={[s.tlLabel, (done || active) && s.tlLabelOn]}>{done ? step.done : active ? `${step.active}…` : step.active}</Text>
          {active && <Text style={s.tlDetail}>{step.detail}</Text>}
        </View>
      </View>;
    })}
  </View>;
}

function IssueRow({ issue, review, first, open, onToggle }: { issue: Issue; review: Review; first: boolean; open: boolean; onToggle: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={onToggle}
    style={({ pressed }) => [s.row, !first && s.rowDivider, pressed && ui.pressed]}>
    <StatusIcon kind={issue.kind === 'other_concern' ? 'warn' : 'bad'} />
    <View style={s.rowBody}>
      <View style={s.rowHead}>
        <Text style={s.rowTitle}>{issueTitle(issue, review)}</Text>
        {issue.disputed_amount && <Text style={s.rowAmount}>{money(issue.disputed_amount)}</Text>}
      </View>
      <Text style={s.rowMeta}><Moneyed text={issueFacts(issue, review)} /></Text>
      {open && <Text style={s.rowMore}><Moneyed text={issue.explanation} /></Text>}
    </View>
  </Pressable>;
}

function StatusIcon({ kind }: { kind: 'good' | 'bad' | 'warn' | 'pending' }) {
  const [bg, fg, glyph] = kind === 'good' ? ['#E3F2EA', C.green, '✓'] : kind === 'bad' ? ['#F6E4E6', C.red, '!']
    : kind === 'warn' ? ['#F7EFD6', '#9A7A12', '?'] : [C.track, C.muted, '•'];
  return <View style={[s.icon, { backgroundColor: bg }]}><Text style={[s.iconGlyph, { color: fg }]}>{glyph}</Text></View>;
}

function Check({ small = false, green = false }: { small?: boolean; green?: boolean }) {
  return <View style={[s.check, small && s.checkSmall, green && { backgroundColor: C.green }]}><Text style={s.checkGlyph}>✓</Text></View>;
}

function FadeIn({ children }: { children: React.ReactNode }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(12)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 380, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 380, useNativeDriver: true }),
    ]).start();
  }, [opacity, translateY]);
  return <Animated.View style={{ opacity, transform: [{ translateY }], gap: 14 }}>{children}</Animated.View>;
}

function Stat({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <View style={s.stat}>
    <Text style={s.statLabel}>{label}</Text>
    <Text numberOfLines={1} adjustsFontSizeToFit style={[s.statValue, strong && s.statStrong]}>{value}</Text>
  </View>;
}

function Detail({ label, value, first = false, money: isMoney = false }: { label: string; value: string; first?: boolean; money?: boolean }) {
  return <View style={[s.detail, !first && s.rowDivider]}>
    <Text style={s.detailLabel}>{label}</Text>
    <Text style={[s.detailValue, isMoney && s.detailMoney]}>{value}</Text>
  </View>;
}

/** Renders text with every dollar amount in bold, so money always stands out. */
function Moneyed({ text }: { text: string }) {
  const parts = text.split(/(\$\d[\d,]*(?:\.\d{2})?)/);
  return <>{parts.map((part, i) => i % 2 ? <Text key={i} style={s.moneyInline}>{part}</Text> : part)}</>;
}

function Field({ label, value, onChange, phone = false }: { label: string; value: string; onChange: (v: string) => void; phone?: boolean }) {
  return <View style={{ gap: 6 }}>
    <Text style={type.label}>{label}</Text>
    <TextInput accessibilityLabel={label} value={value} onChangeText={onChange} style={ui.input}
      keyboardType={phone ? 'phone-pad' : 'default'} placeholderTextColor={C.faint} />
  </View>;
}

function Button({ title, onPress, disabled = false, secondary = false, flex = false }: {
  title: string; onPress: () => void; disabled?: boolean; secondary?: boolean; flex?: boolean;
}) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}
    style={({ pressed }) => [ui.button, flex && { flex: 1 }, secondary && ui.buttonSecondary, disabled && ui.disabled, pressed && ui.pressed]}>
    <Text style={[ui.buttonText, secondary && ui.buttonTextSecondary]}>{title}</Text>
  </Pressable>;
}

function lineFor(review: Review, issue: Issue) {
  const audit = review.audits.find(a => a.source_index === issue.source_index);
  return audit?.discrepancies.find(d => d.line_number === issue.line_numbers[0]);
}

function issueTitle(issue: Issue, review?: Review) {
  const line = review ? lineFor(review, issue) : undefined;
  const name = line?.description ?? issue.evidence.match(/"([^"]+)"/)?.[1] ?? 'This charge';
  return issue.kind === 'duplicate_charge' ? `${name}, charged twice`
    : issue.kind === 'overcharge' ? `${name}, overpriced`
      : issue.kind === 'unitemized_charges' ? 'Charges not itemized' : `${name}, needs a closer look`;
}

/** One line of hard numbers per issue, computed from the audit rather than model prose. */
function issueFacts(issue: Issue, review: Review) {
  const line = lineFor(review, issue);
  if (issue.kind === 'overcharge' && line?.benchmark && line.billed_amount) {
    return `Billed ${money(line.billed_amount)} · Medicare pays ${money(line.benchmark.amount)}`;
  }
  if (issue.kind === 'duplicate_charge' && line?.billed_amount) {
    return `Billed ${issue.line_numbers.length} times at ${money(line.billed_amount)} each`;
  }
  if (issue.kind === 'unitemized_charges') return 'The printed total is higher than the listed charges';
  return issue.ask;
}

/** Sum of billed amounts on an issue's lines. */
function billedFor(issue: Issue, review: Review) {
  const audit = review.audits.find(a => a.source_index === issue.source_index);
  return issue.line_numbers.reduce((t, n) => t + Number(audit?.discrepancies.find(d => d.line_number === n)?.billed_amount ?? 0), 0);
}

/**
 * Money saved per the call outcome. Removed duplicates save the extra copies; other
 * removed charges save the whole line; reductions save old minus new price. Anything
 * reduced without a stated amount or still under review counts as pending, not saved.
 */
function callSavings(results: Outcome['issue_results'], issues: Issue[], review: Review) {
  let saved = 0, pending = 0;
  const rows = results.map(result => {
    const issue = issues.find(i => i.id === result.issue_id);
    const disputed = Number(issue?.disputed_amount ?? 0);
    let amount = 0;
    if (issue && result.result === 'removed') {
      amount = issue.kind === 'duplicate_charge' ? disputed
        : issue.kind === 'overcharge' ? billedFor({ ...issue, line_numbers: issue.line_numbers.slice(0, 1) }, review)
          : disputed || billedFor(issue, review);
    } else if (issue && result.result === 'reduced' && result.new_amount) {
      const before = issue.kind === 'duplicate_charge' ? disputed : billedFor({ ...issue, line_numbers: issue.line_numbers.slice(0, 1) }, review);
      amount = Math.max(before - Number(result.new_amount), 0);
    } else if (result.result === 'reduced' || result.result === 'under_review') {
      pending += disputed;
    }
    saved += amount;
    return { result, issue, saved: amount };
  });
  return { saved, pending, rows };
}

function resultLabel(result: string) {
  return ({ removed: 'Removed', reduced: 'Reduced', under_review: 'Under review', refused: 'Not changed', not_discussed: 'Not discussed' } as Record<string, string>)[result] ?? result;
}

function prettyReason(reason?: string | null) {
  return (reason ?? 'unknown reason').replace(/^call\.start\.error-/, '').replace(/[-.]/g, ' ');
}

function billTotals(review: Review) {
  const lines = review.audits.flatMap(a => a.discrepancies);
  return {
    billed: lines.reduce((t, l) => t + Number(l.billed_amount ?? 0), 0),
    medicare: lines.reduce((t, l) => t + (l.benchmark ? Number(l.benchmark.amount) : 0), 0),
    priced: lines.some(l => l.benchmark),
  };
}

function money(value: string | number) {
  return `$${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Bills print "SANCHEZ, MARIA"; the agent should say "Maria Sanchez". */
function personName(text: string) {
  const [last, first] = text.split(',').map(part => part.trim());
  return titleCase(first ? `${first} ${last}` : text.trim());
}

function titleCase(text: string) {
  return text === text.toUpperCase() ? text.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : text;
}

function formatPhone(e164: string) {
  const d = e164.replace(/^\+1/, '');
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : e164;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.background },
  page: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 32, gap: 14 },
  centered: { flexGrow: 1, justifyContent: 'center', paddingBottom: 64 },
  centerText: { textAlign: 'center' },
  eyebrow: { ...type.eyebrow, textAlign: 'center' },
  bigTitle: { ...type.display, textAlign: 'center', marginBottom: 12 },
  sectionTitle: { ...type.heading, marginTop: 14 },
  error: { textAlign: 'center' },

  timeline: { alignSelf: 'center', width: '100%', maxWidth: 420, marginTop: 20 },
  tlRow: { flexDirection: 'row', gap: 16 },
  tlRail: { width: 36, alignItems: 'center' },
  tlDot: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: C.line, backgroundColor: C.card },
  tlDotActive: { borderColor: C.purple },
  tlDotDone: { borderColor: C.purple, backgroundColor: C.purple },
  tlCheck: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  tlLine: { flex: 1, width: 2, minHeight: 28, marginVertical: 4, backgroundColor: C.line },
  tlLineDone: { backgroundColor: C.purple },
  tlCopy: { flex: 1, paddingTop: 7, paddingBottom: 30, gap: 4 },
  tlLabel: { fontSize: 17, lineHeight: 22, color: C.faint },
  tlLabelOn: { color: C.ink, fontWeight: '600' },
  tlDetail: { fontSize: 14, lineHeight: 20, color: C.muted },

  hero: { padding: 22, gap: 6, borderRadius: radius.card + 4, backgroundColor: C.lilac },
  verified: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  verifiedText: { fontSize: 13, fontWeight: '700', color: C.purple },
  heroLabel: { fontSize: 15, fontWeight: '600', color: C.body },
  heroAmount: { fontSize: 54, lineHeight: 62, fontWeight: '800', letterSpacing: -1, color: C.purple },
  heroHeadline: { ...type.display, color: C.ink },
  heroMeta: { fontSize: 14, color: C.muted },
  heroDivider: { height: 1, backgroundColor: C.lilacLine, marginVertical: 12 },
  heroStats: { flexDirection: 'row', gap: 16 },
  stat: { flex: 1, gap: 4 },
  statLabel: type.label,
  statValue: { fontSize: 19, fontWeight: '800', color: C.ink },
  statStrong: { color: C.green },
  heroSaved: { backgroundColor: '#E7F4EC' },
  pendingNote: { marginTop: 12, paddingVertical: 10, paddingHorizontal: 12, borderRadius: radius.input, backgroundColor: 'rgba(255,255,255,0.7)' },
  pendingText: { fontSize: 14, color: C.body },
  refRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  refValue: { fontSize: 16, fontWeight: '800', color: C.ink, letterSpacing: 0.5 },
  moneyInline: { fontWeight: '800', color: C.ink },
  detailMoney: { fontSize: 17, fontWeight: '800', color: C.purple },

  list: { borderRadius: radius.card, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, overflow: 'hidden' },
  row: { flexDirection: 'row', gap: 14, padding: 16 },
  rowDivider: { borderTopWidth: 1, borderTopColor: C.line },
  rowBody: { flex: 1, gap: 4 },
  rowHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  rowTitle: { ...type.bodyStrong, flex: 1 },
  rowAmount: { fontSize: 17, fontWeight: '800', color: C.red },
  rowMeta: { fontSize: 14, lineHeight: 20, color: C.muted },
  rowMore: { fontSize: 14, lineHeight: 21, color: C.body, marginTop: 6 },
  icon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  iconGlyph: { fontSize: 16, fontWeight: '800' },
  stepNumber: { width: 32, height: 32, borderRadius: 16, textAlign: 'center', lineHeight: 32, fontWeight: '700', color: C.purple, backgroundColor: C.lilac, overflow: 'hidden' },
  nextStep: { color: C.body, paddingTop: 5 },
  check: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: C.purple },
  checkSmall: { width: 22, height: 22, borderRadius: 11 },
  checkGlyph: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },

  confirm: { gap: 14 },
  detail: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  detailLabel: { fontSize: 14, color: C.muted },
  detailValue: { flexShrink: 1, fontSize: 15, fontWeight: '600', color: C.ink, textAlign: 'right' },
  links: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: 1, borderTopColor: C.line },
  script: { fontSize: 14, lineHeight: 21, color: C.body, paddingHorizontal: 16, paddingBottom: 16 },
  form: { padding: 16, gap: 14 },

  footer: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.background },
  footerRow: { flexDirection: 'row', gap: 12 },
  backdrop: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: 'rgba(20,16,28,0.45)' },
  dialog: { width: '100%', maxWidth: 440, alignSelf: 'center', gap: 14, padding: 22, borderRadius: radius.card, backgroundColor: C.card },
  noTopBorder: { borderTopWidth: 0, alignItems: 'center' },
  transcript: { gap: 8, paddingHorizontal: 16, paddingBottom: 16 },
  gemLine: { color: C.body },
});
