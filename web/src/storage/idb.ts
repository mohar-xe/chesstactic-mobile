// A tiny promise wrapper over IndexedDB. No dependency, no server, works
// identically in a browser tab and inside the Capacitor WebView (where
// IndexedDB lives in the app's private data directory and survives restarts).

export interface StoreDef {
  name: string;
  keyPath: string;
  indexes?: { name: string; keyPath: string | string[]; unique?: boolean }[];
}

let dbPromise: Promise<IDBDatabase> | null = null;
let dbName = 'patzer';

export function configureDatabase(name: string): void {
  if (dbName !== name) {
    dbName = name;
    dbPromise = null;
  }
}

export function openDatabase(stores: StoreDef[]): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const store of stores) {
        if (db.objectStoreNames.contains(store.name)) continue;
        const os = db.createObjectStore(store.name, { keyPath: store.keyPath });
        for (const idx of store.indexes ?? []) {
          os.createIndex(idx.name, idx.keyPath, { unique: idx.unique ?? false });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another tab'));
  });
  return dbPromise;
}

function tx<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Minimal typed repository over one object store. */
export class Repo<T> {
  constructor(
    private readonly db: IDBDatabase,
    readonly store: string,
  ) {}

  get(key: IDBValidKey): Promise<T | undefined> {
    return tx<T | undefined>(this.db, this.store, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>);
  }

  all(): Promise<T[]> {
    return tx<T[]>(this.db, this.store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>);
  }

  put(value: T): Promise<IDBValidKey> {
    return tx<IDBValidKey>(this.db, this.store, 'readwrite', (s) => s.put(value as unknown as IDBValidKey));
  }

  putMany(values: T[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const t = this.db.transaction(this.store, 'readwrite');
      const os = t.objectStore(this.store);
      for (const v of values) os.put(v as unknown as IDBValidKey);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  }

  delete(key: IDBValidKey): Promise<void> {
    return new Promise((resolve, reject) => {
      const t = this.db.transaction(this.store, 'readwrite');
      t.objectStore(this.store).delete(key);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  }

  clear(): Promise<void> {
    return new Promise((resolve, reject) => {
      const t = this.db.transaction(this.store, 'readwrite');
      t.objectStore(this.store).clear();
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  }
}

/** True when IndexedDB is usable (always true in a browser/WebView). */
export function storageAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined';
  } catch {
    return false;
  }
}
