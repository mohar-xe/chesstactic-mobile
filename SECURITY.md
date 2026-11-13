# Security policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 8.x (local-first foundation) | ✅ (best effort) |
| < 8.0 | ❌ |

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.

Preferred: use GitHub private vulnerability reporting for this repository (if enabled).  
Alternative: contact the maintainer via the repository owner’s GitHub profile.

Please include:
- A clear description of the issue and impact
- A minimal reproduction or proof of concept (if available)
- Affected platform(s): web, Android/Capacitor, iOS/Capacitor
- Any relevant version/commit information

We aim to acknowledge reports promptly and coordinate a fix and disclosure timeline based on severity.

## Scope notes (local-first app)

Patzer v8 is primarily a local, on-device application (no hosted backend in this repository). Security-relevant areas include:

- **Local data handling:** games, analysis, ratings, drills, and progress stored on-device (IndexedDB/device storage)
- **Import/parsing:** PGN and remote game imports (Chess.com/Lichess) and untrusted input handling
- **Model downloads:** integrity/availability expectations for downloaded ONNX assets and update/source configuration
- **Web rendering:** XSS or unsafe rendering in UI/components
- **Mobile packaging/plugins:** Capacitor plugin boundaries, native process spawning (e.g. Stockfish UCI), file access, and permission use

## Out of scope / environment-dependent

- Compromise of the user’s device/OS, rooted/jailbroken environments, or malicious local apps with device access
- Issues caused by modified third-party model binaries/assets obtained from untrusted sources outside documented release locations
- Misconfiguration of external services/accounts the user explicitly connects to for imports (unless caused by a Patzer vulnerability)
