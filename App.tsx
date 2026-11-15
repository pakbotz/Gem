import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { useFonts } from 'expo-font';
import AuthLanding from './AuthLanding';
import { AuditDetailScreen, AuditsScreen, type AuditRecord } from './Audits';
import BillCheck from './BillCheck';
import Wordmark from './Wordmark';
import { api, caseToAudit, type Case } from './api';
import { pickFiles, scanPages } from './capture';
import { MAX_FILES, type DocumentFile } from './document extraction/FileUpload';
import { colors, radius, type, ui } from './theme';

type MainTab = 'home' | 'audits';
type Source = 'upload' | 'scan';
type Flow =
  | { step: 'home' }
  | { step: 'selected'; source: Source; files: DocumentFile[] }
  | { step: 'check'; files?: DocumentFile[]; caseId?: string; key: number };

export default function App() {
  const [fontsLoaded] = useFonts({ CanelaThin: require('./assets/fonts/Canela-Thin.ttf') });
  const [started, setStarted] = useState(false);
  if (!fontsLoaded) {
    return <SafeAreaView style={styles.safeArea}><ActivityIndicator color={colors.purple} /></SafeAreaView>;
  }
  return started ? <GemApp /> : <AuthLanding onGetStarted={() => setStarted(true)} />;
}

function GemApp() {
  const [tab, setTab] = useState<MainTab>('home');
  const [flow, setFlow] = useState<Flow>({ step: 'home' });
  const [selectedAuditId, setSelectedAuditId] = useState<string | null>(null);
  const [audits, setAudits] = useState<AuditRecord[]>([]);
  const [auditsState, setAuditsState] = useState<'loading' | 'ready' | string>('loading');
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState('');
  const selectedAudit = audits.find(audit => audit.id === selectedAuditId);

  const loadAudits = useCallback(async () => {
    setAuditsState('loading');
    try {
      const cases = await api<Case[]>('/cases');
      setAudits(cases.map(caseToAudit));
      setAuditsState('ready');
    } catch (e) {
      setAuditsState(e instanceof Error ? e.message : 'Could not load your audits.');
    }
  }, []);
  useEffect(() => { if (tab === 'audits') loadAudits(); }, [tab, loadAudits]);

  async function addFiles(source: Source, existing: DocumentFile[] = []) {
    if (picking) return;
    setPicking(true); setError('');
    try {
      const added = await (source === 'upload' ? pickFiles(existing.length) : scanPages(existing.length));
      if (added) setFlow({ step: 'selected', source, files: [...existing, ...added] });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open your files.');
    } finally {
      setPicking(false);
    }
  }

  function goHome() { setFlow({ step: 'home' }); setError(''); }

  function selectTab(next: MainTab) {
    setTab(next);
    setSelectedAuditId(null);
    goHome();
  }

  const inFlow = tab === 'home' && flow.step !== 'home';

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.page}>
        <View style={styles.topBar}>
          {inFlow ? <Pressable accessibilityRole="button" onPress={goHome} style={styles.backButton}>
            <Text style={type.link}>‹  Home</Text>
          </Pressable> : <View style={styles.sideSpacer} />}
          <Wordmark size={44} />
          <View style={styles.sideSpacer} />
        </View>

        <View style={styles.main}>
          {tab === 'home' && flow.step === 'home' &&
            <HomeScreen busy={picking} error={error} onUpload={() => addFiles('upload')} onScan={() => addFiles('scan')} />}
          {tab === 'home' && flow.step === 'selected' &&
            <SelectedScreen files={flow.files} source={flow.source} busy={picking} error={error}
              onRemove={index => {
                const files = flow.files.filter((_, i) => i !== index);
                setFlow(files.length ? { ...flow, files } : { step: 'home' });
              }}
              onMore={() => addFiles(flow.source, flow.files)}
              onContinue={() => setFlow({ step: 'check', files: flow.files, key: Date.now() })} />}
          {tab === 'home' && flow.step === 'check' &&
            <BillCheck key={flow.key} files={flow.files} caseId={flow.caseId} onDone={() => selectTab('audits')} />}
          {tab === 'audits' && selectedAudit && <AuditDetailScreen audit={selectedAudit} onBack={() => setSelectedAuditId(null)}
            onContinue={() => { setTab('home'); setSelectedAuditId(null); setFlow({ step: 'check', caseId: selectedAudit.caseId, key: Date.now() }); }} />}
          {tab === 'audits' && !selectedAudit && <View style={styles.main}>
            {auditsState !== 'ready' && <View style={styles.auditsStatus}>
              {auditsState === 'loading' ? <ActivityIndicator color={colors.purple} /> : <>
                <Text style={type.error}>{auditsState}</Text>
                <Pressable onPress={loadAudits}><Text style={type.link}>Retry</Text></Pressable>
              </>}
            </View>}
            <AuditsScreen audits={audits} onOpenAudit={setSelectedAuditId} />
          </View>}
        </View>

        {!inFlow && !selectedAudit && <View style={styles.tabBar} accessibilityRole="tablist">
          <TabButton label="Home" selected={tab === 'home'} onPress={() => selectTab('home')} />
          <TabButton label="Audits" selected={tab === 'audits'} onPress={() => selectTab('audits')} />
        </View>}
      </View>
    </SafeAreaView>
  );
}

