// Model catalogue + first-run downloads.
//
// The ONNX graphs are published as GitHub release assets by
// `.github/workflows/models.yml`. The app downloads the one the user picks and
// keeps it in the app's private storage (file on device, IndexedDB blob in a
// browser). Nothing is bundled into the APK, so a release can ship new
// models without a new build.

import type { EngineTierId } from '../chess/types';

export interface ModelDescriptor {
  id: EngineTierId;
  label: string;
  params: string;
  /** Approximate download size in megabytes. */
  sizeMb: number;
  /** Expected playing strength of the model (human-like, not engine-like). */
  eloRange: string;
  blurb: string;
}

export const MODEL_CATALOG: ModelDescriptor[] = [
  {
    id: 'maia3-5m',
    label: 'Maia-3 5M',
    params: '5M parameters',
    sizeMb: 21,
    eloRange: '800 – 1600',
    blurb: 'Smallest and fastest. Instant moves, good for phones and beginners.',
  },
  {
    id: 'maia3-23m',
    label: 'Maia-3 23M',
    params: '23M parameters',
    sizeMb: 97,
    eloRange: '900 – 2000',
    blurb: 'The sweet spot. Noticeably more human-like, still quick enough to play live.',
  },
  {
    id: 'maia3-79m',
    label: 'Maia-3 79M',
    params: '79M parameters',
    sizeMb: 316,
    eloRange: '1000 – 2400',
    blurb: 'Most accurate human model. Large download, best for high-level play.',
  },
];

const RELEASE_BASE =
  (import.meta.env?.VITE_MODEL_BASE_URL as string | undefined) ??
  'https://github.com/SikamikanikoBG/patzer/releases/download/models';

export function modelAssetUrl(id: EngineTierId): string {
  return `${RELEASE_BASE}/maia3-${id.replace('maia3-', '')}.onnx`;
}

export function modelDescriptor(id: EngineTierId): ModelDescriptor {
  return MODEL_CATALOG.find((m) => m.id === id) ?? MODEL_CATALOG[0];
}

/* --------------------------------------------------------------- storage */

const MODEL_STORE = 'models';
let dbPromise: Promise<IDBDatabase> | null = null;

function openModelDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open('patzer', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(MODEL_STORE)) db.createObjectStore(MODEL_STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

interface ModelRow { id: string; bytes: ArrayBuffer; savedAt: number }

async function putModelRow(id: string, bytes: ArrayBuffer): Promise<void> {
  const db = await openModelDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(MODEL_STORE, 'readwrite');
    tx.objectStore(MODEL_STORE).put({ id, bytes, savedAt: Date.now() } satisfies ModelRow);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getModelRow(id: string): Promise<ModelRow | undefined> {
  const db = await openModelDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MODEL_STORE, 'readonly');
    const req = tx.objectStore(MODEL_STORE).get(id);
    req.onsuccess = () => resolve(req.result as ModelRow | undefined);
    req.onerror = () => reject(req.error);
  });
}

function isNative(): boolean {
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}

/* -------------------------------------------------------------- download */

export interface DownloadProgress {
  received: number;
  total: number;
  ratio: number;
}

export class ModelDownloadError extends Error {}

/** Download a model into local storage. Resolves when it is ready to use. */
export async function downloadModel(
  id: EngineTierId,
  onProgress?: (progress: DownloadProgress) => void,
  opts: { signal?: AbortSignal } = {},
): Promise<void> {
  const url = modelAssetUrl(id);
  const response = await fetch(url, { signal: opts.signal });
  if (!response.ok) {
    throw new ModelDownloadError(`Could not download ${url} (HTTP ${response.status})`);
  }

  const total = Number(response.headers.get('content-length') ?? 0);
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = await response.arrayBuffer();
    await storeModel(id, bytes);
    onProgress?.({ received: bytes.byteLength, total, ratio: 1 });
    return;
  }

  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      if (opts.signal?.aborted) throw new DOMException('Download cancelled', 'AbortError');
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.length;
        onProgress?.({ received, total, ratio: total ? received / total : 0 });
      }
    }
  } finally {
    if (opts.signal?.aborted) {
      try { await reader.cancel(); } catch { /* ignore */ }
    }
  }

  if (opts.signal?.aborted) throw new DOMException('Download cancelled', 'AbortError');

  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  await storeModel(id, merged.buffer);
}

async function storeModel(id: EngineTierId, bytes: ArrayBuffer): Promise<void> {
  if (isNative()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    await Filesystem.mkdir({ path: 'models', directory: Directory.Data, recursive: true });
    await Filesystem.writeFile({
      path: `models/${id}.onnx`,
      directory: Directory.Data,
      data: toBase64(bytes),
      recursive: true,
    });
    return;
  }
  await putModelRow(id, bytes);
}

/** Base64 of a binary buffer — the format the Filesystem plugin expects. */
export function toBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < view.length; i += chunk) {
    binary += String.fromCharCode(...view.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Local file path of a downloaded model (device only). */
export async function modelFilePath(id: EngineTierId): Promise<string | null> {
  if (!isNative()) return null;
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  try {
    const res = await Filesystem.getUri({ path: `models/${id}.onnx`, directory: Directory.Data });
    const uri = res.uri ?? null;
    if (!uri) return null;
    if (uri.startsWith('file://')) return decodeURIComponent(uri.replace('file://', ''));
    return uri;
  } catch {
    return null;
  }
}

/** Raw bytes of a downloaded model (browser). */
export async function modelBytes(id: EngineTierId): Promise<ArrayBuffer | null> {
  if (isNative()) return null;
  const row = await getModelRow(id);
  return row?.bytes ?? null;
}

export async function isModelInstalled(id: EngineTierId): Promise<boolean> {
  if (isNative()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    try {
      await Filesystem.stat({ path: `models/${id}.onnx`, directory: Directory.Data });
      return true;
    } catch {
      return false;
    }
  }
  return (await getModelRow(id)) !== undefined;
}

export async function deleteModel(id: EngineTierId): Promise<void> {
  if (isNative()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    try {
      await Filesystem.deleteFile({ path: `models/${id}.onnx`, directory: Directory.Data });
    } catch {
      /* already gone */
    }
    return;
  }
  const db = await openModelDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(MODEL_STORE, 'readwrite');
    tx.objectStore(MODEL_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
