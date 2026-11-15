import React, { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { CameraView } from 'expo-camera';
import { ActionButton, DocumentFile, MAX_FILES, styles, UploadProps, UploadReview } from './FileUpload';

/** Uses Expo's native document scanner, which can capture and crop multiple pages. */
export default function ScanUpload(props: UploadProps) {
  const [files, setFiles] = useState<DocumentFile[]>([]);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');

  async function scan(replaceIndex?: number) {
    if (scanning) return;
    setScanning(true);
    setError('');
    try {
      const remaining = MAX_FILES - files.length + (replaceIndex === undefined ? 0 : 1);
      const result = await CameraView.scanDocumentAsync({ requestPdf: false, quality: 0.8 });
      if (!result) return;
      if (result.pages.length > remaining) {
        setError(`This scan has ${result.pages.length} pages. Keep the total to ${MAX_FILES} pages or fewer.`);
        return;
      }
      const timestamp = Date.now();
      const scanned = result.pages.map((uri, index) => ({
        uri,
        name: `bill-page-${timestamp}-${index + 1}.jpg`,
        mimeType: 'image/jpeg',
      }));
      setFiles(previous => {
        if (replaceIndex === undefined) return [...previous, ...scanned];
        const next = [...previous];
        next.splice(replaceIndex, 1, ...scanned);
        return next;
      });
    } catch {
      setError('The document scanner could not open. You can try again or choose a photo from Files.');
    } finally {
      setScanning(false);
    }
  }

  return <UploadReview {...props} files={files} setFiles={setFiles} selectionBusy={scanning}
    onRetake={index => scan(index)}>
    {busy => <View style={styles.card}>
      <Text style={styles.title}>Scan a paper bill</Text>
      <Text style={styles.body}>
        Capture each page in good light. The scanner can crop the page edges. Review every page before uploading.
      </Text>
      {Platform.OS === 'web' && <Text style={styles.source}>Camera scanning is available in the iOS and Android apps. On web, choose a photo or PDF from Files.</Text>}
      <ActionButton
        title={scanning ? 'Opening scanner…' : files.length ? 'Add page or scan again' : 'Open document scanner'}
        disabled={busy || scanning || files.length >= MAX_FILES}
        onPress={() => scan()}
      />
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    </View>}
  </UploadReview>;
}
