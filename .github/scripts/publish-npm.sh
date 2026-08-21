#!/usr/bin/env bash
# Publish everything under dist/npm to the public registry.
#
# Order matters: the platform packages go first so the launcher's optional
# dependencies resolve the moment it lands, and the unscoped alias goes last
# because it depends on the launcher.
set -euo pipefail

: "${NPM_TOKEN:?NPM_TOKEN is not set — add it as a repository secret}"

NPM_DIR="dist/npm"
[ -d "$NPM_DIR" ] || {
  echo "::error::$NPM_DIR does not exist — run bun run build:npm first"
  exit 1
}

npmrc="$(mktemp)"
trap 'rm -f "$npmrc"' EXIT
printf '//registry.npmjs.org/:_authToken=%s\n' "$NPM_TOKEN" > "$npmrc"
export NPM_CONFIG_USERCONFIG="$npmrc"

publish() {
  local dir="$1" name
  name="$(node -p "require('./${dir}/package.json').name")"

  if [ ! -d "$dir" ]; then
    echo "::error::expected package directory $dir"
    exit 1
  fi

  echo "==> publishing $name"
  # --provenance ties the tarball to this workflow run; it needs the id-token
  # permission the release job grants.
  npm publish "$dir" --access public --provenance
}

# Platform packages, then the launcher, then the alias.
for dir in "$NPM_DIR"/billyvg-sentry-tui-*; do
  publish "$dir"
done

publish "$NPM_DIR/billyvg-sentry-tui"
publish "$NPM_DIR/sentry-tui"

echo "Published $(ls -d "$NPM_DIR"/*/ | wc -l | tr -d ' ') packages."
