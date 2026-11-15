/** Expo dependencies: npx expo install expo-camera expo-document-picker */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';

export type DocumentFile = { uri: string; name: string; mimeType: string; size?: number; file?: Blob };
export type BillingField = {
  value: string | null; page_number: number | null;
  source_text: string | null; review_reason: string | null;
};
export type LineItem = {
  service_date: BillingField; code: BillingField; description: BillingField; units: BillingField;
  charged_amount: BillingField; adjustments: BillingField; patient_responsibility: BillingField;
};
export type OCRResult = {
  documents: {
    source_file: string; source_index: number;
    pages: { page_number: number; text: string }[];
    provider_name: BillingField; provider_phone: BillingField; provider_state: BillingField;
    patient_name: BillingField; account_number: BillingField; total_billed: BillingField; total_adjustments: BillingField;
    patient_responsibility: BillingField; currency: BillingField;
    line_items: LineItem[]; review_notes: string[];
  }[];
  requires_review: boolean;
  demo_mode?: boolean;
};
const summaryFields = ['provider_name', 'provider_phone', 'provider_state', 'patient_name', 'account_number', 'total_billed', 'total_adjustments', 'patient_responsibility', 'currency'] as const;
const lineFields = ['service_date', 'code', 'description', 'units', 'charged_amount', 'adjustments', 'patient_responsibility'] as const;
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
function isField(value: unknown): value is BillingField {
  return isRecord(value) && ['value', 'source_text', 'review_reason'].every(k => value[k] === null || typeof value[k] === 'string')
    && (value.page_number === null || (typeof value.page_number === 'number' && Number.isInteger(value.page_number) && value.page_number > 0));
}
export function isResult(value: unknown): value is OCRResult {
  return isRecord(value) && value.requires_review === true && Array.isArray(value.documents) && value.documents.length > 0
    && value.documents.every(d => isRecord(d) && typeof d.source_file === 'string' && Number.isInteger(d.source_index)
      && summaryFields.every(k => isField(d[k]))
      && Array.isArray(d.pages) && d.pages.every(p => isRecord(p) && Number.isInteger(p.page_number) && typeof p.text === 'string')
      && Array.isArray(d.line_items) && d.line_items.every(item => isRecord(item) && lineFields.every(k => isField(item[k])))
      && Array.isArray(d.review_notes) && d.review_notes.every(note => typeof note === 'string'));
}
function FieldEditor({ label, field, onChange, keyboardType = 'default' }: {
  label: string; field: BillingField; onChange: (value: string) => void;
  keyboardType?: 'default' | 'decimal-pad';
}) {
  return <View style={{ gap: 4 }}>
    <Text style={styles.heading}>{label}</Text>
    <TextInput
      accessibilityLabel={label}
      value={field.value ?? ''}
      onChangeText={onChange}
      placeholder="Not found / unclear"
      placeholderTextColor="#716D79"
      keyboardType={keyboardType}
      style={styles.input}
    />
    {field.source_text && <Text selectable style={styles.source}>Source{field.page_number ? ` · Page ${field.page_number}` : ''}: “{field.source_text}”</Text>}
    {field.review_reason && <Text style={styles.error}>Review: {field.review_reason}</Text>}
  </View>;
}
export type UploadProps = {
  endpoint: string;
  onComplete?: (result: OCRResult) => void;
  /** Called with the user-corrected extraction when they choose to check the bill. */
  onContinue?: (result: OCRResult) => void;
};
export const MAX_FILES = 10;
export const MAX_BYTES = 10 * 1024 * 1024;

export function ActionButton({ title, onPress, disabled = false, variant = 'primary' }: {
  title: string; onPress: () => void; disabled?: boolean; variant?: 'primary' | 'secondary' | 'text';
}) {
  return <Pressable
    accessibilityRole="button"
    accessibilityState={{ disabled }}
    disabled={disabled}
    onPress={onPress}
    style={({ pressed }) => [
      styles.button,
      variant === 'primary' && styles.primaryButton,
      variant === 'secondary' && styles.secondaryButton,
      variant === 'text' && styles.textButton,
      disabled && styles.buttonDisabled,
      pressed && !disabled && styles.buttonPressed,
    ]}
  >
    <Text style={[styles.buttonLabel, variant === 'primary' && styles.primaryButtonLabel, variant === 'text' && styles.textButtonLabel]}>{title}</Text>
  </Pressable>;
}

/** Shared review/upload UI for both scanned pages and Files app selections.
 * endpoint is the full URL, e.g. http://YOUR_COMPUTER_LAN_IP:8000/ocr.
 * Use HTTPS when deploying. No Google credentials belong in this component.
 */
