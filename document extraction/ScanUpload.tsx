import React, { useRef, useState } from 'react';
import { Button, Linking, Platform, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { DocumentFile, MAX_FILES, styles, UploadProps, UploadReview } from './FileUpload';

/** Mount only on the active scan screen so the camera is released on navigation. */
export default function ScanUpload(props: UploadProps) {
  const camera = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [files, setFiles] = useState<DocumentFile[]>([]);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState('');
  const captureLock = useRef(false);

  async function openCamera() {
    setError('');
    try {
      const access = permission?.granted ? permission : await requestPermission();
      if (!access.granted) { setError('Camera access is needed to scan. You can also use the file upload component.'); return; }
      setReady(false);
      setCameraOpen(true);
    } catch { setError('Could not access the camera. Please check your device permissions.'); }
  }
  async function capture() {
    if (!camera.current || !ready || captureLock.current) return;
    captureLock.current = true;
    setCapturing(true);
    setError('');
    try {
      const picture = await camera.current.takePictureAsync({ quality: 0.85 });
      if (!picture) throw new Error('No picture returned');
      // Expo web returns a data URI; native returns a cache file URI.
      const blob = Platform.OS === 'web' ? await (await fetch(picture.uri)).blob() : undefined;
      setFiles(previous => [...previous, {
        uri: picture.uri, name: `scan-${Date.now()}.jpg`, mimeType: 'image/jpeg', file: blob, size: blob?.size,
      }]);
      setCameraOpen(false);
    } catch { setError('The photo could not be captured. Please try again.'); }
    finally { setCapturing(false); captureLock.current = false; }
  }
  return <UploadReview {...props} files={files} setFiles={setFiles} selectionBusy={capturing}>
    {busy => <View style={styles.card}>
      <Text style={styles.title}>Scan your bill</Text>
      <Text>Place each page on a flat surface in good light. Keep all four corners visible. Review each photo before uploading.</Text>
      {cameraOpen && !busy ? <>
        <CameraView ref={camera} facing="back" style={{ height: 380, borderRadius: 12 }}
          onCameraReady={() => setReady(true)}
          onMountError={() => { setCameraOpen(false); setError('Camera unavailable. Try again or upload a file.'); }} />
        <Button title={capturing ? 'Taking photo…' : 'Capture page'} disabled={!ready || capturing} onPress={capture} />
        <Button title="Close camera" disabled={capturing} onPress={() => setCameraOpen(false)} />
      </> : <Button title={files.length ? 'Scan another page' : 'Open camera'}
        disabled={busy || capturing || files.length >= MAX_FILES} onPress={openCamera} />}
      {permission && !permission.granted && !permission.canAskAgain && Platform.OS !== 'web' &&
        <Button title="Open camera permissions in Settings" onPress={() => { Linking.openSettings().catch(() => setError('Open device Settings to allow camera access.')); }} />}
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    </View>}
  </UploadReview>;
}
