// ONNX Runtime plumbing. Two backends, one interface:
//
//  * Web — `onnxruntime-web` (WASM) inside the WebView or a browser tab.
//  * Native — a small Capacitor plugin (`MaiaNative`) that runs ONNX Runtime
//    Mobile with NNAPI/XNNPACK, used on Android for the big models.
//
// The native path is picked automatically when the plugin is present; the WASM
// path is the portable fallback that also runs in a desktop browser.

export interface MaiaRawOutput {
  /** 4352 move logits. */
  logitsMove: Float32Array;
  /** 3 value logits: loss, draw, win — from the side-to-move's perspective. */
  logitsValue: Float32Array;
  /** Expected think time (raw regression output). */
  logitsPonder: number;
}

export interface OnnxRunner {
  run(tokens: Float32Array, selfElo: number, oppoElo: number): Promise<MaiaRawOutput>;
  dispose(): Promise<void>;
  readonly backend: 'native' | 'wasm';
}

const MOVE_VOCAB = 4352;

function shapeTokens(tokens: Float32Array): [number, number, number] {
  // The exported graph is fixed to batch 1, 64 squares, 12 * history columns.
  const columns = tokens.length / 64;
  return [1, 64, columns];
}

/* --------------------------------------------------------------- native -- */

interface NativePlugin {
  create(modelPath: string): Promise<void>;
  run(tokens: number[], selfElo: number, oppoElo: number): Promise<{
    logitsMove: number[];
    logitsValue: number[];
    logitsPonder: number;
  }>;
  dispose(): Promise<void>;
}

let nativePlugin: NativePlugin | null = null;

async function loadNativePlugin(): Promise<NativePlugin | null> {
  if (nativePlugin) return nativePlugin;
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean; Plugins?: Record<string, unknown> } }).Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  const registry = (globalThis as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor?.Plugins as
    | Record<string, NativePlugin>
    | undefined;
  const plugin = registry?.MaiaNative;
  if (!plugin) return null;
  nativePlugin = plugin;
  return nativePlugin;
}

export async function createNativeRunner(modelPath: string): Promise<OnnxRunner | null> {
  const plugin = await loadNativePlugin();
  if (!plugin) return null;
  await plugin.create(modelPath);
  return {
    backend: 'native',
    async run(tokens, selfElo, oppoElo) {
      const out = await plugin.run(Array.from(tokens), selfElo, oppoElo);
      return {
        logitsMove: Float32Array.from(out.logitsMove),
        logitsValue: Float32Array.from(out.logitsValue),
        logitsPonder: out.logitsPonder,
      };
    },
    async dispose() {
      await plugin.dispose();
    },
  };
}

/* ----------------------------------------------------------------- wasm -- */

interface OrtSession {
  run(feeds: Record<string, { data: Float32Array | BigInt64Array; dims: number[] }>): Promise<Record<string, { data: Float32Array }>>;
  release?(): Promise<void>;
}

let ortModule: typeof import('onnxruntime-web') | null = null;

async function loadOrt(): Promise<typeof import('onnxruntime-web')> {
  if (!ortModule) {
    ortModule = await import('onnxruntime-web');
    ortModule.env.wasm.numThreads = 1;
  }
  return ortModule;
}

export async function createWebRunner(modelBytes: ArrayBuffer): Promise<OnnxRunner> {
  const ort = await loadOrt();
  const session: OrtSession = await ort.InferenceSession.create(modelBytes, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  }) as unknown as OrtSession;

  return {
    backend: 'wasm',
    async run(tokens, selfElo, oppoElo) {
      const [b, s, d] = shapeTokens(tokens);
      const outputs = await session.run({
        tokens: { data: tokens, dims: [b, s, d] },
        self_elos: { data: BigInt64Array.from([BigInt(Math.round(selfElo))]), dims: [1] },
        oppo_elos: { data: BigInt64Array.from([BigInt(Math.round(oppoElo))]), dims: [1] },
      });
      return {
        logitsMove: outputs.logits_move.data,
        logitsValue: outputs.logits_value.data,
        logitsPonder: Number(outputs.logits_ponder.data[0]),
      };
    },
    async dispose() {
      await session.release?.();
    },
  };
}

/**
 * Build the best runner available for a model.
 * `modelPath` is a file path on device; `modelBytes` is used in the browser.
 */
export async function createRunner(options: {
  modelPath?: string | null;
  modelBytes?: ArrayBuffer | null;
}): Promise<OnnxRunner> {
  if (options.modelPath) {
    const native = await createNativeRunner(options.modelPath);
    if (native) return native;
  }
  if (options.modelBytes) return createWebRunner(options.modelBytes);
  throw new Error('No ONNX runtime available for this model');
}

export const MAIA_MOVE_VOCAB = MOVE_VOCAB;
