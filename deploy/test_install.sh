#!/usr/bin/env bash
# Tests deploy/ai-watch-web-deploy/install.sh against real Docker, and release/assets.sh on the bundle.
# Needs Docker with Compose, curl and Python. It uses its own project names and random ports, and removes
# everything it starts. The web image must exist as $AIW_TEST_IMAGE_REPO:$AIW_TEST_VERSION, for example:
#   docker build -f docker/Dockerfile --build-arg VERSION=v0.0.1 -t ai-watch-web:v0.0.1 .
# The server image is the one pinned for the end-to-end tests (pulled if missing).
# Usage: bash deploy/test_install.sh
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/.." && pwd)
bundle=$here/ai-watch-web-deploy
repo=${AIW_TEST_IMAGE_REPO:-ai-watch-web}
v1=${AIW_TEST_VERSION:-v0.0.1}
v2=v0.0.2
srv='ghcr.io/athegreat90/ai-watch-server:v1.1.4@sha256:26c92877901a03e8333ea72f31ec1fd7f18fc69f5b3a3068eeac9b153e78c9bd'
py=$(for c in python3 python; do "$c" -c "import sys" >/dev/null 2>&1 && { echo "$c"; break; }; done)

# A backslash and a double quote on purpose: both are escapes in a curl config file.
password='correct horse\ "battery'

fail() { echo "FAIL: $*" >&2; exit 1; }
docker image inspect "$repo:$v1" >/dev/null 2>&1 || fail "the image $repo:$v1 does not exist: build it first (see the top of this file)"
docker image inspect "$srv" >/dev/null 2>&1 || docker pull -q "$srv" >/dev/null

work=$(mktemp -d)
dirs=() ; names=() ; containers=() ; made_tags=() ; http_pid=""
cleanup() {
    local i
    for i in "${!dirs[@]}"; do (cd "${dirs[$i]}" 2>/dev/null && COMPOSE_PROJECT_NAME=${names[$i]} docker compose down -v >/dev/null 2>&1) || true; done
    for i in "${containers[@]:-}"; do [ -z "$i" ] || docker rm -f "$i" >/dev/null 2>&1 || true; done
    for i in "${made_tags[@]:-}"; do [ -z "$i" ] || docker rmi "$i" >/dev/null 2>&1 || true; done
    [ -z "$http_pid" ] || kill "$http_pid" >/dev/null 2>&1 || true
    rm -rf "$work"
}
trap cleanup EXIT

tag_if_missing() { docker image inspect "$1" >/dev/null 2>&1 || { docker tag "$repo:$v1" "$1"; made_tags+=("$1"); }; }
tag_if_missing "$repo:$v2"
tag_if_missing "$repo:latest"

