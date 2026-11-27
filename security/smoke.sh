#!/usr/bin/env bash
# Smoke test of a built image under the same restrictions as production: non-root, read-only root
# filesystem, no capabilities, no-new-privileges, the key mounted read-only as a secret file.
# Usage: bash security/smoke.sh <image> <amd64|arm64>
set -euo pipefail
export MSYS_NO_PATHCONV=1 # Git Bash on Windows must not rewrite container paths
image=${1:?image required}
arch=${2:?architecture required}
name="aiw-smoke-$arch-$$"
token=example-fixture-token-only-0000000000
fixture=$(mktemp)
chmod 644 "$fixture"
printf '%s' "$token" > "$fixture"
source=$fixture
# Git Bash on Windows: Docker Desktop needs a Windows-style path for the bind mount source.
if command -v cygpath >/dev/null 2>&1; then source=$(cygpath -m "$fixture"); fi
trap 'docker rm -f "$name" >/dev/null 2>&1 || true; rm -f "$fixture"' EXIT

# No server behind it: the point is the container, so the upstream is a closed port.
docker run --rm --platform "linux/$arch" -d --name "$name" -p 127.0.0.1::8080 \
    -e UPSTREAM_URL=http://127.0.0.1:9 --user 101:101 --read-only --tmpfs /tmp:size=16m,mode=1777 \
    --cap-drop ALL --security-opt no-new-privileges:true \
    --mount "type=bind,source=$source,target=/run/secrets/monitor_key,readonly" "$image" >/dev/null
port=$(docker port "$name" 8080/tcp | awk -F: 'NR == 1 { print $NF }')
base="http://127.0.0.1:$port"

curl -fsS --retry 20 --retry-all-errors --retry-delay 1 "$base/healthz" >/dev/null
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
fail() { echo "smoke FAILED ($arch): $*" >&2; docker logs "$name" 2>&1 | tail -n 20 >&2; exit 1; }

[ "$(code "$base/")" = 200 ] || fail "the page did not load"
curl -fsS "$base/" | grep -q '<app-root' || fail "the page is not the app"
[ "$(code "$base/dashboard")" = 200 ] || fail "a deep link did not fall back to the app"
[ "$(code "$base/api/status")" = 502 ] || fail "/api/status should be 502 with no server behind it"
[ "$(code -X POST "$base/api/status")" = 405 ] || fail "POST must be refused"
[ "$(code -X POST "$base/api/events")" = 404 ] || fail "a write route must be closed"
curl -sI "$base/" | grep -qi "^content-security-policy: default-src 'none'" || fail "no Content-Security-Policy"
[ "$(docker exec "$name" id -u)" = 101 ] || fail "not running as user 101"

# The key must be in the secret file and in the rendered config only. Never in an answer or a log.
if { curl -s -D - "$base/config.json" "$base/api/status" "$base/"; docker logs "$name" 2>&1; } | grep -q "$token"; then
    fail "the key leaked into a response or the logs"
fi
docker exec "$name" wget -q -O /dev/null http://127.0.0.1:8080/healthz || fail "the in-container health check failed"
echo "smoke ok ($arch)"
