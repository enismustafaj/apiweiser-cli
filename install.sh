#!/usr/bin/env sh
# Installs apiweiser-cli globally, and sets up the Codemod CLI's AI skill
# for whichever coding agent (Claude Code or Codex) is on PATH - user-scoped,
# not project-scoped, since a globally-installed CLI has no "project" of
# its own to scope it to (see docs/change-requests.md).
set -e

echo "Installing apiweiser-cli..."
npm install -g apiweiser-cli

if command -v claude >/dev/null 2>&1; then
  agent=claude
elif command -v codex >/dev/null 2>&1; then
  agent=codex
else
  echo "Warning: neither 'claude' nor 'codex' found on PATH - skipping codemod skill setup." >&2
  echo "Install one of them, then run:" >&2
  echo "  npx codemod ai --harness <claude|codex> --user --no-interactive" >&2
  agent=""
fi

if [ -n "$agent" ]; then
  echo "Installing the codemod skill for $agent (user-scoped)..."
  npx --yes codemod ai --harness "$agent" --user --no-interactive
fi

echo ""
echo "Done. Run 'apiweiser-cli --path <repo>' once to create"
echo "~/.apiweiser-cli/config.json, fill it in, and you're ready."
