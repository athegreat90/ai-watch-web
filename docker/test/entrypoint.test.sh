#!/usr/bin/env bash
# Tests for docker/entrypoint.sh. They run it with AIW_NO_EXEC=1 and a scratch directory, so no
# Nginx and no container are needed:   bash docker/test/entrypoint.test.sh
set -u

here=$(cd "$(dirname "$0")" && pwd)
entry="$here/../entrypoint.sh"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

GOOD=abcdefghijklmnopqrstuvwxyz012345
passed=0
failed=0
out="$work/out"
err="$work/err"

check() { # name, condition result (0 = ok)
  if [ "$2" -eq 0 ]; then passed=$((passed + 1)); else failed=$((failed + 1)); echo "FAIL: $1"; fi
}

# run <key-file-content> [VAR=value ...]  -> runs the entrypoint in a fresh scratch dir
run() {
  local content="$1"
  shift
  rm -rf "$work/rt" "$work/key"
  printf '%s' "$content" >"$work/key"
  env -i PATH="$PATH" AIW_NO_EXEC=1 AIW_RUNTIME_DIR="$work/rt" MONITOR_KEY_FILE="$work/key" \
    HTPASSWD_FILE="$work/none" "$@" sh "$entry" >"$out" 2>"$err"
}

ok() { run "$@"; }
rejects() { # name content [env...]  -> must exit non-zero, write nothing, and not print the key
  local name="$1" content="$2"
  shift 2
  run "$content" "$@"
  local code=$?
  [ "$code" -ne 0 ]; check "$name: exits with an error" $?
  [ ! -e "$work/rt/runtime.conf" ]; check "$name: writes no configuration" $?
  if [ -n "$content" ]; then ! grep -qF -- "$content" "$out" "$err"; check "$name: does not print the value" $?; fi
}

# --- a good start -------------------------------------------------------------------------
ok "$GOOD"; check "good key starts" $?
grep -q "default \"$GOOD\"" "$work/rt/runtime.conf"; check "the key is in runtime.conf" $?
grep -q 'default "ai-watch-server:8765"' "$work/rt/runtime.conf"; check "the default server address" $?
grep -q '^resolver ' "$work/rt/runtime.conf"; check "a resolver line" $?
[ "$(cat "$work/rt/config.json")" = '{}' ]; check "no default interval gives {}" $?
grep -q 'No login' "$work/rt/auth.conf"; check "no password file means no login" $?
! grep -qF "$GOOD" "$out" "$err"; check "a good start does not print the key" $?
case "$(uname -s)" in
  MINGW* | MSYS* | CYGWIN*) ;; # permissions do not mean much on Windows
  *) [ "$(stat -c %a "$work/rt/runtime.conf")" = "600" ]; check "runtime.conf is readable only by its owner" $? ;;
esac

ok "$GOOD
"; check "a trailing newline is trimmed" $?
printf '%s\r\n' "$GOOD" >"$work/key"
env -i PATH="$PATH" AIW_NO_EXEC=1 AIW_RUNTIME_DIR="$work/rt2" MONITOR_KEY_FILE="$work/key" HTPASSWD_FILE="$work/none" sh "$entry" >"$out" 2>"$err"
check "a Windows line ending is trimmed" $?
grep -q "default \"$GOOD\"" "$work/rt2/runtime.conf"; check "the trimmed key has no carriage return" $?

# --- the key must be plain ------------------------------------------------------------------
rejects "short key" "abc123"
rejects "23 characters" "abcdefghijklmnopqrstuvw"
rejects "empty key" ""
for bad in '"' ';' '$' '\' ' ' '{' '}' "'" '`' '#' '&' '|' '<' '>' '*' '!' '%'; do
  rejects "key with '$bad'" "${GOOD}${bad}${GOOD}"
