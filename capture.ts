/** Picking, scanning and uploading bill documents for extraction. */
import { Platform } from 'react-native';
import { CameraView } from 'expo-camera';
import * as DocumentPicker from 'expo-document-picker';
import { DocumentFile, isResult, MAX_BYTES, MAX_FILES, OCRResult } from './document extraction/FileUpload';
import { OCR_ENDPOINT } from './api';

/** Returns the chosen files, or null if the user cancelled. */
export async function pickFiles(existing: number): Promise<DocumentFile[] | null> {
  const selection = await DocumentPicker.getDocumentAsync({
    type: ['application/pdf', 'image/jpeg', 'image/png'], multiple: true, copyToCacheDirectory: true,
  });
  if (selection.canceled) return null;
  if (existing + selection.assets.length > MAX_FILES) throw new Error(`Add at most ${MAX_FILES} files in total.`);
  if (selection.assets.some(f => (f.size ?? 0) > MAX_BYTES)) throw new Error('Each file must be 10 MB or smaller.');
  return selection.assets.map(f => ({
    uri: f.uri, name: f.name, size: f.size, file: f.file,
    mimeType: f.mimeType ?? (/\.pdf$/i.test(f.name) ? 'application/pdf' : /\.png$/i.test(f.name) ? 'image/png' : 'image/jpeg'),
  }));
}

/** Opens the native document scanner; returns page photos, or null if cancelled. */
export async function scanPages(existing: number): Promise<DocumentFile[] | null> {
  if (Platform.OS === 'web') throw new Error('Scanning works in the iOS and Android apps. Upload a photo or PDF instead.');
  const result = await CameraView.scanDocumentAsync({ requestPdf: false, quality: 0.8 });
  if (!result || !result.pages.length) return null;
  if (existing + result.pages.length > MAX_FILES) throw new Error(`Keep the total to ${MAX_FILES} pages or fewer.`);
  const stamp = Date.now();
  return result.pages.map((uri, i) => ({ uri, name: `bill-page-${stamp}-${i + 1}.jpg`, mimeType: 'image/jpeg' }));
}

/** Uploads files to /ocr. onUploaded fires once the bytes are sent and Gemini starts reading. */
export function extract(files: DocumentFile[], onUploaded: () => void, signal: AbortSignal): Promise<OCRResult> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const file of files) {
      if (Platform.OS === 'web') {
        if (!file.file) { reject(new Error('Please select this file again.')); return; }
        form.append('files', file.file, file.name);
      } else {
        // React Native multipart accepts a local URI descriptor instead of a Blob.
        form.append('files', { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);
      }
    }
    const xhr = new XMLHttpRequest();
    let uploaded = false;
    const markUploaded = () => { if (!uploaded) { uploaded = true; onUploaded(); } };
    xhr.upload.onprogress = event => { if (event.lengthComputable && event.loaded >= event.total) markUploaded(); };
    xhr.upload.onload = markUploaded;
    xhr.onload = () => {
      let data: unknown;
      try { data = JSON.parse(xhr.responseText); } catch { reject(new Error('The server returned an unreadable response.')); return; }
      if (xhr.status < 200 || xhr.status >= 300) {
        const detail = (data as { detail?: unknown })?.detail;
        reject(new Error(typeof detail === 'string' ? detail : 'We could not read this bill. Please try again.'));
        return;
      }
      if (!isResult(data)) { reject(new Error('The server returned an invalid result.')); return; }
      resolve(data);
    };
    xhr.onerror = () => reject(new Error(`Could not reach the Gem server at ${OCR_ENDPOINT}. Is it running?`));
    xhr.ontimeout = () => reject(new Error('Reading the bill timed out. Try fewer pages.'));
    xhr.onabort = () => reject(Object.assign(new Error('Cancelled'), { name: 'AbortError' }));
    signal.addEventListener('abort', () => xhr.abort());
    xhr.open('POST', OCR_ENDPOINT);
    xhr.timeout = 450_000;
    xhr.send(form);
  });
}