export function UploadReview({ files, setFiles, endpoint, onComplete, onContinue, children, selectionBusy = false, onRetake }: UploadProps & {
  files: DocumentFile[];
  setFiles: (files: DocumentFile[]) => void;
  children: (busy: boolean) => React.ReactNode;
  selectionBusy?: boolean;
  onRetake?: (index: number) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<OCRResult | null>(null);
  const request = useRef<XMLHttpRequest | null>(null);
  useEffect(() => () => {
    const xhr = request.current;
    if (xhr) {
      xhr.onload = xhr.onerror = xhr.ontimeout = xhr.onabort = null;
      xhr.upload.onprogress = null;
      xhr.abort();
    }
  }, []);
  useEffect(() => { setResult(null); setStatus(''); setError(''); }, [files]);

  function upload() {
    if (request.current || selectionBusy || !files.length) return;
    setError('');
    setResult(null);
    if (files.length > MAX_FILES || files.some(f => (f.size ?? 0) > MAX_BYTES)) {
      setError('Select up to 10 files, each no larger than 10 MB.');
      return;
    }
    const form = new FormData();
    for (const file of files) {
      if (Platform.OS === 'web') {
        if (!file.file) { setError('Please select this file again.'); return; }
        form.append('files', file.file, file.name);
      } else {
        // React Native multipart accepts a local URI descriptor instead of a Blob.
        form.append('files', { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);
      }
    }
    const xhr = new XMLHttpRequest();
    request.current = xhr;
    setBusy(true);
    setStatus('Uploading…');
    const finish = () => { request.current = null; setBusy(false); };
    const fail = (message: string) => { finish(); setStatus(''); setError(message); };
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) {
        const percent = Math.round(event.loaded / event.total * 100);
        setStatus(percent === 100 ? 'Reading your bill and organizing the details…' : `Uploading ${percent}%`);
      }
    };
    xhr.onload = () => {
      let data;
      try { data = JSON.parse(xhr.responseText); }
      catch { fail('The server returned an unreadable response. Please retry.'); return; }
      if (xhr.status < 200 || xhr.status >= 300) {
        fail(isRecord(data) && typeof data.detail === 'string' ? data.detail : 'Extraction failed. Please retry.');
        return;
      }
      if (!isResult(data)) {
        fail('The server returned an invalid extraction result.'); return;
      }
      finish();
      setResult(data);
      setStatus('Details ready. Check each value against your original document.');
      onComplete?.(data);
    };
    xhr.onerror = () => fail('Could not reach the extraction server. Check your connection and server URL.');
    xhr.ontimeout = () => fail('Extraction timed out. Try fewer pages.');
    xhr.onabort = () => fail('Upload cancelled. Your selected documents are still available.');
    try {
      xhr.open('POST', endpoint);
      xhr.timeout = 450_000;
      xhr.send(form); // Let the runtime set the multipart boundary.
    } catch { fail('Could not start the upload. Check the server URL.'); }
  }

  return <ScrollView contentContainerStyle={styles.container}>
    {children(busy)}
    <Text>PDF, JPEG or PNG · Up to 10 files · 10 MB per file</Text>
    {files.map((file, index) => <View key={`${file.uri}-${index}`} style={styles.card}>
      <Text style={styles.heading}>{index + 1}. {file.name}</Text>
      {file.mimeType.startsWith('image/')
        ? <Image source={{ uri: file.uri }} style={styles.preview} accessibilityLabel={`Preview of ${file.name}`} />
        : <Text>PDF selected. All supported pages will be extracted; PDF preview is not available here.</Text>}
      <View style={styles.fileActions}>
        {onRetake && <ActionButton title={`Retake page ${index + 1}`} variant="text" disabled={busy || selectionBusy} onPress={() => onRetake(index)} />}
        <ActionButton title={`Remove page ${index + 1}`} variant="text" disabled={busy || selectionBusy} onPress={() => setFiles(files.filter((_, i) => i !== index))} />
      </View>
    </View>)}
    <Text>Uploading sends these documents to the backend and Google Gemini for billing field extraction.</Text>
    <ActionButton title={`Upload & extract (${files.length})`} disabled={busy || selectionBusy || files.length === 0} onPress={upload} />
    {busy && <><ActivityIndicator color="#5D3ED3" /><ActionButton title="Cancel upload" variant="secondary" onPress={() => request.current?.abort()} /></>}
    {!!status && <Text accessibilityLiveRegion="polite">{status}</Text>}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {result?.documents.map((doc, index) => <View key={index} style={styles.card}>
      {result.demo_mode && <View style={styles.demoBanner}>
        <Text style={styles.heading}>DEMO DATA</Text>
        <Text style={styles.body}>These example values were not read from your selected document. No billing or Medicare comparison was performed.</Text>
      </View>}
      <Text style={styles.title}>Check the details</Text>
      <Text style={styles.heading}>{doc.source_index}. {doc.source_file}</Text>
      <Text style={styles.body}>{result.demo_mode ? 'Use this sample response to try editing extracted fields.' : 'These are details read from your document, not confirmed billing findings. You can correct them before the next step.'}</Text>
      <FieldEditor label="Provider" field={doc.provider_name} onChange={value => updateSummaryField(setResult, index, 'provider_name', value)} />
      <FieldEditor label="Billing phone" field={doc.provider_phone} onChange={value => updateSummaryField(setResult, index, 'provider_phone', value)} />
      <FieldEditor label="State" field={doc.provider_state} onChange={value => updateSummaryField(setResult, index, 'provider_state', value)} />
      <FieldEditor label="Patient" field={doc.patient_name} onChange={value => updateSummaryField(setResult, index, 'patient_name', value)} />
      <FieldEditor label="Account number" field={doc.account_number} onChange={value => updateSummaryField(setResult, index, 'account_number', value)} />
      <FieldEditor label="Currency" field={doc.currency} onChange={value => updateSummaryField(setResult, index, 'currency', value)} />
      <FieldEditor label="Total billed" field={doc.total_billed} keyboardType="decimal-pad" onChange={value => updateSummaryField(setResult, index, 'total_billed', value)} />
      <FieldEditor label="Total adjustments" field={doc.total_adjustments} keyboardType="decimal-pad" onChange={value => updateSummaryField(setResult, index, 'total_adjustments', value)} />
      <FieldEditor label="Patient responsibility" field={doc.patient_responsibility} keyboardType="decimal-pad" onChange={value => updateSummaryField(setResult, index, 'patient_responsibility', value)} />
      {doc.review_notes.map((note, i) => <Text key={i} style={styles.error}>{note}</Text>)}
      {doc.line_items.map((item, i) => <View key={i} style={styles.card}>
        <Text style={styles.heading}>Service {i + 1}</Text>
        <FieldEditor label="Service date" field={item.service_date} onChange={value => updateLineField(setResult, index, i, 'service_date', value)} />
        <FieldEditor label="CPT/HCPCS code" field={item.code} onChange={value => updateLineField(setResult, index, i, 'code', value)} />
        <FieldEditor label="Description" field={item.description} onChange={value => updateLineField(setResult, index, i, 'description', value)} />
        <FieldEditor label="Units" field={item.units} keyboardType="decimal-pad" onChange={value => updateLineField(setResult, index, i, 'units', value)} />
        <FieldEditor label="Charged amount" field={item.charged_amount} keyboardType="decimal-pad" onChange={value => updateLineField(setResult, index, i, 'charged_amount', value)} />
        <FieldEditor label="Adjustments" field={item.adjustments} keyboardType="decimal-pad" onChange={value => updateLineField(setResult, index, i, 'adjustments', value)} />
        <FieldEditor label="Patient responsibility" field={item.patient_responsibility} keyboardType="decimal-pad" onChange={value => updateLineField(setResult, index, i, 'patient_responsibility', value)} />
      </View>)}
      <Text style={styles.heading}>Extracted page text</Text>
      {doc.pages.map(page => <View key={page.page_number}>
        <Text style={styles.heading}>Page {page.page_number}</Text>
        <Text selectable>{page.text || 'No text found. Try a clearer scan.'}</Text>
      </View>)}
      <View style={styles.noteCard}>
        <Text style={styles.heading}>What happens next</Text>
        <Text style={styles.source}>Gem compares each charge with Medicare rates, flags duplicates and overcharges, and can call the hospital to dispute them after you approve.</Text>
      </View>
    </View>)}
    {result && onContinue && <ActionButton title="Check this bill for overcharges" disabled={busy} onPress={() => onContinue(result)} />}
  </ScrollView>;
}

