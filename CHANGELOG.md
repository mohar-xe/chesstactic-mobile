# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- Refactored the project from a server-backed multi-user web app into a **local-first, on-device chess trainer** foundation (v8 direction).
- Replaced server/API-dependent flows with local storage (IndexedDB/device storage), local game/analysis modules, and on-device engine scaffolding.
- Rewrote the web app shell and core pages (Play, Review, Analyzer, Insights, Train, Openings, Learn, Models, Settings) to run without a backend.
- Updated build/test configuration for a web-only workspace (`web/`) and Vitest tests under `web/src`.
- Reworked CI for web checks and added mobile/model-asset workflow scaffolds.
- Re-licensed the project to **AGPL-3.0-only** and refreshed `NOTICE`, `README.md`, and `THIRD_PARTY_NOTICES.md`.

### Added
- Maia-3 ONNX export and parity-check tooling in `tools/export-maia3-onnx/`.
- Capacitor configuration and generated Android project scaffold.
- Local Maia/Stockfish engine abstractions, model catalog/download management, game session, rating, review/import, drills, and opening trainer modules.
- Stockfish Android build helper script stub (`tools/build-stockfish-android.sh`).

### Removed
- Hono server, database/auth/admin/PvP/coach/email/invite/SSO/server-side analysis and related deployment/docs/scripts.
- Non-English locale bundles and server-era pages/tests/assets no longer applicable to the local-first app.

### Notes
- Native `MaiaNative`/`StockfishNative` plugin implementations, full mobile packaging/signing validation, 23M/79M model export parity artifacts, and additional product polish remain in progress.