done
rejects "key with a newline inside" "$GOOD
$GOOD"
rejects "newline injection in the key" "$GOOD
}; evil { "
rm -f "$work/key"
env -i PATH="$PATH" AIW_NO_EXEC=1 AIW_RUNTIME_DIR="$work/rt3" MONITOR_KEY_FILE="$work/missing" HTPASSWD_FILE="$work/none" sh "$entry" >"$out" 2>"$err"
[ $? -ne 0 ]; check "a missing key file is refused" $?
grep -q "missing or not readable" "$err"; check "and says why" $?

# --- the server address ---------------------------------------------------------------------
for url in http://host http://host:8765 http://host:8765/ http://10.0.0.5:9 http://my-server.local http://a_b:1; do
  ok "$GOOD" UPSTREAM_URL="$url"; check "accepts $url" $?
done
ok "$GOOD" UPSTREAM_URL="http://host:8765/"
grep -q 'default "host:8765"' "$work/rt/runtime.conf"; check "the address is host:port without the slash" $?
for url in https://host host://x "host:8765" "http://" "http://host/path" "http://user@host" "http://host:99999" \
  "http://host:70000" "http://[::1]:8765" "http://host name" "http://host;x" 'http://host"x' "http://host:80:81"; do
  rejects "address $url" "$GOOD" UPSTREAM_URL="$url"
done
rejects "newline injection in the address" "$GOOD" UPSTREAM_URL="http://host
}; evil {"

# --- the default interval -------------------------------------------------------------------
ok "$GOOD" POLL_INTERVAL_MS=3000
[ "$(cat "$work/rt/config.json")" = '{"pollIntervalMs":3000}' ]; check "interval 3000" $?
ok "$GOOD" POLL_INTERVAL_MS=1000; check "interval 1000" $?
ok "$GOOD" POLL_INTERVAL_MS=60000; check "interval 60000" $?
for v in 999 60001 abc 3.5 -1 "3000 " " 3000" 0 100000 "3000
}"; do
  rejects "interval '$v'" "$GOOD" POLL_INTERVAL_MS="$v"
done

# --- the optional login ---------------------------------------------------------------------
printf 'user:$apr1$abc$def\n' >"$work/htpasswd"
rm -rf "$work/rt" && printf '%s' "$GOOD" >"$work/key"
env -i PATH="$PATH" AIW_NO_EXEC=1 AIW_RUNTIME_DIR="$work/rt" MONITOR_KEY_FILE="$work/key" HTPASSWD_FILE="$work/htpasswd" sh "$entry" >"$out" 2>"$err"
grep -q 'auth_basic "AI Watch"' "$work/rt/auth.conf" && grep -q "auth_basic_user_file $work/htpasswd" "$work/rt/auth.conf"
check "a password file turns the login on" $?
: >"$work/empty"
env -i PATH="$PATH" AIW_NO_EXEC=1 AIW_RUNTIME_DIR="$work/rt4" MONITOR_KEY_FILE="$work/key" HTPASSWD_FILE="$work/empty" sh "$entry" >"$out" 2>"$err"
grep -q 'No login' "$work/rt4/auth.conf"; check "an empty password file does not turn it on" $?

# --- the resolver ---------------------------------------------------------------------------
ok "$GOOD" RESOLVER=10.0.0.2
grep -q '^resolver 10.0.0.2 ' "$work/rt/runtime.conf"; check "resolver from RESOLVER" $?
ok "$GOOD" RESOLVER=fd00::2
grep -q '^resolver \[fd00::2\] ' "$work/rt/runtime.conf"; check "an IPv6 resolver gets brackets" $?
rejects "resolver that is a name" "$GOOD" RESOLVER=dns.example.com
rejects "resolver with a semicolon" "$GOOD" RESOLVER="1.1.1.1;evil"
rejects "newline injection in the resolver" "$GOOD" RESOLVER="1.1.1.1
}; evil {"

echo "entrypoint tests: $passed passed, $failed failed"
[ "$failed" -eq 0 ]
