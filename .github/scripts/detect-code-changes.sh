#!/usr/bin/env bash
# Detect whether a push contains code changes or only docs/assets.
# Expensive CI jobs (typecheck, test, build) are skipped for docs-only changes.
set -euo pipefail

base_sha="${1:?base commit required}"
head_sha="${2:?head commit required}"

# Handle initial commit (all zeros).
if [[ "$base_sha" =~ ^0+$ ]]; then
  base_sha="$(git hash-object -t tree /dev/null)"
fi

# Ensure comparison commits are available even with shallow clones.
for sha in "$base_sha" "$head_sha"; do
  if ! git cat-file -e "$sha^{commit}" 2>/dev/null && ! git cat-file -e "$sha^{tree}" 2>/dev/null; then
    git fetch --no-tags --depth=1 origin "$sha"
  fi
done

is_docs_only_path() {
  local path="$1"
  case "$path" in
    *.md | docs/* | assets/* | LICENSE | .cursor/*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

code_changed=false
while IFS= read -r path; do
  [[ -z "$path" ]] && continue
  if ! is_docs_only_path "$path"; then
    code_changed=true
    break
  fi
done < <(git diff --name-only --no-renames "$base_sha" "$head_sha")

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  echo "code_changed=$code_changed" >> "$GITHUB_OUTPUT"
fi

if [[ "$code_changed" == "true" ]]; then
  echo "Code changes detected; expensive CI jobs should run."
else
  echo "Only docs/assets/metadata changes detected; expensive CI jobs can be skipped."
fi
