import React, { useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { useFonts } from 'expo-font';
import AuthLanding from './AuthLanding';
import { AuditDetailScreen, AuditsScreen, demoAudits, type AuditRecord } from './Audits';
import FileUpload from './document extraction/FileUpload';
import ScanUpload from './document extraction/ScanUpload';

type MainTab = 'home' | 'audits';
type FlowStep = 'home' | 'choose' | 'upload' | 'scan';

// Set EXPO_PUBLIC_OCR_ENDPOINT to an API host reachable from this device.
const OCR_ENDPOINT = process.env.EXPO_PUBLIC_OCR_ENDPOINT ?? 'http://localhost:8000/ocr';

export default function App() {
  const [fontsLoaded] = useFonts({ CanelaThin: require('./assets/fonts/Canela-Thin.ttf') });
  const [demoUser, setDemoUser] = useState<string | null>(null);

  if (!fontsLoaded) {
    return <SafeAreaView style={styles.safeArea}><ActivityIndicator color="#5D3ED3" /></SafeAreaView>;
  }

  if (!demoUser) return <AuthLanding onSuccess={setDemoUser} />;
  return <BillBackedApp onLogout={() => setDemoUser(null)} />;
}

function BillBackedApp({ onLogout }: { onLogout: () => void }) {
  const [tab, setTab] = useState<MainTab>('home');
  const [step, setStep] = useState<FlowStep>('home');
  const [selectedAuditId, setSelectedAuditId] = useState<string | null>(null);
  const [visited, setVisited] = useState({ upload: false, scan: false });
  const selectedAudit: AuditRecord | undefined = demoAudits.find(audit => audit.id === selectedAuditId);

  function chooseMethod(next: FlowStep) {
    if (next === 'upload' || next === 'scan') setVisited(previous => ({ ...previous, [next]: true }));
    setStep(next);
  }

  function selectTab(next: MainTab) {
    setTab(next);
    setStep('home');
    setSelectedAuditId(null);
  }

  const inBillCheck = step === 'choose' || step === 'upload' || step === 'scan';

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.page}>
        <View style={styles.topBar}>
          {inBillCheck ? (
            <Pressable accessibilityRole="button" onPress={() => setStep(step === 'choose' ? 'home' : 'choose')} style={styles.backButton}>
              <Text style={styles.backText}>‹  {step === 'choose' ? 'Home' : 'Back'}</Text>
            </Pressable>
          ) : <View style={styles.topBarSpacer} />}
          <Text style={styles.brand}>Gem</Text>
          <Pressable accessibilityRole="button" onPress={onLogout} style={styles.logoutButton}>
            <Text style={styles.logoutText}>Log out</Text>
          </Pressable>
        </View>

        <View style={styles.main}>
          {tab === 'home' && step === 'home' && <HomeScreen onStart={() => setStep('choose')} />}
          {tab === 'home' && step === 'choose' && <ChooseScreen onSelect={chooseMethod} />}
          {tab === 'home' && visited.upload && <View style={[styles.workflowScreen, step !== 'upload' && styles.hidden]}><FileUpload endpoint={OCR_ENDPOINT} /></View>}
          {tab === 'home' && visited.scan && <View style={[styles.workflowScreen, step !== 'scan' && styles.hidden]}><ScanUpload endpoint={OCR_ENDPOINT} /></View>}
          {tab === 'audits' && selectedAudit && <AuditDetailScreen audit={selectedAudit} onBack={() => setSelectedAuditId(null)} />}
          {tab === 'audits' && !selectedAudit && <AuditsScreen audits={demoAudits} onOpenAudit={setSelectedAuditId} />}
        </View>

        {!inBillCheck && !selectedAudit && <View style={styles.tabBar} accessibilityRole="tablist">
          <TabButton label="Home" selected={tab === 'home'} onPress={() => selectTab('home')} />
          <TabButton label="Audits" selected={tab === 'audits'} onPress={() => selectTab('audits')} />
        </View>}
      </View>
    </SafeAreaView>
  );
}

function HomeScreen({ onStart }: { onStart: () => void }) {
  return <ScrollView contentContainerStyle={styles.home}>
    <Text style={styles.eyebrow}>MEDICAL BILLS, MADE CLEARER</Text>
    <Text style={styles.title}>Understand what stands out.</Text>
    <Text style={styles.body}>
      Review a medical bill with clear explanations and the source behind each detail. You stay in control at every step.
    </Text>
    <View style={styles.heroCard}>
      <Text style={styles.heroKicker}>YOUR NEXT STEP</Text>
      <Text style={styles.heroTitle}>Start with a bill</Text>
      <Text style={styles.heroBody}>Add a provider bill, EOB, or Medicare Summary Notice.</Text>
      <AppButton title="Start a bill check" onPress={onStart} />
    </View>
    <View style={styles.trustNote}>
      <Text style={styles.trustTitle}>You review before anything happens</Text>
      <Text style={styles.mutedBody}>Extracted details are suggestions to check against your original document.</Text>
    </View>
  </ScrollView>;
}

