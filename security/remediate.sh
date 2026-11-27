#!/usr/bin/env bash
# Daily job: scan both images, keep one issue with the findings, refresh the pinned base images, and
# accept the refresh only when both architectures still pass the smoke test and the scan.
# Sets candidate=true in $GITHUB_OUTPUT when the Dockerfile or .nvmrc changed and passed.
set -euo pipefail
cd "$(dirname "$0")/.."
# The first interpreter that really runs: on Windows, python3 can be a Store stub that does nothing.
py=$(for c in python3 python; do "$c" -c "import sys" >/dev/null 2>&1 && { echo "$c"; break; }; done)
report=$(mktemp)
baseline=$(mktemp)
mkdir -p security-results
for arch in amd64 arm64; do
  bash security/check-image.sh "$arch" >>"$report" 2>&1 || true
  test -s "security-results/$arch.json" || { tail -n 30 "$report"; exit 1; }
  "$py" security/check_findings.py "security-results/$arch.json" >>"$baseline" || true
done
sort -u -o "$baseline" "$baseline"  # the amd64 and arm64 reports repeat most findings
if [ -s "$baseline" ]; then
  bash security/upsert-issue.sh "$baseline"
fi
"$py" security/refresh_base.py
git diff --quiet -- docker/Dockerfile .nvmrc && exit 0
for arch in amd64 arm64; do
  if ! bash security/check-image.sh "$arch"; then
    echo 'Candidate rejected by image smoke test or rescan.' >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
    exit 1
  fi
done
echo 'candidate=true' >> "${GITHUB_OUTPUT:-/dev/null}"
