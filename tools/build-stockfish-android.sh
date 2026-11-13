#!/usr/bin/env bash
set -euo pipefail

# Build Stockfish for Android (arm64-v8a) and place it where the Android app/plugin can bundle it.
#
# Prerequisites:
#   - Android NDK installed (set ANDROID_NDK_HOME or NDK_HOME)
#   - git, make, clang toolchain from NDK
#
# This is a scaffold script. Verify Stockfish version, target ABI(s), and output path
# against the StockfishNative plugin implementation before using in CI.

NDK="${ANDROID_NDK_HOME:-${NDK_HOME:-}}"
if [[ -z "$NDK" ]]; then
  echo "error: set ANDROID_NDK_HOME (or NDK_HOME) to your Android NDK path" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WORK_DIR="${WORK_DIR:-$ROOT_DIR/.tmp/stockfish-android}"
STOCKFISH_REPO="${STOCKFISH_REPO:-https://github.com/official-stockfish/Stockfish.git}"
STOCKFISH_REF="${STOCKFISH_REF:-sf_17.1}"
ABI="${ABI:-arm64-v8a}"
API_LEVEL="${API_LEVEL:-24}"
OUT_DIR="${OUT_DIR:-$ROOT_DIR/android/app/src/main/jniLibs/$ABI}"

mkdir -p "$WORK_DIR" "$OUT_DIR"

if [[ ! -d "$WORK_DIR/Stockfish/.git" ]]; then
  git clone --depth 1 --branch "$STOCKFISH_REF" "$STOCKFISH_REPO" "$WORK_DIR/Stockfish"
fi

TOOLCHAIN="$NDK/toolchains/llvm/prebuilt/linux-x86_64"
case "$ABI" in
  arm64-v8a) TARGET="aarch64-linux-android${API_LEVEL}"; ARCH="armv8" ;;
  armeabi-v7a) TARGET="armv7a-linux-androideabi${API_LEVEL}"; ARCH="armv7" ;;
  x86_64) TARGET="x86_64-linux-android${API_LEVEL}"; ARCH="x86-64" ;;
  *) echo "unsupported ABI: $ABI" >&2; exit 1 ;;
esac

export PATH="$TOOLCHAIN/bin:$PATH"
export CC="${TARGET}-clang"
export CXX="${TARGET}-clang++"

cd "$WORK_DIR/Stockfish/src"
make clean >/dev/null 2>&1 || true
make -j"$(nproc)" build ARCH="$ARCH" COMP=clang

cp stockfish "$OUT_DIR/libstockfish.so"
echo "Built Stockfish ($STOCKFISH_REF, $ABI) -> $OUT_DIR/libstockfish.so"
