# Patzer

Patzer is a **local-first, on-device chess trainer**: a Capacitor-wrapped React app for playing a human-like Maia-3 bot, reviewing your own games, and practicing from your own mistakes.

- **On-device by design:** no backend server, no account system, no cloud analysis pipeline.
- **Human-like play:** Maia-3 (ONNX) with rating-conditioned strength tiers.
- **Ground-truth review:** Stockfish-backed analysis on supported native builds (Android plugin), with Maia-informed, human-aligned insights.
- **Private local data:** games, analysis, ratings, drills, and progress are stored locally (IndexedDB / device storage).

> Status: v8 foundation is in progress. Core web build/typecheck/tests pass, but native Android/iOS plugin integration, mobile CI signing/release flow, and some product polish are still being completed.

## Features

- Play vs bot with local clocks and adaptive difficulty
- Post-game review and game analyzer (local)
- Import games from PGN, Chess.com, or Lichess
- Insights/memory from your own mistakes and trends
- Spaced-repetition drills and opening trainer based on your games/lines
- Learn lessons with local progress tracking
- Model management UI for downloadable Maia-3 ONNX models

## Project layout

- `web/` — React 18 + Vite app (chessground UI, local engine/game/analysis/storage modules)
- `tools/export-maia3-onnx/` — Maia-3 to ONNX export and parity-check scripts
- `capacitor.config.ts` — Capacitor app configuration
- `.github/workflows/` — CI, mobile APK, and model-asset workflows

## Prerequisites

- Node.js >= 20.11 and npm
- For Android builds (later/mobile workflow): JDK 17, Android SDK/NDK, and generated Capacitor Android project
- For model export: Python environment with PyTorch/ONNX tooling and Maia-3 weights/checkpoints

## Local development

```bash
# If needed on this environment
export PATH="$HOME/.local/node/bin:$PATH"

npm install
npm run dev
```

Useful checks:

```bash
npm run typecheck
npm test
npm run build
```

## Maia-3 models

- Models are expected as release assets (default base URL configurable via `VITE_MODEL_BASE_URL`).
- The app can download/install models locally for on-device inference.
- Export tooling:
  - `tools/export-maia3-onnx/export_onnx.py`
  - `tools/export-maia3-onnx/parity_check.py`

Example (requires Python deps + Maia-3 checkpoint/weights):

```bash
python tools/export-maia3-onnx/export_onnx.py --model maia3-5m --checkpoint <ckpt> --out maia3-5m.onnx
python tools/export-maia3-onnx/parity_check.py --onnx maia3-5m.onnx --model maia3-5m --checkpoint <ckpt> --positions 60
```

## Mobile / Android

Capacitor config is present, but native platform projects and plugins may need to be generated/finished depending on branch state:

```bash
npm run build
npx cap add android   # first time
npx cap sync android
npx cap open android
```

Planned/required native integrations:
- `MaiaNative` plugin (ONNX Runtime Mobile inference)
- `StockfishNative` plugin (bundled UCI Stockfish process)
- Android Stockfish build/packaging script (e.g. `tools/build-stockfish-android.sh`)

## Privacy

Patzer is designed to keep your chess data on your device. Network access is used for explicit actions like downloading model assets or importing games from Chess.com/Lichess when you request it.

## License

Patzer is licensed under **AGPL-3.0-only**. See [LICENSE](LICENSE), [NOTICE](NOTICE), and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for details and third-party attributions (including Maia-3, Stockfish, and chessground).
