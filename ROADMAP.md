# Patzer roadmap

A practical, evolving roadmap for the **local-first, on-device** Patzer app. Items are priorities, not promises.

## Now (stabilize v8 foundation)

- **Native engine integration (Android first)**
  - Implement `MaiaNative` (ONNX Runtime Mobile inference) and `StockfishNative` (bundled UCI process) plugins
  - Wire plugin registration, model/binary paths, and packaging
  - Validate end-to-end on device/emulator (download model, play, review, import)
- **Model assets**
  - Re-export and parity-check Maia-3 23M/79M ONNX models (5M already validated)
  - Publish verified assets to the `models` release tag and confirm app/CI configuration (`VITE_MODEL_BASE_URL`)
- **Core product polish**
  - Opening trainer flow improvements (side/start behavior, due-miss review flow)
  - Train puzzle feedback/step progression refinements
  - Game analyzer UX (step controls/progress, clearer Stockfish vs Maia-only review states)
  - Model install/download gating and clearer engine status in UI

## Next

- **Performance and size**
  - Lazy-load ONNX Runtime / engine paths where possible
  - Reduce web bundle impact of ORT/WASM assets for mobile usage patterns
  - Improve analysis responsiveness and cancellation/progress reporting
- **Quality and testing**
  - Add unit tests for featurizer/vocab/sampler parity fixtures, session/rating logic, drills/opening trainer behavior
  - Expand regression coverage for import/review flows
- **iOS support**
  - Add iOS project and equivalent native plugin implementations
  - Validate model storage/inference and Stockfish integration constraints on iOS

## Later

- Optional stronger review tooling (deeper analysis presets, richer insights visualizations)
- Additional local training modes built from personal game history
- Packaging/distribution improvements beyond sideload APK (store readiness, update UX)

## Out of scope (for now)

- Server-hosted accounts, multiplayer, leaderboards, or cloud sync
- LLM/AI coach features requiring external inference services
- Reintroducing multi-language UI before local-first/mobile experience is stable