function HomeScreen({ busy, error, onUpload, onScan }: { busy: boolean; error: string; onUpload: () => void; onScan: () => void }) {
  return <View style={styles.home}>
    <BigChoice icon="↑" title="Upload your bill" description="Choose a PDF or photo from your phone" color={colors.blush} onPress={onUpload} disabled={busy} />
    <BigChoice icon="▧" title="Scan your bill" description="Use your camera to capture each page" color={colors.lilac} onPress={onScan} disabled={busy} />
    {busy && <ActivityIndicator color={colors.purple} />}
    {!!error && <Text accessibilityRole="alert" style={type.error}>{error}</Text>}
  </View>;
}

function BigChoice({ icon, title, description, color, onPress, disabled }: {
  icon: string; title: string; description: string; color: string; onPress: () => void; disabled: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} disabled={disabled}
    style={({ pressed }) => [styles.choice, { backgroundColor: color }, pressed && ui.pressed]}>
    <View style={styles.choiceIcon}><Text style={styles.choiceIconText}>{icon}</Text></View>
    <Text style={type.display}>{title}</Text>
    <Text style={type.body}>{description}</Text>
  </Pressable>;
}

function SelectedScreen({ files, source, busy, error, onRemove, onMore, onContinue }: {
  files: DocumentFile[]; source: Source; busy: boolean; error: string;
  onRemove: (index: number) => void; onMore: () => void; onContinue: () => void;
}) {
  return <View style={styles.main}>
    <ScrollView contentContainerStyle={styles.selected}>
      <Text style={type.display}>{files.length} {source === 'scan' ? 'page' : 'file'}{files.length === 1 ? '' : 's'} ready</Text>
      <Text style={type.body}>Add any other pages of this bill, or continue to check it.</Text>
      {files.map((file, index) => <View key={`${file.uri}-${index}`} style={styles.fileRow}>
        {file.mimeType.startsWith('image/')
          ? <Image source={{ uri: file.uri }} style={styles.thumb} />
          : <View style={[styles.thumb, styles.pdfThumb]}><Text style={styles.pdfText}>PDF</Text></View>}
        <Text numberOfLines={1} style={styles.fileName}>{file.name}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${file.name}`} onPress={() => onRemove(index)} hitSlop={10}>
          <Text style={styles.remove}>✕</Text>
        </Pressable>
      </View>)}
      {!!error && <Text accessibilityRole="alert" style={type.error}>{error}</Text>}
    </ScrollView>
    <View style={styles.actions}>
      <Pressable accessibilityRole="button" onPress={onMore} disabled={busy || files.length >= MAX_FILES}
        style={({ pressed }) => [ui.button, ui.buttonSecondary, styles.action, (busy || files.length >= MAX_FILES) && ui.disabled, pressed && ui.pressed]}>
        <Text style={[ui.buttonText, ui.buttonTextSecondary]}>{source === 'scan' ? 'Scan more' : 'Upload more'}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={onContinue} disabled={busy}
        style={({ pressed }) => [ui.button, styles.action, busy && ui.disabled, pressed && ui.pressed]}>
        <Text style={ui.buttonText}>Continue</Text>
      </Pressable>
    </View>
  </View>;
}

function TabButton({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="tab" accessibilityState={{ selected }} onPress={onPress} style={styles.tabButton}>
    <Text style={[styles.tabLabel, selected && styles.tabLabelSelected]}>{label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  page: { flex: 1 },
  topBar: { paddingTop: 22, paddingBottom: 14, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sideSpacer: { width: 64 },
  backButton: { width: 64, minHeight: 44, justifyContent: 'center' },
  main: { flex: 1 },
  home: { flex: 1, paddingHorizontal: 20, paddingBottom: 16, gap: 14 },
  choice: { flex: 1, borderRadius: 24, padding: 24, justifyContent: 'flex-end', gap: 8 },
  choiceIcon: { width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.7)', marginBottom: 'auto' },
  choiceIconText: { fontSize: 28, color: colors.purple },
  selected: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24, gap: 12 },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: radius.row, backgroundColor: colors.card },
  thumb: { width: 52, height: 64, borderRadius: 8, backgroundColor: colors.track },
  pdfThumb: { alignItems: 'center', justifyContent: 'center' },
  pdfText: { fontSize: 12, fontWeight: '700', color: colors.purple },
  fileName: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.ink },
  remove: { fontSize: 16, color: colors.muted, paddingHorizontal: 6 },
  actions: { flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingVertical: 14 },
  action: { flex: 1 },
  auditsStatus: { paddingHorizontal: 20, paddingTop: 12, gap: 10 },
  tabBar: { minHeight: 62, paddingHorizontal: 18, paddingBottom: 4, flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.background },
  tabButton: { flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  tabLabel: { fontSize: 13, fontWeight: '600', color: colors.muted },
  tabLabelSelected: { color: colors.purple },
});
