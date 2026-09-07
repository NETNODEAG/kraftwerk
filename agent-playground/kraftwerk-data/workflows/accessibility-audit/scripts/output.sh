#!/usr/bin/env bash
set -u
echo "== Accessibility audit =="
cat summary.txt
echo
echo "Fix list: $RUN_DIR/fixlist.md"
echo "Findings: $RUN_DIR/findings.md"
