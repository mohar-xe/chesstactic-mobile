// Stockfish access.
//
// On Android the app ships a Stockfish 17 binary built for aarch64 in CI (see
// `tools/build-stockfish-android.sh`). A small Capacitor plugin spawns it and
// speaks UCI over pipes. In a browser there is no engine, so the client
// reports itself as unavailable and the review falls back to the
// human-aligned Maia analysis.

export interface StockfishLine {
  /** Centipawn score from the side-to-move's perspective. */
  cp: number;
  /** Mate distance, positive = the side to move mates. */
  mate: number | null;
  /** Principal variation in UCI. */
  pv: string[];
  bestMove: string | null;
}

export interface StockfishOptions {
  depth?: number;
  movetimeMs?: number;
  multiPv?: number;
}

export interface StockfishClient {
  readonly available: boolean;
  readonly backend: 'native' | 'none';
  analyze(fen: string, options?: StockfishOptions): Promise<StockfishLine[]>;
  quit(): Promise<void>;
}

interface StockfishPlugin {
  start(): Promise<void>;
  analyze(fen: string, depth: number, movetimeMs: number, multiPv: number): Promise<{
    lines: { cp: number; mate: number | null; pv: string[]; bestMove: string | null }[];
  }>;
  quit(): Promise<void>;
}

function nativePlugin(): StockfishPlugin | null {
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean; Plugins?: Record<string, unknown> } }).Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  const plugins = cap.Plugins as Record<string, StockfishPlugin> | undefined;
  return plugins?.StockfishNative ?? null;
}

export async function createStockfishClient(): Promise<StockfishClient> {
  const plugin = nativePlugin();
  if (!plugin) {
    return {
      available: false,
      backend: 'none',
      async analyze() { return []; },
      async quit() { /* nothing to close */ },
    };
  }

  await plugin.start();

  return {
    available: true,
    backend: 'native',
    async analyze(fen, options = {}) {
      const depth = options.depth ?? 12;
      const movetimeMs = options.movetimeMs ?? 0;
      const multiPv = options.multiPv ?? 1;
      const out = await plugin.analyze(fen, depth, movetimeMs, multiPv);
      return out.lines ?? [];
    },
    async quit() {
      await plugin.quit();
    },
  };
}
