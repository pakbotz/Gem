import React, { useEffect, useRef } from 'react';
import { Alert, Animated, Easing, Image, Linking, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Path, Text as SvgText } from 'react-native-svg';
import { colors, radius, type, ui } from './theme';

export type AuditStatus = 'green' | 'yellow' | 'red';

export type AuditCharge = {
  id: string;
  description: string;
  code: string;
  billedAmount: number;
  /** null when the code has no Medicare fee schedule rate (labs, drugs, facility fees). */
  medicareAmount: number | null;
  note: string;
};

export type AuditDocument = {
  id: string;
  name: string;
  type: 'PDF' | 'Photo';
  pages: number;
  uri?: string;
};

export type AuditRecord = {
  id: string;
  date: string;
  patientName: string;
  provider: string;
  status: AuditStatus;
  statusLabel: string;
  result: string;
  billedTotal: number;
  medicareApproved: number;
  potentialSavings: number;
  flaggedCount: number;
  charges: AuditCharge[];
  progress: { title: string; description: string; detail?: string }[];
  outreachSummary?: string;
  documents: AuditDocument[];
  /** Backend case ID for real bill checks. */
  caseId?: string;
  /** True when the bill has disputable charges and the call is not finished. */
  canContinue?: boolean;
};

const mariaCharges: AuditCharge[] = [
  { id: '99214', description: 'Office visit, established, moderate complexity', code: '99214', billedAmount: 250, medicareAmount: 141.64, note: 'Billed $250.00 vs Medicare-approved $141.64 (77% above reference)' },
  { id: '80053', description: 'Comprehensive metabolic panel', code: '80053', billedAmount: 220, medicareAmount: 10.56, note: 'Billed $220.00 vs Medicare-approved $10.56 (1,983% above reference)' },
  { id: '85025', description: 'Complete blood count', code: '85025', billedAmount: 95, medicareAmount: 7.77, note: 'Billed $95.00 vs Medicare-approved $7.77 (1,123% above reference)' },
  { id: '71046', description: 'Chest X-ray, 2 views', code: '71046', billedAmount: 310, medicareAmount: 35.49, note: 'Billed $310.00 vs Medicare-approved $35.49 (774% above reference)' },
  { id: '93000', description: 'Electrocardiogram, complete', code: '93000', billedAmount: 180, medicareAmount: 16.10, note: 'Billed $180.00 vs Medicare-approved $16.10 (1,018% above reference)' },
];

const stages = [
  { title: 'Read the bill', description: 'Extract charge lines, codes, dates, and provider details.' },
  { title: 'Organize the charges', description: 'Categorize items using service, location, provider, age, and Medicare context.' },
  { title: 'Compare with Medicare references', description: 'Compare each item with the applicable Medicare reference amount.' },
  { title: 'Review and approve', description: 'Review the findings and approve any provider outreach.' },
  { title: 'Follow up with the provider', description: 'Keep the response and next steps with this bill check.' },
];

