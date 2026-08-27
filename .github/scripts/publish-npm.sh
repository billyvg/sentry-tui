#!/usr/bin/env bash
# Publish everything under dist/npm to the public registry.
#
# Order matters: the payload and platform packages go first so every launcher
# dependency resolves the moment it lands, and the unscoped alias goes last
# because it depends on the launcher.
#
# Authentication is OIDC — npm trusted publishing. The workflow's
# `id-token: write` permission lets npm match this run against the trusted
# publisher configured on each package, so there is no token to leak and
# nothing for npm's 2FA rules to challenge. That last part is the point: an
# account that requires two-factor auth on writes answers a token publish with
# EOTP, asking for a one-time password that no unattended job can produce.
# Only automation-class tokens are exempt, and "disallow tokens" exempts
# nothing at all. OIDC sidesteps the question rather than trying to satisfy it.
#
# NPM_TOKEN remains an optional fallback for a package with no trusted
# publisher configured yet. Where one is configured, npm prefers OIDC and the
# token goes unread.
set -euo pipefail

NPM_DIR="dist/npm"
REGISTRY="https://registry.npmjs.org"
# Trusted publishing landed in npm 11.5.1. Older npm ignores the OIDC
# environment entirely and looks for a token instead, then fails with a
# missing-auth error that never mentions OIDC — so check rather than guess.
MIN_NPM="11.5.1"

[ -d "$NPM_DIR" ] || {
  echo "::error::$NPM_DIR does not exist — run bun run build:npm first"
  exit 1
}

npm_version="$(npm --version)"
if [ "$(printf '%s\n%s\n' "$MIN_NPM" "$npm_version" | sort -V | head -1)" != "$MIN_NPM" ]; then
  echo "::error::npm $npm_version is too old for trusted publishing — needs $MIN_NPM or later"
  exit 1
fi

if [ -n "${NPM_TOKEN:-}" ]; then
  echo "npm $npm_version — OIDC, falling back to NPM_TOKEN where no trusted publisher is set"
  npmrc="$(mktemp)"
  trap 'rm -f "$npmrc"' EXIT
  printf '//registry.npmjs.org/:_authToken=%s\n' "$NPM_TOKEN" > "$npmrc"
  export NPM_CONFIG_USERCONFIG="$npmrc"
else
  echo "npm $npm_version — OIDC only, no token configured"
fi

publish() {
  local dir="$1" name version published log

  if [ ! -d "$dir" ]; then
    echo "::error::expected package directory $dir"
    exit 1
  fi

  name="$(node -p "require('./${dir}/package.json').name")"
  version="$(node -p "require('./${dir}/package.json').version")"

  # Seven uploads, and a release that dies partway leaves some of
  # them on the registry. Skipping what already landed lets a re-run finish the
  # job instead of failing on "cannot publish over the previously published
  # version" — the same reasoning as the local path in scripts/release.ts.
  published="$(npm view "$name@$version" version --registry "$REGISTRY" 2>/dev/null || true)"
  if [ "$published" = "$version" ]; then
    echo "==> $name@$version is already published — skipping"
    return 0
  fi

  echo "==> publishing $name@$version"
  log="$(mktemp)"
  # --provenance ties the tarball to this workflow run. Under OIDC npm attests
  # automatically and the flag is redundant, but it is also what makes the
  # token fallback produce provenance, so it stays on both paths.
  if ! npm publish "$dir" --access public --provenance --registry "$REGISTRY" 2>&1 | tee "$log"; then
    if grep -q "EOTP" "$log"; then
      echo "::error::$name asked for a one-time password, which CI cannot supply. \
Configure a trusted publisher for it on npmjs.com (Settings → Trusted publishing: \
repository billyvg/sentry-tui, workflow release.yml), or replace NPM_TOKEN with an \
automation-class token. See docs/releasing.md."
    fi
    rm -f "$log"
    exit 1
  fi
  rm -f "$log"
}

# Payload and platform packages, then the launcher, then the alias.
for dir in "$NPM_DIR"/billyvg-sentry-tui-*; do
  publish "$dir"
done

publish "$NPM_DIR/billyvg-sentry-tui"
publish "$NPM_DIR/sentry-tui"

echo "Published $(ls -d "$NPM_DIR"/*/ | wc -l | tr -d ' ') packages."
