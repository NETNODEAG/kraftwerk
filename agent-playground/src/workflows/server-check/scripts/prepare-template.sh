set -euo pipefail
[ -n "${WORKFLOW_DIR:-}" ] || { echo "WORKFLOW_DIR not set — framework too old?" >&2; exit 1; }
cp "$WORKFLOW_DIR/templates/report.html" report_template.html
echo "report_template.html staged"