export const demoAudits: AuditRecord[] = [
  {
    id: '123', date: '2026-11-14', patientName: 'Maria', provider: 'Lakeside Family Medicine', status: 'green', statusLabel: 'Review ready',
    result: 'Five of five listed charges differ from their Medicare reference amounts and may be worth asking the provider to explain.',
    billedTotal: 1055, medicareApproved: 211.56, potentialSavings: 843.44, flaggedCount: 5, charges: mariaCharges,
    progress: stages.map((stage, index) => ({ ...stage, detail: index === 0 ? '1 document read · Maria · Lakeside Family Medicine' : index === 1 ? '5 line items organized' : index === 2 ? '5 line items compared with California Medicare references' : index === 3 ? 'Patient review completed' : 'Provider response recorded' })),
    outreachSummary: 'The provider agreed to reduce the balance to $500 after the patient asked about the charge differences. The agreement is recorded for follow-up; confirm the updated statement before paying.',
    documents: [
      { id: 'doc-1', name: 'Maria_itemized_bill.pdf', type: 'PDF', pages: 3 },
      { id: 'doc-2', name: 'Medicare_summary_notice.pdf', type: 'PDF', pages: 2 },
    ],
  },
  {
    id: '124', date: '2026-12-14', patientName: 'Maria', provider: 'Lakeside Family Medicine', status: 'yellow', statusLabel: 'In progress',
    result: 'This bill is still being reviewed; some details need confirmation before we can summarize possible issues.',
    billedTotal: 680, medicareApproved: 420, potentialSavings: 260, flaggedCount: 2, charges: mariaCharges.slice(0, 2),
    progress: stages.slice(0, 3), documents: [{ id: 'doc-3', name: 'Follow_up_bill.pdf', type: 'PDF', pages: 1 }],
  },
  {
    id: '125', date: '2026-10-14', patientName: 'Maria', provider: 'North Bay Imaging', status: 'green', statusLabel: 'Review ready',
    result: 'The listed imaging charge is close to its Medicare reference amount, with no clear discrepancy in this demo review.',
    billedTotal: 310, medicareApproved: 295, potentialSavings: 15, flaggedCount: 0, charges: mariaCharges.slice(3, 4),
    progress: stages.slice(0, 4), documents: [{ id: 'doc-4', name: 'Imaging_statement.pdf', type: 'PDF', pages: 2 }],
  },
  {
    id: '126', date: '2026-09-14', patientName: 'Maria', provider: 'Bayview Lab Services', status: 'red', statusLabel: 'Needs attention',
    result: 'The bill is missing service details needed to make a reliable Medicare reference comparison.',
    billedTotal: 95, medicareApproved: 7.77, potentialSavings: 0, flaggedCount: 1, charges: mariaCharges.slice(2, 3),
    progress: stages.slice(0, 2), documents: [{ id: 'doc-5', name: 'Lab_statement.pdf', type: 'PDF', pages: 1 }],
  },
];

const documentIcon = require('./assets/audits/raw-2.png');

export function AuditsScreen({ audits, onOpenAudit }: { audits: AuditRecord[]; onOpenAudit: (auditId: string) => void }) {
  const totalBilled = audits.reduce((sum, audit) => sum + audit.billedTotal, 0);
  const flaggedAudits = audits.filter(audit => audit.flaggedCount > 0).length;
  const latestUpload = audits.reduce<AuditRecord | null>((latest, audit) => !latest || audit.date > latest.date ? audit : latest, null);
  const latestDate = latestUpload ? new Date(`${latestUpload.date}T12:00:00`) : null;
  const compactDate = latestDate ? latestDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
  const latestYear = latestDate ? `${latestDate.getFullYear()}` : 'No uploads yet';

  return <ScrollView style={styles.listScreen} contentContainerStyle={styles.listContent}>
    <Text accessibilityRole="header" style={styles.pageTitle}>Audits</Text>

    <View style={styles.metricsGrid}>
      <MetricTile icon="dollar" title="Amount billed" value={moneyWhole(totalBilled)} caption="across all audits" />
      <MetricTile icon="flag" title="Flagged for review" value={`${flaggedAudits}`} caption="audits to review" />
      <MetricTile icon="calendar" title="Latest upload" value={compactDate} caption={latestYear} />
      <MetricTile icon="hash" title="Processed bills" value={`${audits.length}`} caption="bills reviewed" />
    </View>

    <View style={styles.auditRows}>
      {audits.length === 0 ? <Text style={styles.emptyText}>Your completed bill checks will appear here.</Text> : audits.map(audit => (
        <Pressable key={audit.id} accessibilityRole="button" accessibilityLabel={`Open audit ${audit.id}, ${audit.statusLabel}, ${audit.date}`} onPress={() => onOpenAudit(audit.id)} style={({ pressed }) => [styles.auditRow, pressed && styles.pressed]}>
          <Image source={documentIcon} style={styles.documentIcon} resizeMode="contain" accessible={false} />
          <View style={styles.auditNameBlock}>
            <Text style={styles.auditName}>Audit #{audit.id}</Text>
            <Text style={styles.auditStatusText}>{audit.statusLabel}</Text>
          </View>
          <Text style={styles.auditDate}>{audit.date}</Text>
          <StatusIcon status={audit.status} size={20} />
          <Text style={styles.rowChevron}>›</Text>
        </Pressable>
      ))}
    </View>
    <Text style={styles.referenceNote}>Medicare amounts are references to review. They do not confirm an overcharge or guarantee savings.</Text>
  </ScrollView>;
}

