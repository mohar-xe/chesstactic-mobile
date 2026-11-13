// Loading a Maia-3 model into an engine instance.
//
// The model may live in the app's private storage (on device) or in IndexedDB
// (in a browser). Whichever it is, the same `MaiaEngine` comes out.

import { useCallback, useEffect, useRef, useState } from 'react';
import { MaiaEngine, type MaiaSettings } from './index';
import { createRunner, type OnnxRunner } from './runtime';
import { modelBytes, modelFilePath } from '../models';
import type { EngineTierId } from '../../chess/types';

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface MaiaHandle {
  engine: MaiaEngine | null;
  status: EngineStatus;
  error: string | null;
  reload: () => void;
}

/** Build an engine for a model id. */
export async function loadMaiaEngine(
  modelId: EngineTierId,
  settings: Partial<MaiaSettings> = {},
): Promise<MaiaEngine> {
  const path = await modelFilePath(modelId);
  const bytes = path ? null : await modelBytes(modelId);
  if (!path && !bytes) {
    throw new Error(`Model ${modelId} is not downloaded yet`);
  }
  const runner: OnnxRunner = await createRunner({ modelPath: path, modelBytes: bytes });
  return new MaiaEngine(runner, { history: 8, ...settings });
}

/** React hook that keeps one engine alive for the life of a screen. */
export function useMaiaEngine(modelId: EngineTierId, settings: Partial<MaiaSettings> = {}): MaiaHandle {
  const [engine, setEngine] = useState<MaiaEngine | null>(null);
  const [status, setStatus] = useState<EngineStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    let cancelled = false;
    let current: MaiaEngine | null = null;
    setStatus('loading');
    setError(null);

    loadMaiaEngine(modelId, settingsRef.current)
      .then((created) => {
        if (cancelled) {
          void created.dispose?.();
          return;
        }
        current = created;
        setEngine(created);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
      });

    return () => {
      cancelled = true;
      setEngine(null);
    };
  }, [modelId, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { engine, status, error, reload };
}
