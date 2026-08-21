#!/usr/bin/env bash
# Push the generated formula to the Homebrew tap, so that
# `brew install billyvg/tap/sentry-tui` picks up this release.
#
# Needs GH_TOKEN to be a token with write access to the tap repository —
# the default GITHUB_TOKEN only covers this repository.
set -euo pipefail

: "${GH_TOKEN:?GH_TOKEN is not set}"
: "${VERSION:?VERSION is not set}"

TAP_REPO="${HOMEBREW_TAP_REPO:-billyvg/homebrew-tap}"
FORMULA="dist/homebrew/sentry-tui.rb"

[ -f "$FORMULA" ] || {
  echo "::error::$FORMULA does not exist — run bun run build:formula first"
  exit 1
}

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "==> cloning $TAP_REPO"
git clone --depth 1 "https://x-access-token:${GH_TOKEN}@github.com/${TAP_REPO}.git" "$work/tap"

mkdir -p "$work/tap/Formula"
cp "$FORMULA" "$work/tap/Formula/sentry-tui.rb"

cd "$work/tap"

if git diff --quiet -- Formula/sentry-tui.rb; then
  echo "Formula already up to date for v${VERSION}; nothing to push."
  exit 0
fi

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add Formula/sentry-tui.rb
git commit -m "sentry-tui ${VERSION}"
git push

echo "Pushed sentry-tui ${VERSION} to ${TAP_REPO}."
