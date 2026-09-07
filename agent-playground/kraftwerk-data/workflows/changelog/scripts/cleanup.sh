#!/usr/bin/env bash
# Phase "cleanup": drop the cloned repository from the run directory — it is
# only working material; the artifacts that stay are commits.json,
# changelog.json/md/html and the trace.
set -u

rm -rf "$RUN_DIR/repo"

printf '```json\n{"phase":"%s","status":"ok","artifacts":[],"summary":"Removed repo/ from the run directory"}\n```\n' "$PHASE"
