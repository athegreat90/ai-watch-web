#!/bin/sh
# AI Watch Web entrypoint. It checks the deployment settings, writes the part of the Nginx
# configuration that depends on them into /tmp/nginx, and starts Nginx.
#
#   UPSTREAM_URL      where the AI Watch server is, http://host[:port]   (default http://ai-watch-server:8765)
#   MONITOR_KEY_FILE  file with the server's monitor token               (default /run/secrets/monitor_key)
#   HTPASSWD_FILE     optional file that turns on a login for the page   (default /run/secrets/htpasswd)
#   POLL_INTERVAL_MS  optional default update interval, 1000 to 60000
#   RESOLVER          optional DNS server, by default the first one in /etc/resolv.conf
#
# The token is never printed, never put in an environment variable and never given to the browser.
# Tests can set AIW_RUNTIME_DIR to write somewhere else and AIW_NO_EXEC=1 to stop before Nginx.
set -eu

RUNTIME_DIR="${AIW_RUNTIME_DIR:-/tmp/nginx}"
KEY_FILE="${MONITOR_KEY_FILE:-/run/secrets/monitor_key}"
HTPASSWD_FILE="${HTPASSWD_FILE:-/run/secrets/htpasswd}"
UPSTREAM_URL="${UPSTREAM_URL:-http://ai-watch-server:8765}"

fail() {
  echo "aiw-entrypoint: $*" >&2
  exit 1
}

# A literal newline: $(printf '\n') would lose it, because command substitution trims trailing ones.
newline='
'
# grep checks one line at a time, so a value with a newline in it could pass with a good first line
# and carry more text after it. Every value that ends up in a configuration file must be one line.
single_line() {
  case "$2" in
    *"$newline"*) fail "$1 must be one line" ;;
  esac
}

# --- the monitor token ------------------------------------------------------------------------
[ -r "$KEY_FILE" ] || fail "the monitor key file is missing or not readable: $KEY_FILE"
key=$(tr -d '\r' <"$KEY_FILE")
single_line "the monitor key file" "$key"
# This is written into the Nginx configuration, so a quote, a semicolon, a backslash, a dollar sign
# or a space in it could break the file or change it. Only plain characters are accepted.
printf '%s' "$key" | grep -Eq '^[A-Za-z0-9._~+/=-]{24,}$' ||
  fail "the monitor key must have at least 24 characters from A-Z a-z 0-9 . _ ~ + / = -"

# --- the server's address ---------------------------------------------------------------------
single_line UPSTREAM_URL "$UPSTREAM_URL"
printf '%s' "$UPSTREAM_URL" | grep -Eq '^http://[A-Za-z0-9._-]+(:[0-9]{1,5})?/?$' ||
  fail "UPSTREAM_URL must look like http://host or http://host:port"
upstream=${UPSTREAM_URL#http://}
upstream=${upstream%/}
port=${upstream##*:}
if [ "$port" != "$upstream" ] && [ "$port" -gt 65535 ]; then
  fail "UPSTREAM_URL has a port above 65535"
fi

# --- DNS: the server's name is looked up when needed, not only at start -----------------------
resolver=${RESOLVER:-}
single_line RESOLVER "$resolver"
if [ -z "$resolver" ] && [ -r /etc/resolv.conf ]; then
  resolver=$(awk '$1 == "nameserver" { print $2; exit }' /etc/resolv.conf)
fi
resolver=${resolver:-127.0.0.11}
printf '%s' "$resolver" | grep -Eq '^[0-9A-Fa-f.:]+$' || fail "RESOLVER must be an IP address"
case "$resolver" in
  *:*) resolver="[$resolver]" ;;
esac

# --- the default update interval, if any ------------------------------------------------------
config='{}'
if [ -n "${POLL_INTERVAL_MS:-}" ]; then
  single_line POLL_INTERVAL_MS "$POLL_INTERVAL_MS"
  printf '%s' "$POLL_INTERVAL_MS" | grep -Eq '^[0-9]{4,5}$' &&
    [ "$POLL_INTERVAL_MS" -ge 1000 ] && [ "$POLL_INTERVAL_MS" -le 60000 ] ||
    fail "POLL_INTERVAL_MS must be a number from 1000 to 60000"
  config="{\"pollIntervalMs\":$POLL_INTERVAL_MS}"
fi

# --- write the files (readable only by this user) ---------------------------------------------
umask 077
mkdir -p "$RUNTIME_DIR"

{
  echo "# Written at start by aiw-entrypoint. Holds the monitor key, so it stays in /tmp."
  echo "resolver $resolver valid=10s ipv6=off;"
  echo "map \$request_method \$aiw_upstream { default \"$upstream\"; }"
  echo "map \$request_method \$aiw_monitor_key { default \"$key\"; }"
} >"$RUNTIME_DIR/runtime.conf"

printf '%s\n' "$config" >"$RUNTIME_DIR/config.json"

if [ -s "$HTPASSWD_FILE" ]; then
  {
    echo 'auth_basic "AI Watch";'
    echo "auth_basic_user_file $HTPASSWD_FILE;"
  } >"$RUNTIME_DIR/auth.conf"
else
  echo "# No login: the dashboard is open to whoever can reach the port." >"$RUNTIME_DIR/auth.conf"
fi

[ "${AIW_NO_EXEC:-}" = "1" ] && exit 0

nginx -t -q || fail "the Nginx configuration is not valid"
exec nginx -g 'daemon off;'
