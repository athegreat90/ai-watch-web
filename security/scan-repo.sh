#!/usr/bin/env bash
# Scan the repository itself: dependencies (npm audit and Trivy on package-lock.json), committed
# secrets, and misconfigurations in the Dockerfile and compose files.
# Fails on a HIGH or CRITICAL npm advisory, a fixable HIGH or CRITICAL vulnerability, any secret,
# or a HIGH or CRITICAL misconfiguration. Moderate advisories in development tools are reported only.
# Usage: bash security/scan-repo.sh
set -euo pipefail
export MSYS_NO_PATHCONV=1 # Git Bash on Windows must not rewrite container paths
cd "$(dirname "$0")/.."
# The first interpreter that really runs: on Windows, python3 can be a Store stub that does nothing.
py=$(for c in python3 python; do "$c" -c "import sys" >/dev/null 2>&1 && { echo "$c"; break; }; done)
trivy=aquasec/trivy:0.76.2@sha256:8f6bb947dbc528902e11f2f5be52f7b519f6a39d5d148f41166f2040499768fb
results=security-results
mkdir -p "$results"
rm -f "$results/repo.json"

echo "== npm audit (HIGH and above blocks)"
npm audit --audit-level=high

echo "== Trivy: dependencies, secrets, misconfigurations"
mount=$PWD
if command -v cygpath >/dev/null 2>&1; then mount=$(cygpath -m "$mount"); fi
docker run --rm -v "$mount:/src:ro" -v "$mount/$results:/out" "$trivy" fs /src \
    --scanners vuln,secret,misconfig --severity HIGH,CRITICAL \
    --skip-dirs /src/node_modules,/src/dist,/src/.angular,/src/coverage,/src/security-results,/src/e2e/.run,/src/e2e/.results,/src/e2e/.report,/src/.git \
    --format json --output /out/repo.json
"$py" security/check_findings.py "$results/repo.json"
