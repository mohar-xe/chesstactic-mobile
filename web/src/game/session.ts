// The local game loop: clocks, rules and the bot's turn, all on the device.
//
// This replaces the server's WebSocket game session. The bot is Maia-3
// running in-process; the "think time" comes from the model's ponder head
// (when it gives a sane value) or from a human-like estimate.

import { Chess, type Move } from 'chess.js';
import type { MaiaEngine, LegalMove } from '../engine/maia3';
import type { Color, EngineTierId } from '../chess/types';

export interface GameConfig {
  timeControl: string;
  userColor: Color;
  botElo: number;
  modelId: EngineTierId;
  temperature: number;
  topP: number;
}

export interface PlayedMove {
  uci: string;
  san: string;
  color: Color;
  fenBefore: string;
  fenAfter: string;
  clockAfterMs: number;
}

export interface GameState {
  fen: string;
  moves: PlayedMove[];
  turn: Color;
  whiteMs: number;
  blackMs: number;
  status: 'idle' | 'playing' | 'over';
  result: string | null;
  reason: string | null;
}

export interface SessionEvents {
  onMove?: (move: PlayedMove) => void;
  onState?: (state: GameState) => void;
  onBotThinking?: (thinking: boolean) => void;
  onGameOver?: (result: string, reason: string) => void;
}

export interface ClockSpec {
  baseMs: number;
  incrementMs: number;
}

export function parseTimeControl(tc: string): ClockSpec {
  const [base, inc] = tc.split('+');
  return {
    baseMs: Math.max(1000, (Number(base) || 300) * 1000),
    incrementMs: Math.max(0, (Number(inc) || 0) * 1000),
  };
}

/** Human-like think time, used when the model's ponder head is unusable. */
export function heuristicThinkTime(fen: string, clockMs: number): number {
  const pieces = (fen.match(/[pnbrqkPNBRQK]/g) ?? []).length;
  const complexity = Math.max(0, 32 - pieces) / 32; // more pieces -> simpler
  const pressure = clockMs < 30000 ? 0.7 : 1;
  const base = 0.6 + complexity * 2.4;
  return Math.round(Math.min(base * pressure, 6) * 1000);
}

