#!/usr/bin/env bash
# Turn the per-target binaries in dist/bin/ into the GitHub Release assets:
# one archive per platform plus a checksums.txt the installer and the Homebrew
# formula both read.
set -euo pipefail

BIN_DIR="dist/bin"
OUT_DIR="dist/release"

[ -d "$BIN_DIR" ] || {
  echo "::error::$BIN_DIR does not exist — were the build artifacts downloaded?"
  exit 1
}

mkdir -p "$OUT_DIR"
rm -f "${OUT_DIR:?}"/*

for dir in "$BIN_DIR"/*/; do
  target="$(basename "$dir")"

  if [ ! -f "${dir}sentry-tui" ]; then
    echo "::error::no sentry-tui binary in ${dir}"
    exit 1
  fi

  # Artifact download does not preserve the executable bit, so set it here —
  # this is the mode that ends up in the tarball users extract.
  chmod 755 "${dir}sentry-tui"
  tar -czf "${OUT_DIR}/sentry-tui-${target}.tar.gz" -C "$dir" sentry-tui
  echo "packaged sentry-tui-${target}.tar.gz"
done

# Bare filenames, so the entries match what install.sh and the formula ask for.
# `shasum` keeps this runnable on macOS, where there is no sha256sum.
(
  cd "$OUT_DIR"
  shopt -s nullglob
  if command -v sha256sum > /dev/null 2>&1; then
    sha256sum sentry-tui-*.tar.gz > checksums.txt
  else
    shasum -a 256 sentry-tui-*.tar.gz > checksums.txt
  fi
)

echo
echo "Release assets:"
ls -lh "$OUT_DIR"
echo
cat "${OUT_DIR}/checksums.txt"
