#!/usr/bin/env bash
# Install sentry-tui from a GitHub Release.
#
#   curl -fsSL https://raw.githubusercontent.com/billyvg/sentry-tui/main/install.sh | bash
#
# Environment:
#   SENTRY_TUI_VERSION      tag to install (default: the latest release)
#   SENTRY_TUI_INSTALL_DIR  where the binary lands (default: ~/.local/bin)
#   SENTRY_TUI_BASE_URL     where releases live (default: github.com/<repo>),
#                           for mirrors and for testing this script
set -euo pipefail

REPO="billyvg/sentry-tui"
INSTALL_DIR="${SENTRY_TUI_INSTALL_DIR:-$HOME/.local/bin}"
BASE_URL="${SENTRY_TUI_BASE_URL:-https://github.com/${REPO}}"

# Global, and cleaned up from a trap: the trap fires after `main` has returned,
# where a `local` would already be out of scope (and fatal under `set -u`).
TMP_DIR=""
cleanup() {
  # `if`, not `[ … ] && …`: a false test as the trap's last command would
  # become the script's exit status under `set -e`.
  if [ -n "$TMP_DIR" ]; then
    rm -rf "$TMP_DIR"
  fi
}
trap cleanup EXIT

err() {
  printf '\033[31merror\033[0m %s\n' "$1" >&2
  exit 1
}

info() {
  printf '\033[36m==>\033[0m %s\n' "$1"
}

need() {
  command -v "$1" >/dev/null 2>&1 || err "this installer needs \`$1\` on your PATH"
}

need uname
need mktemp
need tar

# curl or wget, whichever is here.
if command -v curl >/dev/null 2>&1; then
  fetch() { curl -fsSL "$1" -o "$2"; }
  fetch_stdout() { curl -fsSL "$1"; }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget -qO "$2" "$1"; }
  fetch_stdout() { wget -qO- "$1"; }
else
  err "this installer needs \`curl\` or \`wget\`"
fi

# sha256sum (Linux) or shasum (macOS).
if command -v sha256sum >/dev/null 2>&1; then
  sha256() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then
  sha256() { shasum -a 256 "$1" | cut -d' ' -f1; }
else
  err "this installer needs \`sha256sum\` or \`shasum\` to verify the download"
fi

detect_target() {
  local os arch
  case "$(uname -s)" in
    Darwin) os="darwin" ;;
    Linux) os="linux" ;;
    *) err "unsupported OS $(uname -s). On Windows, use: npx sentry-tui" ;;
  esac

  case "$(uname -m)" in
    x86_64 | amd64) arch="x64" ;;
    arm64 | aarch64) arch="arm64" ;;
    *) err "unsupported architecture $(uname -m)" ;;
  esac

  # Alpine and other musl systems are not covered by these builds yet.
  if [ "$os" = "linux" ] && [ -f /etc/alpine-release ]; then
    err "musl-based Linux is not supported yet — see https://github.com/${REPO}/issues"
  fi

  printf '%s-%s' "$os" "$arch"
}

latest_version() {
  fetch_stdout "https://api.github.com/repos/${REPO}/releases/latest" |
    grep -m1 '"tag_name"' |
    sed -E 's/.*"tag_name" *: *"([^"]+)".*/\1/'
}

main() {
  local target version tag archive url expected actual

  target="$(detect_target)"

  tag="${SENTRY_TUI_VERSION:-$(latest_version)}"
  [ -n "$tag" ] || err "could not determine the latest release of ${REPO}"
  version="${tag#v}"

  TMP_DIR="$(mktemp -d)"

  archive="sentry-tui-${target}.tar.gz"
  url="${BASE_URL}/releases/download/${tag}/${archive}"

  info "downloading sentry-tui ${version} (${target})"
  fetch "$url" "${TMP_DIR}/${archive}" || err "no release asset at ${url}"

  info "verifying checksum"
  fetch "${BASE_URL}/releases/download/${tag}/checksums.txt" "${TMP_DIR}/checksums.txt" ||
    err "release ${tag} has no checksums.txt"
  expected="$(grep " ${archive}\$" "${TMP_DIR}/checksums.txt" | cut -d' ' -f1)"
  [ -n "$expected" ] || err "checksums.txt has no entry for ${archive}"
  actual="$(sha256 "${TMP_DIR}/${archive}")"
  [ "$expected" = "$actual" ] ||
    err "checksum mismatch for ${archive}: expected ${expected}, got ${actual}"

  tar -xzf "${TMP_DIR}/${archive}" -C "$TMP_DIR"
  [ -f "${TMP_DIR}/sentry-tui" ] || err "the archive did not contain a sentry-tui binary"

  mkdir -p "$INSTALL_DIR"
  # Move into place via a temp name in the same directory, so that upgrading
  # while the old binary is running cannot leave a half-written file behind.
  mv "${TMP_DIR}/sentry-tui" "${INSTALL_DIR}/.sentry-tui.new"
  chmod 755 "${INSTALL_DIR}/.sentry-tui.new"
  mv "${INSTALL_DIR}/.sentry-tui.new" "${INSTALL_DIR}/sentry-tui"

  info "installed to ${INSTALL_DIR}/sentry-tui"

  case ":${PATH}:" in
    *":${INSTALL_DIR}:"*)
      printf '\nRun \033[1msentry-tui login\033[0m to get started.\n'
      ;;
    *)
      printf '\n\033[33m%s is not on your PATH.\033[0m Add this to your shell profile:\n\n' "$INSTALL_DIR"
      printf '  export PATH="%s:$PATH"\n\nThen run \033[1msentry-tui login\033[0m.\n' "$INSTALL_DIR"
      ;;
  esac
}

# Guarded so tests can source the script and call individual functions.
# `curl | bash` leaves BASH_SOURCE unset, so this cannot use the usual
# "${BASH_SOURCE[0]}" = "$0" idiom.
if [ -z "${SENTRY_TUI_INSTALL_SH_NO_RUN:-}" ]; then
  main "$@"
fi