export class GameSession {
  private chess = new Chess();
  private played: PlayedMove[] = [];
  /** Positions before each move (oldest first) — Maia reads the last 8. */
  private previousFens: string[] = [];
  private clock: ClockSpec;
  private whiteMs: number;
  private blackMs: number;
  private lastTickAt = Date.now();
  private status: GameState['status'] = 'idle';
  private result: string | null = null;
  private reason: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly config: GameConfig,
    private readonly engine: MaiaEngine,
    private readonly events: SessionEvents = {},
  ) {
    this.clock = parseTimeControl(config.timeControl);
    this.whiteMs = this.clock.baseMs;
    this.blackMs = this.clock.baseMs;
  }

  /* ------------------------------------------------------------- state -- */

  get userColor(): Color {
    return this.config.userColor;
  }

  get botColor(): Color {
    return this.config.userColor === 'white' ? 'black' : 'white';
  }

  /** The Elo the bot was told to play at. */
  get botElo(): number {
    return this.config.botElo;
  }

  get fen(): string {
    return this.chess.fen();
  }

  get moves(): PlayedMove[] {
    return this.played;
  }

  get isOver(): boolean {
    return this.status === 'over';
  }

  /** Milliseconds left for the side to move. */
  clockFor(color: Color): number {
    return color === 'white' ? this.whiteMs : this.blackMs;
  }

  state(): GameState {
    return {
      fen: this.chess.fen(),
      moves: [...this.played],
      turn: this.chess.turn() === 'w' ? 'white' : 'black',
      whiteMs: this.clockFor('white'),
      blackMs: this.clockFor('black'),
      status: this.status,
      result: this.result,
      reason: this.reason,
    };
  }

  private emitState(): void {
    this.events.onState?.(this.state());
  }

  /* ------------------------------------------------------------ clocks -- */

  /** Advance the clock of the side to move by the elapsed wall time. */
  private tickClock(): void {
    if (this.status !== 'playing') return;
    const now = Date.now();
    const elapsed = now - this.lastTickAt;
    this.lastTickAt = now;
    if (this.chess.turn() === 'w') this.whiteMs = Math.max(0, this.whiteMs - elapsed);
    else this.blackMs = Math.max(0, this.blackMs - elapsed);
  }

  startClockTimer(intervalMs = 200): void {
    this.stopClockTimer();
    this.lastTickAt = Date.now();
    this.timer = setInterval(() => {
      this.tickClock();
      this.emitState();
      if (this.clockFor(this.chess.turn() === 'w' ? 'white' : 'black') <= 0) {
        this.finish(this.chess.turn() === 'w' ? '0-1' : '1-0', 'timeout');
      }
    }, intervalMs);
  }

  stopClockTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /* ------------------------------------------------------------- moves -- */

  start(): void {
    this.status = 'playing';
    this.lastTickAt = Date.now();
    this.emitState();
    this.startClockTimer();
  }

  /** Play the user's move. Returns the played move, or null when illegal. */
  userMove(uci: string): PlayedMove | null {
    if (this.status !== 'playing') return null;
    if ((this.chess.turn() === 'w' ? 'white' : 'black') !== this.userColor) return null;
    this.tickClock();
    const move = this.applyMove(uci, this.userColor);
    if (!move) return null;
    this.checkGameOver();
    return move;
  }

  /** The bot's turn. Resolves once the move has been played. */
  async botMove(): Promise<PlayedMove | null> {
    if (this.status !== 'playing') return null;
    if ((this.chess.turn() === 'w' ? 'white' : 'black') !== this.botColor) return null;

    this.tickClock();
    this.events.onBotThinking?.(true);
    try {
      const legal = this.legalMoves();
      if (legal.length === 0) return null;

      const prediction = await this.engine.predict(this.chess.fen(), this.previousFens, legal);
      const thinkMs = prediction.ponderSeconds
        ? prediction.ponderSeconds * 1000
        : heuristicThinkTime(this.chess.fen(), this.clockFor(this.botColor));

      // Wait, but never past the bot's own flag.
      const deadline = this.clockFor(this.botColor);
      const wait = Math.max(0, Math.min(thinkMs, deadline - 250));
      if (wait > 0) await sleep(wait);

      this.tickClock();
      const move = this.applyMove(prediction.uci, this.botColor);
      this.checkGameOver();
      return move;
    } finally {
      this.events.onBotThinking?.(false);
    }
  }

  legalMoves(): LegalMove[] {
    return this.chess.moves({ verbose: true }).map((m) => ({
      uci: m.from + m.to + (m.promotion ?? ''),
      san: m.san,
    }));
  }

  private applyMove(uci: string, color: Color): PlayedMove | null {
    const fenBefore = this.chess.fen();
    let move: Move | null = null;
    try {
      move = this.chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.slice(4) || undefined,
      });
    } catch {
      move = null;
    }
    if (!move) return null;

    this.previousFens.push(fenBefore);

    if (color === 'white') this.whiteMs = Math.min(this.clock.baseMs, this.whiteMs + this.clock.incrementMs);
    else this.blackMs = Math.min(this.clock.baseMs, this.blackMs + this.clock.incrementMs);

    const played: PlayedMove = {
      uci: move.from + move.to + (move.promotion ?? ''),
      san: move.san,
      color,
      fenBefore,
      fenAfter: this.chess.fen(),
      clockAfterMs: this.clockFor(color),
    };
    this.played.push(played);
    this.events.onMove?.(played);
    this.emitState();
    return played;
  }

  resign(): void {
    if (this.status !== 'playing') return;
    const winner = this.userColor === 'white' ? '0-1' : '1-0';
    this.finish(winner, 'resignation');
  }

  offerDraw(): void {
    if (this.status !== 'playing') return;
    this.finish('1/2-1/2', 'draw agreement');
  }

  private checkGameOver(): void {
    if (!this.chess.isGameOver()) return;
    if (this.chess.isCheckmate()) {
      const winner = this.chess.turn() === 'w' ? '0-1' : '1-0';
      this.finish(winner, 'checkmate');
      return;
    }
    if (this.chess.isStalemate()) {
      this.finish('1/2-1/2', 'stalemate');
      return;
    }
    if (this.chess.isInsufficientMaterial()) {
      this.finish('1/2-1/2', 'insufficient material');
      return;
    }
    if (this.chess.isThreefoldRepetition()) {
      this.finish('1/2-1/2', 'threefold repetition');
      return;
    }
    if (this.chess.isDrawByFiftyMoves()) {
      this.finish('1/2-1/2', 'fifty-move rule');
      return;
    }
    this.finish('1/2-1/2', 'draw');
  }

  private finish(result: string, reason: string): void {
    if (this.status === 'over') return;
    this.status = 'over';
    this.result = result;
    this.reason = reason;
    this.stopClockTimer();
    this.emitState();
    this.events.onGameOver?.(result, reason);
  }

  /** PGN of the finished game. */
  pgn(headers: Record<string, string> = {}): string {
    const all = {
      Event: 'Patzer game',
      Site: 'Patzer (on-device)',
      Date: formatPgnDate(new Date()),
      Round: '-',
      White: this.config.userColor === 'white' ? 'You' : 'Maia-3',
      Black: this.config.userColor === 'black' ? 'You' : 'Maia-3',
      Result: this.result ?? '*',
      TimeControl: this.config.timeControl,
      ...headers,
    };
    return formatPgn(this.chess.history({ verbose: true }).map((m) => m.san), all, this.result ?? '*');
  }
}

/** "2026.11.13" — the PGN date format. */
export function formatPgnDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}.${m}.${d}`;
}

/** Build a PGN document from a move list in SAN. */
export function formatPgn(
  sans: string[],
  headers: Record<string, string>,
  result: string,
): string {
  const head = Object.entries(headers)
    .map(([key, value]) => `[${key} "${value.replace(/"/g, '\\"')}"]`)
    .join('\n');
  const tokens: string[] = [];
  sans.forEach((san, index) => {
    if (index % 2 === 0) tokens.push(`${Math.floor(index / 2) + 1}.`);
    tokens.push(san);
  });
  tokens.push(result);
  const body = tokens.join(' ').replace(/\s+/g, ' ').trim();
  const wrapped = body.length > 80
    ? body.match(/.{1,80}(\s|$)/g)?.join('\n').trim() ?? body
    : body;
  return `${head}\n\n${wrapped}\n`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