function MetricTile({ icon, title, value, caption }: { icon: 'dollar' | 'flag' | 'calendar' | 'hash'; title: string; value: string; caption: string }) {
  return <View style={styles.metricTile}>
    <View style={styles.metricHeading}>
      <MetricIcon kind={icon} />
      <Text numberOfLines={1} style={styles.metricTitle}>{title}</Text>
    </View>
    <Text numberOfLines={1} adjustsFontSizeToFit style={styles.metricNumber}>{value}</Text>
    <Text numberOfLines={1} style={styles.metricCaption}>{caption}</Text>
  </View>;
}

function MetricIcon({ kind }: { kind: 'dollar' | 'flag' | 'calendar' | 'hash' }) {
  const color = colors.purple;
  return <Svg width={22} height={22} viewBox="0 0 24 24" accessible={false}>
    {kind === 'dollar' && <SvgText x="12" y="19" textAnchor="middle" fontSize="19" fontWeight="700" fill={color}>$</SvgText>}
    {kind === 'flag' && <Path d="M5 21V4m1 1h12l-2.4 4L18 13H6" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />}
    {kind === 'calendar' && <>
      <Path d="M5 7.5h14v12H5zM8 4v5m8-5v5M5 11h14" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </>}
    {kind === 'hash' && <Path d="M9 4 7 20m10-16-2 16M4.5 9h15m-16 6h15" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />}
  </Svg>;
}

function StatusIcon({ status, size = 20 }: { status: AuditStatus; size?: number }) {
  const color = status === 'green' ? colors.green : status === 'yellow' ? colors.amber : colors.red;
  return <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
    <Circle cx={12} cy={12} r={9.25} fill="transparent" stroke={color} strokeWidth={1.8} />
    {status === 'green' && <Path d="m7.5 12.2 3 3.05 6-6.35" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />}
    {status === 'yellow' && <Path d="M7.5 12h9" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />}
    {status === 'red' && <Path d="m8.5 8.5 7 7m0-7-7 7" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />}
  </Svg>;
}