function corrected(field: BillingField, value: string): BillingField {
  if (!value) return { ...field, value: null };
  return { value, page_number: field.page_number ?? 1, source_text: field.source_text ?? 'Entered by user', review_reason: null };
}

function updateSummaryField(
  setResult: React.Dispatch<React.SetStateAction<OCRResult | null>>,
  documentIndex: number,
  key: typeof summaryFields[number],
  value: string,
) {
  setResult(current => {
    if (!current) return current;
    const documents = [...current.documents];
    const document = { ...documents[documentIndex] };
    document[key] = corrected(document[key], value);
    documents[documentIndex] = document;
    return { ...current, documents };
  });
}

function updateLineField(
  setResult: React.Dispatch<React.SetStateAction<OCRResult | null>>,
  documentIndex: number,
  lineIndex: number,
  key: keyof LineItem,
  value: string,
) {
  setResult(current => {
    if (!current) return current;
    const documents = [...current.documents];
    const document = { ...documents[documentIndex], line_items: [...documents[documentIndex].line_items] };
    const line = { ...document.line_items[lineIndex] };
    line[key] = corrected(line[key], value);
    document.line_items[lineIndex] = line;
    documents[documentIndex] = document;
    return { ...current, documents };
  });
}

export default function FileUpload(props: UploadProps) {
  const [files, setFiles] = useState<DocumentFile[]>([]);
  const [error, setError] = useState('');
  const [picking, setPicking] = useState(false);
  async function pick() {
    setPicking(true);
    setError('');
    try {
      const selection = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/jpeg', 'image/png'], multiple: true, copyToCacheDirectory: true,
      });
      if (selection.canceled) return;
      if (files.length + selection.assets.length > MAX_FILES) { setError('Select at most 10 files in total.'); return; }
      if (selection.assets.some(f => (f.size ?? 0) > MAX_BYTES)) { setError('Each file must be 10 MB or smaller.'); return; }
      setFiles([...files, ...selection.assets.map(f => ({
        uri: f.uri, name: f.name, size: f.size, file: f.file,
        mimeType: f.mimeType ?? (/\.pdf$/i.test(f.name) ? 'application/pdf' : /\.png$/i.test(f.name) ? 'image/png' : 'image/jpeg'),
      }))]);
    } catch { setError('Could not open the Files app. Please try again.'); }
    finally { setPicking(false); }
  }
  return <UploadReview {...props} files={files} setFiles={setFiles} selectionBusy={picking}>
    {busy => <View style={styles.card}>
      <Text style={styles.title}>Upload a medical document</Text>
      <Text>Select a bill, EOB or Medicare Summary Notice from your Files app.</Text>
      <ActionButton title={picking ? 'Opening Files…' : 'Choose files'} disabled={busy || picking} onPress={pick} />
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    </View>}
  </UploadReview>;
}

