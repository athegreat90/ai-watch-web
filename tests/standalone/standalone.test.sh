#!/usr/bin/env bash
# Tests compose.standalone.yaml the way a user meets it: copied alone into an empty folder next to a
# secret, with no Dockerfile and no checkout around it. Needs Docker with Compose v2 and an image:
#   docker build -f docker/Dockerfile -t ai-watch-web:test .
#   AI_WATCH_WEB_IMAGE=ai-watch-web:test bash tests/standalone/standalone.test.sh
# Without AI_WATCH_WEB_IMAGE it pulls the published :latest. The AI Watch server is deliberately absent:
# the page must still start, and the data route must answer 502.
set -u

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
port="${STANDALONE_TEST_PORT:-18981}"
project="aiw-standalone-test"
work="$(mktemp -d)"
failed=0

cleanup() {
  (cd "$work" && AI_WATCH_WEB_IMAGE="${AI_WATCH_WEB_IMAGE:-}" UPSTREAM_URL=x docker compose -p "$project" down -v >/dev/null 2>&1)
  rm -rf "$work"
}
trap cleanup EXIT

check() { # check "what" <exit status>
  if [ "$2" -eq 0 ]; then echo "  ok   $1"; else echo "  FAIL $1"; failed=1; fi
}
compose() { (cd "$work" && docker compose -p "$project" "$@"); }
status_of() { curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port$1"; }

# The folder holds this one file and the secret, nothing else.
cp "$here/compose.standalone.yaml" "$work/compose.yaml"
mkdir "$work/secrets" && chmod 700 "$work/secrets"
token="tok-$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
printf '%s' "$token" > "$work/secrets/monitor_key" && chmod 644 "$work/secrets/monitor_key"

echo "the file on its own"
grep -Eq '^\s*(build|dockerfile):' "$work/compose.yaml"; [ $? -ne 0 ]; check "has no build section, so it needs no Dockerfile" $?
out="$(compose config -q 2>&1)"; [ $? -ne 0 ] && printf '%s' "$out" | grep -q 'UPSTREAM_URL'
check "refuses to start without UPSTREAM_URL and says why" $?

echo "the running container"
export UPSTREAM_URL="http://no-such-server.invalid:8765" WEB_HOST_PORT="$port"
compose up -d --wait >/dev/null 2>&1; check "starts and becomes healthy with only this file and the secret" $?
id="$(compose ps -q web)"
[ "$(status_of /healthz)" = "200" ]; check "answers /healthz" $?
[ "$(status_of /)" = "200" ]; check "serves the page" $?
[ "$(status_of /api/status)" = "502" ]; check "answers 502 on the data route when the server is absent" $?
[ "$(docker inspect -f '{{.Config.User}}' "$id")" = "101" ]; check "runs as user 101" $?
[ "$(docker inspect -f '{{.HostConfig.ReadonlyRootfs}}' "$id")" = "true" ]; check "has a read-only root filesystem" $?
[ "$(docker inspect -f '{{.HostConfig.Memory}}' "$id")" = "67108864" ]; check "is limited to 64 MB" $?
[ "$(docker inspect -f '{{range .HostConfig.PortBindings}}{{(index . 0).HostIp}}{{end}}' "$id")" = "127.0.0.1" ]; check "listens on this machine only by default" $?
docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$id" | grep -q "$token"; [ $? -ne 0 ]
check "keeps the token out of the environment" $?

[ "$failed" -eq 0 ] && echo "all checks passed" || echo "FAILED"
exit "$failed"