export function AuditDetailScreen({ audit, onBack, onContinue }: { audit: AuditRecord; onBack: () => void; onContinue?: () => void }) {
  const { width } = useWindowDimensions();
  const slideX = useRef(new Animated.Value(width)).current;

  useEffect(() => {
    const enter = Animated.timing(slideX, {
      toValue: 0,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    enter.start();
    return () => enter.stop();
  }, [slideX]);

  return <Animated.View style={[styles.detailTransition, { transform: [{ translateX: slideX }] }]}>
  <ScrollView style={styles.detailScreen} contentContainerStyle={styles.detailContent}>
    <Pressable accessibilityRole="button" accessibilityLabel="Back to audits" onPress={onBack} style={styles.detailBack}>
      <Text style={styles.detailBackText}>‹  Audits</Text>
    </Pressable>
    <View style={styles.detailHeading}>
      <Text accessibilityRole="header" style={styles.detailTitle}>Audit#{audit.id}</Text>
      <Text style={styles.detailSubheading}>{audit.patientName} · {audit.provider}</Text>
    </View>

    <View style={styles.moneyGrid}>
      <MoneyCard label="Billed total" amount={audit.billedTotal} warm />
      <MoneyCard label="Medicare-approved reference" amount={audit.medicareApproved} warm />
      <MoneyCard label="Potential savings" amount={audit.potentialSavings} emphasized />
    </View>
    <Text style={styles.disclaimer}>Potential savings is the amount Gem disputes: duplicates plus charges above the fair price. The hospital decides whether to reduce them.</Text>
    {audit.canContinue && onContinue && <Pressable accessibilityRole="button" onPress={onContinue} style={({ pressed }) => [styles.continueButton, pressed && styles.pressed]}>
      <Text style={styles.continueButtonText}>{audit.statusLabel === 'Calling hospital' ? 'View call status' : 'Dispute these charges'}</Text>
    </Pressable>}

    <SectionTitle title="Charges" subtitle={`${audit.charges.length} line items · ${audit.flaggedCount} to review`} />
    <View style={styles.chargeList}>
      {audit.charges.map(charge => <ChargeCard key={charge.id} charge={charge} />)}
    </View>

    <SectionTitle title="Audit progress" />
    <View style={styles.progressCard}>
      {stages.map((fallbackStage, index) => {
        const stage = audit.progress[index] ?? fallbackStage;
        const completed = index < audit.progress.length;
        const current = index === audit.progress.length;
        return <View key={`${stage.title}-${index}`} style={styles.progressRow}>
          <View style={styles.progressRail}>
            <View style={[styles.progressDot, completed && styles.progressDotDone, current && styles.progressDotCurrent]}>
              <Text style={[styles.progressDotText, completed && styles.progressDotTextDone]}>{completed ? '✓' : `${index + 1}`}</Text>
            </View>
            {index < stages.length - 1 && <View style={styles.progressLine} />}
          </View>
          <View style={styles.progressCopy}>
            <Text style={styles.progressTitle}>{stage.title}</Text>
            <Text style={styles.progressDescription}>{stage.description}</Text>
            {!!stage.detail && <Text style={styles.progressDetail}>{stage.detail}</Text>}
            {index === 4 && !!audit.outreachSummary && <View style={styles.transcriptCard}>
              <Text style={styles.transcriptLabel}>CALL / EMAIL SUMMARY</Text>
              <Text style={styles.transcriptText}>{audit.outreachSummary}</Text>
            </View>}
          </View>
        </View>;
      })}
      {audit.outreachSummary && audit.progress.length < 5 && <View style={styles.transcriptCard}>
        <Text style={styles.transcriptLabel}>OUTREACH SUMMARY</Text>
        <Text style={styles.transcriptText}>{audit.outreachSummary}</Text>
      </View>}
    </View>

    <SectionTitle title="Documents uploaded" subtitle={`${audit.documents.length} files`} />
    <View style={styles.documentList}>
      {audit.documents.length === 0 ? <Text style={styles.emptyText}>Uploaded PDFs will appear here.</Text> : audit.documents.map(document => <Pressable key={document.id} accessibilityRole="button" onPress={() => openDocument(document)} style={({ pressed }) => [styles.uploadedDocument, pressed && styles.pressed]}>
        <Image source={documentIcon} style={styles.uploadedDocumentIcon} resizeMode="contain" accessible={false} />
        <View style={styles.documentCopy}>
          <Text numberOfLines={1} style={styles.documentName}>{document.name}</Text>
          <Text style={styles.documentMeta}>{document.type} · {document.pages} {document.pages === 1 ? 'page' : 'pages'}</Text>
        </View>
        <Text style={styles.documentOpen}>{document.uri ? 'Open' : 'PDF'}</Text>
      </Pressable>)}
    </View>

    <SectionTitle title="Result of audit" />
    <View style={styles.resultCard}>
      <StatusIcon status={audit.status} size={24} />
      <View style={styles.resultCopy}>
        <Text style={styles.resultStatus}>{audit.statusLabel}</Text>
        <Text style={styles.resultSentence}>{audit.result}</Text>
      </View>
    </View>
  </ScrollView>
  </Animated.View>;
}

function MoneyCard({ label, amount, emphasized = false, warm = false }: { label: string; amount: number; emphasized?: boolean; warm?: boolean }) {
  return <View style={[styles.moneyCard, warm && styles.moneyCardWarm, emphasized && styles.moneyCardEmphasized]}>
    <Text style={styles.moneyLabel}>{label}</Text>
    <Text adjustsFontSizeToFit numberOfLines={1} style={[styles.moneyAmount, emphasized && styles.moneyAmountEmphasized]}>{money(amount)}</Text>
  </View>;
}

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return <View style={styles.sectionHeading}>
    <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
    {!!subtitle && <Text style={styles.sectionSubtitle}>{subtitle}</Text>}
  </View>;
}

function ChargeCard({ charge }: { charge: AuditCharge }) {
  const difference = charge.medicareAmount === null ? null : charge.billedAmount - charge.medicareAmount;
  return <View style={styles.chargeCard}>
    <View style={styles.chargeTopRow}>
      <View style={styles.chargeMain}>
        <Text style={styles.chargeName}>{charge.description}</Text>
        <Text style={styles.chargeCode}>Code {charge.code}</Text>
      </View>
      <Text style={styles.chargeBilled}>{money(charge.billedAmount)} billed</Text>
    </View>
    <View style={styles.chargeBottomRow}>
      <Text style={styles.chargeDifference}>{charge.note}</Text>
      <Text style={styles.chargeReference}>{charge.medicareAmount === null ? 'No Medicare\nrate' : <><Text style={styles.chargeReferenceAmount}>{money(charge.medicareAmount)}</Text>{'\n'}Medicare reference</>}</Text>
    </View>
    {difference !== null && <Text style={styles.chargeDiffAmount}>{money(difference)} above the Medicare reference</Text>}
  </View>;
}

function openDocument(document: AuditDocument) {
  if (!document.uri) {
    Alert.alert('Demo document', 'This sample audit shows where an uploaded PDF will appear. Connect saved document URLs to open the original file here.');
    return;
  }
  Linking.openURL(document.uri).catch(() => Alert.alert('Unable to open file', 'The document could not be opened on this device.'));
}

function money(value: number) {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function moneyWhole(value: number) {
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

const styles = StyleSheet.create({
  listScreen: { flex: 1, marginHorizontal: 8, marginBottom: 8, borderRadius: 12, backgroundColor: colors.background },
  listContent: { flexGrow: 1, paddingHorizontal: 16, paddingTop: 28, paddingBottom: 28 },
  pageTitle: { ...type.display, marginBottom: 24, textAlign: 'center' },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 },
  metricTile: { width: '48.5%', minHeight: 122, padding: 12, justifyContent: 'space-between', borderRadius: radius.row, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  metricHeading: { minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: 7 },
  metricTitle: { ...type.label, flex: 1, color: colors.ink },
  metricNumber: { fontSize: 28, lineHeight: 34, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  metricCaption: { fontSize: 10, lineHeight: 14, fontWeight: '500', color: colors.muted, textAlign: 'center' },
  auditRows: { marginTop: 40, gap: 4 },
  auditRow: { minHeight: 46, flexDirection: 'row', alignItems: 'center', paddingVertical: 4, gap: 10 },
  documentIcon: { width: 34, height: 38 },
  auditNameBlock: { flex: 1, minWidth: 0 },
  auditName: type.bodyStrong,
  auditStatusText: { marginTop: 2, fontSize: 10, fontWeight: '600', color: colors.body },
  auditDate: { fontSize: 12, fontWeight: '700', color: colors.ink },
  rowChevron: { color: colors.muted, fontSize: 21, marginLeft: -6 },
  referenceNote: { marginTop: 'auto', paddingTop: 26, fontSize: 11, lineHeight: 16, color: colors.muted },
  emptyText: { paddingVertical: 16, fontSize: 14, lineHeight: 20, color: colors.muted },
  pressed: { opacity: 0.7 },
  detailScreen: { flex: 1, backgroundColor: colors.background },
  detailTransition: { flex: 1, overflow: 'hidden', backgroundColor: colors.background },
  detailContent: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 36, gap: 16 },
  detailBack: { minHeight: 40, justifyContent: 'center', alignSelf: 'flex-start', paddingRight: 10 },
  detailBackText: type.link,
  detailHeading: { gap: 4 },
  detailTitle: type.display,
  detailSubheading: { fontSize: 13, lineHeight: 19, color: colors.muted },
  moneyGrid: { flexDirection: 'row', gap: 8 },
  moneyCard: { flex: 1, minWidth: 0, minHeight: 94, padding: 10, justifyContent: 'space-between', borderRadius: 14, backgroundColor: colors.card },
  moneyCardWarm: { backgroundColor: colors.card },
  moneyCardEmphasized: { backgroundColor: colors.lilac },
  moneyLabel: { fontSize: 10, lineHeight: 14, color: colors.muted, fontWeight: '600' },
  moneyAmount: { fontSize: 19, lineHeight: 24, color: colors.ink, fontWeight: '800' },
  moneyAmountEmphasized: { color: colors.purple },
  disclaimer: { marginTop: -8, fontSize: 11, lineHeight: 16, color: colors.muted },
  sectionHeading: { marginTop: 4, gap: 3 },
  sectionTitle: type.heading,
  sectionSubtitle: { fontSize: 12, lineHeight: 17, color: colors.muted },
  chargeList: { gap: 10 },
  chargeCard: { padding: 14, gap: 8, borderRadius: radius.card, backgroundColor: colors.card },
  chargeTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  chargeMain: { flex: 1, gap: 3 },
  chargeName: { fontSize: 14, lineHeight: 19, fontWeight: '700', color: colors.ink },
  chargeCode: { fontSize: 12, color: colors.muted },
  chargeBilled: { fontSize: 16, fontWeight: '800', color: colors.ink },
  chargeBottomRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  chargeDifference: { flex: 1, fontSize: 12, lineHeight: 17, color: colors.red, fontWeight: '600' },
  chargeReference: { minWidth: 92, fontSize: 10, lineHeight: 14, color: colors.muted, textAlign: 'right' },
  chargeReferenceAmount: { fontSize: 14, fontWeight: '800', color: colors.ink },
  chargeDiffAmount: { fontSize: 13, fontWeight: '800', color: colors.red },
  progressCard: { padding: 16, borderRadius: radius.card, backgroundColor: colors.card },
  progressRow: { minHeight: 75, flexDirection: 'row', gap: 12 },
  progressRail: { width: 30, alignItems: 'center' },
  progressDot: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: colors.track },
  progressDotDone: { backgroundColor: colors.purple },
  progressDotCurrent: { borderWidth: 1, borderColor: colors.purple, backgroundColor: colors.card },
  progressDotText: { fontSize: 11, fontWeight: '700', color: colors.muted },
  progressDotTextDone: { color: '#FFFFFF' },
  progressLine: { flex: 1, width: 1, minHeight: 38, backgroundColor: colors.lilacLine },
  progressCopy: { flex: 1, paddingBottom: 16 },
  progressTitle: { fontSize: 14, lineHeight: 19, fontWeight: '700', color: colors.ink },
  progressDescription: { marginTop: 2, fontSize: 12, lineHeight: 17, color: colors.muted },
  progressDetail: { marginTop: 5, fontSize: 11, lineHeight: 16, color: colors.muted },
  transcriptCard: { marginTop: 10, padding: 13, borderRadius: 12, backgroundColor: colors.track },
  transcriptLabel: { marginBottom: 5, fontSize: 10, letterSpacing: 0.5, fontWeight: '700', color: colors.purple },
  transcriptText: { fontSize: 12, lineHeight: 18, color: colors.body },
  documentList: { gap: 9 },
  uploadedDocument: { minHeight: 66, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, backgroundColor: colors.card },
  uploadedDocumentIcon: { width: 34, height: 38 },
  documentCopy: { flex: 1, minWidth: 0, gap: 4 },
  documentName: { fontSize: 13, fontWeight: '700', color: colors.ink },
  documentMeta: { fontSize: 11, color: colors.muted },
  documentOpen: { fontSize: 12, fontWeight: '700', color: colors.purple },
  continueButton: ui.button,
  continueButtonText: ui.buttonText,
  resultCard: { padding: 15, flexDirection: 'row', alignItems: 'flex-start', gap: 12, borderRadius: radius.card, backgroundColor: colors.card },
  resultCopy: { flex: 1, gap: 5 },
  resultStatus: { fontSize: 13, fontWeight: '700', color: colors.ink },
  resultSentence: { fontSize: 13, lineHeight: 19, color: colors.body },
});
