#!/bin/bash
# Install from the lockfile when it changed since this checkout's last install (2 Oct 2026: MCP added
# @modelcontextprotocol/sdk and zod, and the gate and live both ran without them). Prints one line when it installs.
# Usage: deps-sync.sh [checkout]   Exit 0: up to date or installed; 1: install failed; 2: installed but the lockfile moved.
cd "${1:-.}" || exit 1
want=$(shasum -a 256 package-lock.json | cut -d' ' -f1)
[ "$want" = "$(cat node_modules/.plcos-lock-sha 2>/dev/null)" ] && exit 0
log="${TMPDIR:-/tmp}/deps-sync.$$.log"
npm install --no-audit --no-fund > "$log" 2>&1 || { echo "deps-sync: npm install failed in $PWD (see $log)"; exit 1; }
git diff --quiet -- package-lock.json || { echo "deps-sync: npm install changed package-lock.json in $PWD; not stamping"; exit 2; }
echo "$want" > node_modules/.plcos-lock-sha
echo "deps-sync: installed the changed lockfile in $PWD"
