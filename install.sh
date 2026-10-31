#!/usr/bin/env sh
# Installs apiweiser-cli globally, then the upgrade-dependency and Codemod skills for
# whichever coding agent (Claude Code or Codex) is on PATH - user-scoped,
# since a globally-installed CLI has no "project" of its own to scope it to
# (see docs/codemods.md). `apiweiser-cli skill install` does the
# skill part, so an `npm install -g` user can run it on its own.
set -e

echo "Installing apiweiser-cli..."
npm install -g apiweiser-cli

echo "Installing the skills..."
apiweiser-cli skill install

echo ""
echo "Done. Ask your agent to upgrade a dependency."
