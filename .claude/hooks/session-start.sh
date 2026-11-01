#!/bin/bash
# SessionStart hook for Claude Code cloud sessions: puts the Node that .node-version names on PATH
# and installs the dependencies, so `npm run check` works without further setup.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

# The Node is the release that scripts/node-runtime.json pins for packaged builds, which is also a
# release of the .node-version; the download is checked against the SHA-256 pinned there.
# package.json's devEngines makes npm refuse any other Node, so this must be on PATH before npm runs.
pin=scripts/node-runtime.json
version=$(sed -n 's/^ *"version": *"\([0-9][0-9.]*\)".*/\1/p' "$pin")
sha256=$(sed -n 's/^ *"linux-x64": *"\([0-9a-f]\{64\}\)".*/\1/p' "$pin")
if [ -z "$version" ] || [ -z "$sha256" ]; then
  echo "session-start: no version or linux-x64 checksum found in $pin" >&2
  exit 1
fi

if [ "$(uname -s)-$(uname -m)" != "Linux-x86_64" ]; then
  echo "session-start: $pin pins Node only for linux-x64; install Node $(cat .node-version) yourself" >&2
  exit 0
fi

name="node-v$version-linux-x64"
node_home="$HOME/.local/share/beuve-node/$name"
if [ "$("$node_home/bin/node" --version 2>/dev/null || true)" != "v$version" ]; then
  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT
  curl -fsSL --retry 3 --retry-delay 2 -o "$work/$name.tar.xz" \
    "https://nodejs.org/dist/v$version/$name.tar.xz"
  if ! echo "$sha256  $work/$name.tar.xz" | sha256sum --check --status; then
    echo "session-start: $name.tar.xz does not match the SHA-256 pinned in $pin" >&2
    exit 1
  fi
  tar -xJf "$work/$name.tar.xz" -C "$work"
  mkdir -p "$(dirname "$node_home")"
  rm -rf "$node_home"
  mv "$work/$name" "$node_home"
fi
export PATH="$node_home/bin:$PATH"

# Every Bash command in the session needs the same Node.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  path_line="export PATH=\"$node_home/bin:\$PATH\""
  grep -qxF "$path_line" "$CLAUDE_ENV_FILE" 2>/dev/null || echo "$path_line" >> "$CLAUDE_ENV_FILE"
fi

# Run the install only if a listed file has changed since the install last succeeded. `npm ci`
# rather than `npm install`: the lockfile is authoritative (CI installs the same way) and
# `npm install` can rewrite it and leave the working tree dirty. Install scripts must run: they
# compile node-pty on Linux.
hashes=node_modules/.session-start.sha256
if ! sha256sum --check --status "$hashes" 2>/dev/null; then
  # Delete the old hashes first, so a failed install runs again next time.
  rm -f "$hashes"
  npm ci --no-audit --no-fund
  sha256sum .claude/hooks/session-start.sh package.json package-lock.json .node-version \
    "$pin" > "$hashes" || rm -f "$hashes"
fi