export const styles = StyleSheet.create({
  container: { paddingHorizontal: 24, paddingTop: 4, paddingBottom: 48, gap: 16, backgroundColor: '#F8F6F2' },
  card: { padding: 18, borderWidth: 1, borderColor: '#E1DCD5', borderRadius: 18, backgroundColor: '#FFFFFF', gap: 12 },
  title: { fontFamily: 'CanelaThin', fontSize: 25, lineHeight: 32, color: '#24232B' },
  heading: { fontSize: 15, fontWeight: '600', color: '#24232B' },
  body: { fontSize: 14, lineHeight: 20, color: '#716D79' },
  source: { fontSize: 12, lineHeight: 18, color: '#716D79' },
  input: { minHeight: 48, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: '#CFC9C1', borderRadius: 10, backgroundColor: '#FFFFFF', color: '#24232B', fontSize: 15 },
  preview: { width: '100%', height: 260, resizeMode: 'contain', borderRadius: 12, backgroundColor: '#F1EEEA' },
  fileActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  noteCard: { padding: 14, gap: 6, borderRadius: 14, backgroundColor: '#F8F6F2' },
  demoBanner: { padding: 14, gap: 6, borderWidth: 1, borderColor: '#E1DCD5', borderRadius: 14, backgroundColor: '#F0EBFA' },
  error: { color: '#A01818', fontSize: 13, lineHeight: 19 },
  button: { minHeight: 50, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, borderRadius: 25 },
  primaryButton: { backgroundColor: '#5D3ED3' },
  secondaryButton: { borderWidth: 1, borderColor: '#5D3ED3', backgroundColor: '#FFFFFF' },
  textButton: { minHeight: 40, alignSelf: 'flex-start', paddingHorizontal: 4 },
  buttonLabel: { fontSize: 14, fontWeight: '600', color: '#5D3ED3' },
  primaryButtonLabel: { color: '#FFFFFF' },
  textButtonLabel: { color: '#716D79' },
  buttonDisabled: { opacity: 0.45 },
  buttonPressed: { opacity: 0.78 },
});
