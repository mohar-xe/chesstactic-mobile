# Third-party notices

Patzer is licensed under the **GNU Affero General Public License v3.0** (see [LICENSE](LICENSE) and [NOTICE](NOTICE)).

This application is a local-first, on-device chess trainer that combines original code with third-party software, assets, data, and models. The notices below highlight components whose licenses or attribution requirements are especially relevant to redistribution.

## Maia-3 models and reference implementation (AGPL-3.0)

- Upstream: <https://github.com/CSSLab/maia3>
- Project: Maia-3 / CSSLab

Patzer uses Maia-3 for human-like, rating-conditioned move prediction. ONNX exports, model weights, and any derived model artifacts distributed with Patzer must comply with the upstream license and attribution requirements. When redistributing the app or model assets, preserve attribution to CSSLab/Maia-3 and make corresponding source available as required by AGPL-3.0.

## Stockfish (GPLv3)

- Upstream: <https://stockfishchess.org/> / <https://github.com/official-stockfish/Stockfish>

Stockfish is used for ground-truth engine analysis/review. On Android, a Stockfish binary may be bundled and invoked as a separate UCI process by a native plugin. Redistributing a package that includes Stockfish requires compliance with the GNU GPL v3 (including providing corresponding source and license notices for the distributed binary).

## chessground (GPL-3.0)

- Upstream: <https://github.com/lichess-org/chessground>

The UI uses `chessground` for board rendering and interaction. `chessground` is licensed under GPL-3.0, which is compatible with AGPL-3.0 distribution of the combined work, but redistributors must still comply with its license terms.

## ONNX Runtime (`onnxruntime-web`) (MIT)

- Upstream: <https://github.com/microsoft/onnxruntime>

Used for browser/WASM fallback inference of Maia-3 models. See the upstream project for its full license and third-party notices.

## Board move sounds (CC0)

`web/src/assets/sounds/board-move.wav` and `board-capture.wav` are derived from [“Chess Pieces Move (Close)”](https://freesound.org/people/JJTaynos/sounds/733927/) by **JJTaynos** on Freesound, released under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).

## Lichess puzzle/learn content sources (CC0 where applicable)

Some Learn/Train content is derived from the [Lichess puzzle database](https://database.lichess.org/#puzzles), which is released under [CC0](https://creativecommons.org/publicdomain/zero/1.0/). Original lesson text and curation in this repository remain part of Patzer unless otherwise noted.

## Other notable dependencies

| Package | License |
| --- | --- |
| `react`, `react-dom` | MIT |
| `chess.js` | BSD-2-Clause |
| `chessground` | GPL-3.0 |
| `onnxruntime-web` | MIT |
| `@capacitor/*` | MIT |
| `i18next`, `react-i18next` | MIT |
| `zustand` | MIT |
| `vite` | MIT |
| `tailwindcss` | MIT |
| `lucide-react` | ISC |
| `framer-motion` | MIT |
| `@tanstack/react-query` | MIT |

This file is not exhaustive. For a full transitive inventory, inspect `package-lock.json` and run a license audit tool (for example, `npx license-checker --production`) for the specific release you distribute.