function ChooseScreen({ onSelect }: { onSelect: (step: FlowStep) => void }) {
  return <ScrollView contentContainerStyle={styles.choose}>
    <Text style={styles.eyebrow}>ADD A DOCUMENT</Text>
    <Text style={styles.title}>Add your document</Text>
    <Text style={styles.body}>Choose the way that works best for you.</Text>
    <ChoiceCard title="Scan a paper bill" description="Use your phone camera to capture each page." onPress={() => onSelect('scan')} />
    <ChoiceCard title="Choose a file" description="Select a PDF or photo from your device." onPress={() => onSelect('upload')} />
    <Text style={styles.privacyNote}>Your document is sent to the BillBacked extraction service to read its details. Results need your review.</Text>
  </ScrollView>;
}

function ChoiceCard({ title, description, onPress }: { title: string; description: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.choiceCard, pressed && styles.pressed]}>
    <View style={styles.choiceIcon}><Text style={styles.choiceIconText}>{title.startsWith('Scan') ? '▧' : '↑'}</Text></View>
    <View style={styles.choiceCopy}><Text style={styles.choiceTitle}>{title}</Text><Text style={styles.mutedBody}>{description}</Text></View>
    <Text style={styles.chevron}>›</Text>
  </Pressable>;
}

function AppButton({ title, onPress }: { title: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
    <Text style={styles.primaryButtonText}>{title}</Text>
  </Pressable>;
}

function TabButton({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="tab" accessibilityState={{ selected }} onPress={onPress} style={styles.tabButton}>
    <Text style={[styles.tabLabel, selected && styles.tabLabelSelected]}>{label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F8F6F2' },
  page: { flex: 1 },
  topBar: { minHeight: 52, paddingHorizontal: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { fontFamily: 'CanelaThin', fontSize: 27, color: '#24232B' },
  topBarSpacer: { width: 54 },
  backButton: { minWidth: 54, minHeight: 44, justifyContent: 'center' },
  backText: { fontSize: 14, fontWeight: '600', color: '#5D3ED3' },
  logoutButton: { minWidth: 54, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' },
  logoutText: { fontSize: 12, fontWeight: '600', color: '#716D79' },
  main: { flex: 1 },
  workflowScreen: { flex: 1 },
  hidden: { display: 'none' },
  home: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 20, paddingBottom: 20, gap: 14 },
  choose: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 14, paddingBottom: 24, gap: 14 },
  sectionScreen: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 24, paddingBottom: 24, gap: 14 },
  eyebrow: { fontSize: 10, fontWeight: '600', letterSpacing: 1.1, color: '#5D3ED3' },
  title: { fontFamily: 'CanelaThin', fontSize: 34, lineHeight: 40, color: '#24232B' },
  body: { fontSize: 15, lineHeight: 22, color: '#716D79' },
  heroCard: { marginTop: 10, padding: 20, gap: 12, borderRadius: 20, backgroundColor: '#E9D4D1' },
  heroKicker: { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: '#5D3ED3' },
  heroTitle: { fontFamily: 'CanelaThin', fontSize: 25, color: '#24232B' },
  heroBody: { fontSize: 14, lineHeight: 20, color: '#716D79' },
  primaryButton: { minHeight: 52, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, borderRadius: 28, backgroundColor: '#5D3ED3' },
  primaryButtonText: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  trustNote: { marginTop: 'auto', marginBottom: 20, gap: 5 },
  trustTitle: { fontSize: 14, fontWeight: '700', color: '#24232B' },
  mutedBody: { fontSize: 13, lineHeight: 19, color: '#716D79' },
  choiceCard: { minHeight: 92, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1, borderColor: '#E1DCD5', borderRadius: 16, backgroundColor: '#FFFFFF' },
  choiceIcon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#F0EBFA' },
  choiceIconText: { fontSize: 23, color: '#5D3ED3' },
  choiceCopy: { flex: 1, gap: 4 },
  choiceTitle: { fontSize: 16, fontWeight: '700', color: '#24232B' },
  chevron: { fontSize: 27, color: '#716D79' },
  privacyNote: { marginTop: 4, fontSize: 12, lineHeight: 18, color: '#716D79' },
  tabBar: { minHeight: 62, paddingHorizontal: 18, paddingBottom: 4, flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#E1DCD5', backgroundColor: '#F8F6F2' },
  tabButton: { flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  tabLabel: { fontSize: 13, fontWeight: '600', color: '#716D79' },
  tabLabelSelected: { color: '#5D3ED3' },
  pressed: { opacity: 0.78 },
});
