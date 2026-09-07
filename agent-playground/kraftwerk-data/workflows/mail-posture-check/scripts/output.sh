#!/usr/bin/env bash
# Prints the summary and where the report is.
set -u
echo "== Mail posture =="
cat summary.txt
echo
echo "Report: $RUN_DIR/report.md"
