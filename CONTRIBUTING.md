# Contributing to Patzer

Thanks for contributing. Patzer is now a **local-first, on-device chess trainer** (Capacitor + React) focused on human-like play, post-game review, and learning from your own games.

## What’s useful right now

- Bug fixes and small, well-scoped improvements
- Test coverage for core local logic (engine featurization/sampling, game/session, analysis/review, storage, drills)
- Mobile/Capacitor integration work (Android/iOS plugins, model/binary packaging, device behavior)
- CI/build/release improvements for web, Android APK, and model assets
- Documentation fixes (setup, architecture, privacy/offline behavior, licensing/attribution)

## Project layout (current)

- `web/` — React 18 + Vite app
  - `web/src/chess/` — chess domain utilities and types
  - `web/src/engine/` — Maia/Stockfish abstractions and model management
  - `web/src/game/` — local game session, difficulty, rating
  - `web/src/analysis/` — review, insights, drills, opening trainer, import
  - `web/src/storage/` — IndexedDB/local profile/progress stores
  - `web/src/pages/` — UI screens
- `tools/export-maia3-onnx/` — Maia-3 ONNX export and parity checks
- `capacitor.config.ts`, `android/` — Capacitor/mobile scaffolding
- `.github/workflows/` — CI, mobile, and model-asset workflows

## Local development

Requirements: Node.js >= 20.11 and npm.

```bash
# On environments where bun shadows node, prefer:
export PATH="$HOME/.local/node/bin:$PATH"

npm install
npm run dev
```

## Checks before opening a PR

```bash
npm run typecheck
npm test
npm run build
```

All checks should pass. Please include tests for bug fixes and non-trivial logic changes when practical.

## Guidelines

- Keep the app **local-first/offline-capable**. Avoid introducing server dependencies unless explicitly discussed.
- Preserve Maia-3 semantics and move legality/analysis correctness when changing engine or review code.
- Be careful with licensing/attribution: this project is AGPL-3.0 and includes/depends on components with important notices (see `LICENSE`, `NOTICE`, `THIRD_PARTY_NOTICES.md`).
- Prefer focused changes and explain device/platform assumptions (browser vs Capacitor Android/iOS) in PR descriptions.
