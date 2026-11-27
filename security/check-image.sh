#!/usr/bin/env bash
# Build one architecture, smoke test it, scan it with Trivy (vulnerabilities and secrets) and write
# its SBOM. Fails on a fixable HIGH or CRITICAL vulnerability or any secret (see check_findings.py).
# Usage: bash security/check-image.sh <amd64|arm64>
set -euo pipefail
export MSYS_NO_PATHCONV=1 # Git Bash on Windows must not rewrite container paths
cd "$(dirname "$0")/.."
arch=${1:?architecture required}
# The first interpreter that really runs: on Windows, python3 can be a Store stub that does nothing.
py=$(for c in python3 python; do "$c" -c "import sys" >/dev/null 2>&1 && { echo "$c"; break; }; done)
trivy=aquasec/trivy:0.76.2@sha256:8f6bb947dbc528902e11f2f5be52f7b519f6a39d5d148f41166f2040499768fb
image="ai-watch-web-ci:$arch"
results=security-results
mkdir -p "$results"
rm -f "$results/$arch.json" "$results/sbom-$arch.cdx.json"
docker build --platform "linux/$arch" -f docker/Dockerfile -t "$image" .
bash security/smoke.sh "$image" "$arch"
docker save "$image" -o "$results/$arch.tar"
mount=$PWD/$results
if command -v cygpath >/dev/null 2>&1; then mount=$(cygpath -m "$mount"); fi
docker run --rm -v "$mount:/scan" "$trivy" image --input "/scan/$arch.tar" \
    --scanners vuln,secret --severity HIGH,CRITICAL --format json --output "/scan/$arch.json"
docker run --rm -v "$mount:/scan" "$trivy" image --input "/scan/$arch.tar" \
    --format cyclonedx --output "/scan/sbom-$arch.cdx.json"
rm -f "$results/$arch.tar"
"$py" security/check_findings.py "$results/$arch.json"