free_port() { "$py" -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()'; }
counter=0
# newdir: a fresh copy of the bundle with its own Compose project name. Sets $cur and $proj.
newdir() {
    counter=$((counter + 1))
    cur=$work/d$counter; proj=aiw-dtest-$$-$counter
    mkdir -p "$cur"; cp -R "$bundle"/. "$cur"/
    dirs+=("$cur"); names+=("$proj")
}
# inst <args>: run the installer in $cur. Output in $out, status in $rc (never stops the test).
inst() {
    set +e
    out=$(cd "$cur" && COMPOSE_PROJECT_NAME=$proj AI_WATCH_IMAGE_REPO=$repo AI_WATCH_SERVER_IMAGE=$srv bash install.sh "$@" 2>&1 < /dev/null)
    rc=$?
    set -e
}
code() { curl -s -o /dev/null -m 10 -w '%{http_code}' "$@"; }
cid() { (cd "$cur" && COMPOSE_PROJECT_NAME=$proj docker compose ps -q web | head -1); }
sum() { sha256sum "$@" | cut -d' ' -f1 | tr '\n' ' '; }
mention() { grep -q -- "$1" <<< "$out" || { echo "$out" >&2; fail "$2 (expected '$1' in the output)"; }; }
refused() { [ "$rc" -ne 0 ] || { echo "$out" >&2; fail "$1: it was accepted"; }; mention "$2" "$1"; }

echo "1. fresh install with the server next to the page and a login"
newdir; web_port=$(free_port); srv_port=$(free_port)
printf '%s' "$password" > "$cur/pw.txt"
inst --version "$v1" --no-pull --with-server --port "$web_port" --server-port "$srv_port" --auth-user bob --auth-password-file pw.txt
[ "$rc" -eq 0 ] || { echo "$out" >&2; fail "the install failed"; }
mention "the server answered and accepted the token" "the end-to-end check did not run"
token=$(sed -n 's/.*"token": *"\([^"]*\)".*/\1/p' "$cur/server/config.local.json")
[ "$(cat "$cur/secrets/monitor_key")" = "$token" ] || fail "the secret is not the server's token"
base=http://127.0.0.1:$web_port
[ "$(code "$base/")" = 401 ] || fail "the page is open without a login"
[ "$(code "$base/healthz")" = 200 ] || fail "healthz must stay open"
[ "$(code -u "bob:wrong" "$base/")" = 401 ] || fail "a wrong password was accepted"
[ "$(code -u "bob:$password" "$base/")" = 200 ] || fail "the right password was refused"
[ "$(code -u "bob:$password" "$base/api/status")" = 200 ] || fail "the page does not reach the server through the proxy"
grep -q '^bob:\$6\$' "$cur/secrets/htpasswd" || fail "the login is not a salted SHA-512 hash"
! grep -qF -- "$password" "$cur/secrets/htpasswd" "$cur/.env" || fail "the password was written in clear text"
! grep -rq "$token" "$cur/.env" || fail "the token is in .env"
! grep -q "$token" <<< "$out" || fail "the token was printed"
leaked=$({ curl -s -u "bob:$password" "$base/config.json" "$base/"; docker inspect "$(cid)" --format '{{json .Config.Env}}'; docker logs "$(cid)" 2>&1; } | grep -c "$token" || true)
[ "$leaked" = 0 ] || fail "the token appears in the page, the config, the environment or the logs"
if [ "$(uname -s)" = Linux ]; then
    [ "$(stat -c %a "$cur/secrets")" = 700 ] || fail "secrets/ is not private (700)"
    [ "$(stat -c %a "$cur/secrets/monitor_key")" = 644 ] || fail "the key is not readable by the container user (644)"
    [ "$(stat -c %a "$cur/.env")" = 600 ] || fail ".env is not 600"
    [ "$(stat -c %a "$cur/server/config.local.json")" = 600 ] || fail "the server config is not 600"
fi
grep -q '^COMPOSE_FILE=compose.yaml:compose.server.yaml:compose.auth.yaml$' "$cur/.env" || fail "COMPOSE_FILE does not list the optional files"
[ "$(cd "$cur" && COMPOSE_PROJECT_NAME=$proj docker compose ps -q | wc -l | tr -d ' ')" = 2 ] || fail "expected the page and the server to run"

echo "2. a rerun with no flags leaves a running deployment alone"
first=$(cid); before=$(sum "$cur/.env" "$cur/secrets/monitor_key" "$cur/secrets/htpasswd" "$cur/server/config.local.json")
inst --no-pull
[ "$rc" -eq 0 ] || { echo "$out" >&2; fail "the rerun failed"; }
mention "already running; leaving it untouched" "the rerun touched the deployment"
[ "$(cid)" = "$first" ] || fail "the container was recreated"
[ "$(sum "$cur/.env" "$cur/secrets/monitor_key" "$cur/secrets/htpasswd" "$cur/server/config.local.json")" = "$before" ] || fail "a rerun changed a setting or a secret"
# A .env saved on Windows has CRLF line ends: the rerun must read it the same way.
cp "$cur/.env" "$work/env.lf"
sed -i 's/$/\r/' "$cur/.env"
inst --no-pull
[ "$rc" -eq 0 ] || { echo "$out" >&2; fail "a .env with CRLF line ends broke the rerun"; }
mention "already running; leaving it untouched" "a .env with CRLF line ends was not understood"
cp "$work/env.lf" "$cur/.env"

echo "3. --update records the previous image and keeps every setting and secret; --force recreates the container"
inst --update --no-pull
[ "$rc" -eq 0 ] || { echo "$out" >&2; fail "--update failed"; }
# Compose recreates a container only when its image or configuration changed, so with nothing new to pull it stays.
[ "$(cid)" = "$first" ] || fail "--update recreated a container that had no new image"
inst --update --force --no-pull
[ "$rc" -eq 0 ] || { echo "$out" >&2; fail "--update --force failed"; }
[ "$(cid)" != "$first" ] || fail "--force did not recreate the container"
# Nothing changed (same image, same configuration), so nothing is history: a rollback must never return to what runs.
[ ! -s "$cur/.deploy-history" ] || fail "an update with nothing new was recorded in the history: $(cat "$cur/.deploy-history")"
[ "$(sum "$cur/.env" "$cur/secrets/monitor_key" "$cur/secrets/htpasswd" "$cur/server/config.local.json")" = "$before" ] || fail "--update changed a setting or a secret"

echo "4. a version, a rollback to the previous image, and a rollback to a named version"
inst --version "$v2" --no-pull
[ "$rc" -eq 0 ] || { echo "$out" >&2; fail "--version failed"; }
grep -q "^AI_WATCH_WEB_IMAGE=$repo:$v2\$" "$cur/.env" || fail "the image is not $v2"
[ "$(wc -l < "$cur/.deploy-history" | tr -d ' ')" = 1 ] || fail "the change of version should be the one history entry"
grep -qE "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]+Z $repo:$v1 " "$cur/.deploy-history" || fail "the history line is malformed: $(cat "$cur/.deploy-history")"
inst --rollback --no-pull
[ "$rc" -eq 0 ] || { echo "$out" >&2; fail "--rollback failed"; }
grep -q "^AI_WATCH_WEB_IMAGE=$repo:$v1\$" "$cur/.env" || fail "--rollback did not return to $v1"
inst --rollback "$v2" --no-pull
[ "$rc" -eq 0 ] || { echo "$out" >&2; fail "--rollback vX failed"; }
grep -q "^AI_WATCH_WEB_IMAGE=$repo:$v2\$" "$cur/.env" || fail "--rollback $v2 did not select it"
[ "$(wc -l < "$cur/.deploy-history" | tr -d ' ')" -ge 3 ] || fail "every change should be in the history"

echo "5. nothing is overwritten: a different token or a second login is refused"
echo "x$(sed -n 's/^//p' "$cur/secrets/monitor_key")yyyyyyyyyyyy" > "$cur/secrets/monitor_key.other"
cp "$cur/secrets/monitor_key" "$cur/secrets/monitor_key.keep"
printf '%s' 'Zz9zZ9zZ9zZ9zZ9zZ9zZ9zZ9zZ9zZ9' > "$cur/secrets/monitor_key"
inst --with-server --no-pull
refused "a key that differs from the server's token" "already holds a different token"
cp "$cur/secrets/monitor_key.keep" "$cur/secrets/monitor_key"
inst --auth-user alice --auth-password-file pw.txt --no-pull
refused "a second login over the first" "secrets/htpasswd already exists"
# ":latest" is a moving tag, so a rollback must use the digest that was recorded, not the tag.
digest_ref="$repo@sha256:$(printf 'a%.0s' $(seq 64))"
echo "2026-01-01T00:00:00Z $repo:latest $digest_ref" >> "$cur/.deploy-history"
inst --rollback --no-pull
grep -q "^AI_WATCH_WEB_IMAGE=$digest_ref\$" "$cur/.env" || { echo "$out" >&2; fail "a rollback from :latest did not use the recorded digest"; }

echo "6. a server that runs elsewhere: the token from a config file, from a plain file, and a wrong one"
srvdir=$work/srv; mkdir -p "$srvdir"
mount=$srvdir; user=(--user "$(id -u):$(id -g)")
if command -v cygpath >/dev/null 2>&1; then mount=$(cygpath -m "$srvdir"); user=(); fi
MSYS_NO_PATHCONV=1 docker run --rm "${user[@]}" --entrypoint /app/ai-watch-server -v "$mount:/cfg" "$srv" init-config --config /cfg/config.local.json >/dev/null
srv_name=aiw-dtest-srv-$$; containers+=("$srv_name")
MSYS_NO_PATHCONV=1 docker run -d --name "$srv_name" "${user[@]}" -p 0.0.0.0::8765 -e MONITOR_BIND=0.0.0.0 --read-only --tmpfs /tmp:size=16m \
    --cap-drop ALL -v "$mount/config.local.json:/app/config.local.json:ro" "$srv" >/dev/null
ext_port=$(docker port "$srv_name" 8765/tcp | awk -F: 'NR == 1 { print $NF }')
for _ in $(seq 30); do curl -fsS -m 2 "http://127.0.0.1:$ext_port/health" >/dev/null 2>&1 && break; sleep 1; done
# Docker Desktop resolves host.docker.internal for the container's Nginx. On Linux Nginx does not read /etc/hosts
# (extra_hosts), so there the server is reached by the address of the Docker bridge, like a user would use a LAN IP.
if docker info --format '{{.OperatingSystem}}' | grep -qi 'docker desktop'; then ext_host=host.docker.internal
else ext_host=$(docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}'); fi
ext_url=http://$ext_host:$ext_port

newdir; p=$(free_port)
inst --version "$v1" --no-pull --server-url "$ext_url" --token-file "$srvdir/config.local.json" --port "$p"
[ "$rc" -eq 0 ] || { echo "$out" >&2; fail "the external server install failed"; }
mention "the server answered and accepted the token" "the check did not run"
[ "$(code "http://127.0.0.1:$p/api/status")" = 200 ] || fail "the page does not reach the external server"
grep -q "^UPSTREAM_URL=$ext_url\$" "$cur/.env" || fail "UPSTREAM_URL was not saved"

newdir; p=$(free_port)
sed -n 's/.*"token": *"\([^"]*\)".*/\1/p' "$srvdir/config.local.json" > "$cur/plain-token.txt"
# A hand-edited .env may end without a newline: the next setting must not be glued to its last line.
printf 'POLL_INTERVAL_MS=' > "$cur/.env"
inst --version "$v1" --no-pull --server-url "$ext_url" --token-file plain-token.txt --port "$p"
[ "$rc" -eq 0 ] || { echo "$out" >&2; fail "a plain token file was refused"; }
grep -q '^POLL_INTERVAL_MS=$' "$cur/.env" || fail "a .env without a final newline was corrupted: $(cat "$cur/.env")"

# The paths the user types are relative to where the command runs, not to --dir.
newdir; p=$(free_port)
cp "$srvdir/config.local.json" "$work/relative-token.json"
set +e
out=$(cd "$work" && COMPOSE_PROJECT_NAME=$proj AI_WATCH_IMAGE_REPO=$repo bash "$cur/install.sh" --dir "$cur" --version "$v1" --no-pull --server-url "$ext_url" --token-file relative-token.json --port "$p" 2>&1 < /dev/null)
rc=$?
set -e
[ "$rc" -eq 0 ] || { echo "$out" >&2; fail "a relative --token-file was not resolved from where the command ran"; }

newdir; p=$(free_port)
printf '%s' 'abcdefghijklmnopqrstuvwxyz012345' > "$cur/wrong.txt"
inst --version "$v1" --no-pull --server-url "$ext_url" --token-file wrong.txt --port "$p"
refused "a token the server does not know" "refused the token"
inst --update --no-pull --no-check
[ "$rc" -eq 0 ] || { echo "$out" >&2; fail "--no-check should skip the server check"; }

echo "7. a server that cannot be reached says so"
newdir; p=$(free_port)
printf '%s' 'abcdefghijklmnopqrstuvwxyz012345' > "$cur/t.txt"
inst --version "$v1" --no-pull --server-url "http://$ext_host:1" --token-file t.txt --port "$p"
refused "an unreachable server" "cannot reach the AI Watch server"

echo "8. wrong input is refused before anything is started"
newdir
inst; refused "no flags on a new folder" "no token yet"
printf '%s' 'short' > "$cur/short.txt"
inst --token-file short.txt --server-url http://h:1; refused "a short token" "not valid"
inst --token-file missing.txt --server-url http://h:1; refused "a missing token file" "not found"
inst --with-server --token-file x; refused "a token file with --with-server" "creates the token itself"
printf '%s' 'abcdefghijklmnopqrstuvwxyz012345' > "$cur/t.txt"
inst --server-url http://h:1 --token-file t.txt --auth-user bob; refused "a login with no terminal and no password file" "no terminal"
printf '%s' 'short' > "$cur/shortpw.txt"
inst --server-url http://h:1 --token-file t.txt --auth-user bob --auth-password-file shortpw.txt; refused "a short password" "at least 8"
inst --rollback; refused "a rollback with no history" "no previous deployment"
inst --bind ::1 --server-url http://h:1 --token-file t.txt; refused "an IPv6 address" "IPv4"
[ ! -s "$cur/secrets/monitor_key" ] || fail "a refused run left a token behind"
[ -z "$(cd "$cur" && COMPOSE_PROJECT_NAME=$proj docker compose ps -q 2>/dev/null)" ] || fail "a refused run started containers"

echo "9. the installer alone downloads the bundle, checks it, and refuses a tampered one"
rel=$work/rel; mkdir -p "$rel/v0.0.1" "$rel/api/releases" "$work/results"
printf '{"bomFormat":"CycloneDX"}' > "$work/results/sbom-amd64.cdx.json"; cp "$work/results/sbom-amd64.cdx.json" "$work/results/sbom-arm64.cdx.json"
# A file an installer run in place would leave next to the bundle must not be packaged.
junk=$bundle/server-junk-left-by-an-in-place-run; echo x > "$junk"
(cd "$root" && RELEASE_TAG=v0.0.1 ASSETS_DIR="$work/dist" RESULTS_DIR="$work/results" bash release/assets.sh >/dev/null) || { rm -f "$junk"; fail "release/assets.sh failed"; }
rm -f "$junk"
cp "$work"/dist/* "$rel/v0.0.1/"
printf '{"tag_name": "v0.0.1"}' > "$rel/api/releases/latest"
list=$("$py" -m zipfile -l "$work/dist/ai-watch-web-deploy-v0.0.1.zip")
! grep -q "junk" <<< "$list" || fail "a file left in the bundle folder by an installer run in place ended up in the zip"
if [ "$(uname -s)" = Linux ]; then
    mode=$("$py" -c 'import sys,zipfile; print(oct(zipfile.ZipFile(sys.argv[1]).getinfo("ai-watch-web-deploy/install.sh").external_attr >> 16 & 0o777))' "$work/dist/ai-watch-web-deploy-v0.0.1.zip")
    [ "$mode" = 0o755 ] || fail "install.sh is not executable in the zip (mode $mode)"
fi
for f in compose.yaml compose.server.yaml compose.auth.yaml env.example install.sh README.md VERSION; do
    grep -q "ai-watch-web-deploy/$f" <<< "$list" || fail "the bundle lacks $f"
done
[ "$(grep -c 'sbom_' "$work/dist/SHA256SUMS")" = 2 ] || fail "SHA256SUMS does not cover both SBOMs"
http_port=$(free_port)
"$py" -m http.server "$http_port" --bind 127.0.0.1 --directory "$rel" >/dev/null 2>&1 &
http_pid=$!
for _ in $(seq 20); do curl -fsS -m 2 "http://127.0.0.1:$http_port/api/releases/latest" >/dev/null 2>&1 && break; sleep 0.5; done
export AI_WATCH_RELEASE_BASE=http://127.0.0.1:$http_port AI_WATCH_RELEASE_API=http://127.0.0.1:$http_port/api

newdir; p=$(free_port); rm -rf "$cur"; mkdir -p "$cur"; cp "$bundle/install.sh" "$cur/"
inst --no-pull --with-server --port "$p" --server-port "$(free_port)"
[ "$rc" -eq 0 ] || { echo "$out" >&2; fail "the installer alone could not install"; }
mention "downloading the deployment bundle" "it did not download the bundle"
[ -f "$cur/compose.yaml" ] && [ -f "$cur/compose.server.yaml" ] || fail "the bundle was not extracted"
grep -q "^AI_WATCH_WEB_IMAGE=$repo:latest\$" "$cur/.env" || fail "without --version the image should be :latest"

cp "$work/dist/ai-watch-web-deploy-v0.0.1.zip" "$work/good.zip"
printf 'tampered' >> "$rel/v0.0.1/ai-watch-web-deploy-v0.0.1.zip"
newdir; rm -rf "$cur"; mkdir -p "$cur"; cp "$bundle/install.sh" "$cur/"
inst --no-pull --with-server --version v0.0.1
refused "a tampered bundle" "checksum mismatch"
[ ! -f "$cur/compose.yaml" ] || fail "a bundle that failed its checksum was extracted"
cp "$work/good.zip" "$rel/v0.0.1/ai-watch-web-deploy-v0.0.1.zip"
unset AI_WATCH_RELEASE_BASE AI_WATCH_RELEASE_API

echo "deploy: ok"
