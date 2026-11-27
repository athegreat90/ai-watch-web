#!/usr/bin/env bash
# AI Watch Web standalone installer for Linux, Raspberry Pi and macOS (Git Bash/WSL on Windows work too).
# Needs only Docker with the Compose plugin: no git, Node or Python.
#
#   ./install.sh --with-server           install the page and the AI Watch server next to it (simplest)
#   ./install.sh --server-url http://192.168.1.50:8765 --token-file ./config.local.json
#                                        install the page for a server that already runs elsewhere
#   ./install.sh --version v0.1.0        install a specific immutable version
#   ./install.sh --update                pull the current tag again and recreate the container
#   ./install.sh --rollback v0.1.0       go back to a previous version (without a version: the previously deployed image)
#   Options: --dir DIR  --bind IP  --port N  --server-port N  --auth-user NAME  --auth-password-file FILE
#            --no-pull  --no-check  --force  --repo owner/name
#
# The token of the AI Watch server goes into secrets/monitor_key (a Docker secret) and nowhere else.
# An existing .env and existing secrets are never overwritten. A running deployment is left untouched
# unless you pass --update, --version, --rollback or --force.
set -euo pipefail

repo=${AI_WATCH_REPO:-athegreat90/ai-watch-web}
dir=$(cd "$(dirname "$0")" && pwd)
version="" rollback="" update=0 force=0 pull=1 check=1 bind="" port="" server_port=""
server_url="" token_file="" with_server=0 auth_user="" auth_password_file=""

usage() { sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; }
die() { echo "error: $*" >&2; exit 1; }
note() { echo "==> $*"; }

while [ $# -gt 0 ]; do
    case $1 in
        --dir) dir=$2; shift ;;
        --version) version=$2; shift ;;
        --rollback) rollback=previous; if [ $# -gt 1 ] && [[ $2 == v* ]]; then rollback=$2; shift; fi ;;
        --update) update=1 ;;
        --bind) bind=$2; shift ;;
        --port) port=$2; shift ;;
        --server-port) server_port=$2; shift ;;
        --server-url) server_url=$2; shift ;;
        --token-file) token_file=$2; shift ;;
        --with-server) with_server=1 ;;
        --auth-user) auth_user=$2; shift ;;
        --auth-password-file) auth_password_file=$2; shift ;;
        --repo) repo=$2; shift ;;
        --no-pull) pull=0 ;;
        --no-check) check=0 ;;
        --force) force=1 ;;
        -h | --help) usage; exit 0 ;;
        *) usage >&2; die "unknown option $1" ;;
    esac
    shift
done

# No "${repo,,}": that is bash 4, and macOS ships bash 3.2.
image_repo=${AI_WATCH_IMAGE_REPO:-ghcr.io/$(printf '%s' "$repo" | tr '[:upper:]' '[:lower:]')}
# Paths the user gave are relative to where the command was run, not to --dir.
abs_path() { case $1 in /* | [A-Za-z]:[\\/]*) printf '%s' "$1" ;; *) printf '%s/%s' "$PWD" "$1" ;; esac; }
[ -z "$token_file" ] || token_file=$(abs_path "$token_file")
[ -z "$auth_password_file" ] || auth_password_file=$(abs_path "$auth_password_file")
release_api=${AI_WATCH_RELEASE_API:-https://api.github.com/repos/$repo}
release_base=${AI_WATCH_RELEASE_BASE:-https://github.com/$repo/releases/download}
tag_re='^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$'
token_re='^[A-Za-z0-9._~+/=-]{24,}$'   # the same rule as the container's entrypoint
url_re='^http://[A-Za-z0-9._-]+(:[0-9]{1,5})?/?$'
default_upstream=http://ai-watch-server:8765

port_ok() { [[ $1 =~ ^[0-9]+$ ]] && [ "$1" -ge 1 ] && [ "$1" -le 65535 ]; }
[ -z "$version" ] || [ "$version" = latest ] || [[ $version =~ $tag_re ]] || die "--version must be 'latest' or vX.Y.Z"
[ "$rollback" = "" ] || [ "$rollback" = previous ] || [[ $rollback =~ $tag_re ]] || die "--rollback needs vX.Y.Z"
[ -z "$port" ] || port_ok "$port" || die "--port must be a number from 1 to 65535"
[ -z "$server_port" ] || port_ok "$server_port" || die "--server-port must be a number from 1 to 65535"
[ -z "$server_url" ] || [[ $server_url =~ $url_re ]] || die "--server-url must look like http://host or http://host:port"
[ -z "$bind" ] || [[ $bind =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || die "--bind must be an IPv4 address, for example 192.168.1.50"
[ -z "$auth_user" ] || [[ $auth_user =~ ^[A-Za-z0-9._-]{1,32}$ ]] || die "--auth-user may only use letters, digits, '.', '_' and '-' (up to 32)"
[ -z "$auth_password_file" ] || [ -n "$auth_user" ] || die "--auth-password-file needs --auth-user"
[ "$with_server" = 0 ] || [ -z "$server_url" ] || die "--with-server and --server-url are different choices: pick one"
[ "$with_server" = 0 ] || [ -z "$token_file" ] || die "--with-server creates the token itself; --token-file is for a server that already runs"

command -v docker >/dev/null || die "Docker is not installed or not on PATH."
docker compose version >/dev/null 2>&1 || die "The Docker Compose plugin is required ('docker compose')."
# "up --wait --wait-timeout" needs Compose 2.17 or newer.
compose_version=$(docker compose version --short 2>/dev/null | sed 's/^v//')
if [[ $compose_version =~ ^([0-9]+)\.([0-9]+) ]] && { [ "${BASH_REMATCH[1]}" -lt 2 ] || { [ "${BASH_REMATCH[1]}" -eq 2 ] && [ "${BASH_REMATCH[2]}" -lt 17 ]; }; }; then
    die "Docker Compose $compose_version is too old: version 2.17 or newer is needed."
fi
docker info >/dev/null 2>&1 || die "The Docker daemon is not reachable (is it running, and do you have permission?)."
command -v curl >/dev/null || die "curl is required (it checks the page when the install is done)."

download() { # url dest
    if command -v curl >/dev/null; then curl -fsSL --retry 3 -o "$2" "$1"
    elif command -v wget >/dev/null; then wget -q -O "$2" "$1"
    else die "curl or wget is required to download release files."; fi
}
sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

# fetch_verified <tag> <asset> <dest>: download a release asset and check it against the release's SHA256SUMS.
fetch_verified() {
    local tag=$1 asset=$2 dest=$3 sums expected
    sums=$(mktemp)
    download "$release_base/$tag/SHA256SUMS" "$sums" || { rm -f "$sums"; return 1; }
    download "$release_base/$tag/$asset" "$dest" || { rm -f "$sums" "$dest"; return 1; }
    expected=$(awk -v f="$asset" '$2 == f || $2 == "*" f { print $1 }' "$sums")
    rm -f "$sums"
    [ -n "$expected" ] && [ "$(sha256 "$dest")" = "$expected" ] || { rm -f "$dest"; die "checksum mismatch for $asset: refusing to use it."; }
}

mkdir -p "$dir"
cd "$dir"
if [ ! -f compose.yaml ]; then
    # Installer run on its own (for example downloaded with curl): fetch and verify the bundle first.
    note "compose.yaml not found next to the installer; downloading the deployment bundle"
    if [ -n "$version" ] && [ "$version" != latest ]; then bundle_tag=$version
    else
        # A temp file instead of /dev/stdout: curl cannot write to /dev/stdout under Git Bash on Windows.
        latest_json=$(mktemp)
        download "$release_api/releases/latest" "$latest_json" || { rm -f "$latest_json"; die "could not query the latest release; pass --version vX.Y.Z"; }
        bundle_tag=$(sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' "$latest_json" | head -1)
        rm -f "$latest_json"
    fi
    [ -n "$bundle_tag" ] || die "could not determine the latest release; pass --version vX.Y.Z"
    [[ $bundle_tag =~ $tag_re ]] || die "the release tag '$bundle_tag' is not a version"
    zip=$(mktemp)
    fetch_verified "$bundle_tag" "ai-watch-web-deploy-$bundle_tag.zip" "$zip" || die "could not download the deployment bundle for $bundle_tag"
    extract=$(mktemp -d)
    # GNU tar and BusyBox tar cannot open a zip, so the fallback is Python's zipfile (not tar).
    zpy=$(for c in python3 python; do "$c" -c "import zipfile" >/dev/null 2>&1 && { echo "$c"; break; }; done)
    if command -v unzip >/dev/null; then unzip -q "$zip" -d "$extract"
    elif [ -n "$zpy" ]; then "$zpy" -m zipfile -e "$zip" "$extract"
    else rm -f "$zip"; rm -rf "$extract"; die "unzip (or Python 3) is needed to open the bundle."; fi
    cp -Rn "$extract"/ai-watch-web-deploy/. . && rm -rf "$zip" "$extract"
fi

# ---- preflight: check every input that can be checked now, so a refused run leaves nothing behind
read_token() { # file: a file with only the token, or an ai-watch-server config.local.json
    local raw
    [ -f "$1" ] || die "token file '$1' not found"
    raw=$(cat "$1")
    if [[ $raw == \{* ]]; then printf '%s' "$raw" | sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1
    else printf '%s' "$raw" | tr -d '[:space:]'; fi
}
existing() { # key: the value in an existing .env, or nothing
    if [ -f .env ]; then sed -n "s/^$1=//p" .env | tail -1 | tr -d '\r' | sed 's/[[:space:]]*$//'; fi
}
pre_files=$(existing COMPOSE_FILE); pre_files=${pre_files:-compose.yaml}
case ":$pre_files:" in *:compose.server.yaml:*) pre_server=1 ;; *) pre_server=0 ;; esac
case ":$pre_files:" in *:compose.auth.yaml:*) pre_auth=1 ;; *) pre_auth=0 ;; esac
[ "$with_server" = 0 ] || pre_server=1
if [ -n "$token_file" ] && [ "$pre_server" = 1 ]; then die "this deployment runs the server next to the page; --token-file does not apply"; fi
if [ "$pre_server" = 1 ] && [ -s secrets/monitor_key ]; then
    if [ ! -f server/config.local.json ]; then
        die "secrets/monitor_key exists (from another server) but server/config.local.json does not, so a new server would get a different token. Delete secrets/monitor_key, or put the server's config.local.json in server/."
    fi
    [ "$(read_token server/config.local.json)" = "$(tr -d '[:space:]' < secrets/monitor_key)" ] ||
        die "secrets/monitor_key already holds a different token than server/config.local.json. Delete one of them."
fi
if [ "$rollback" = previous ] && [ -z "$(tail -1 .deploy-history 2>/dev/null | awk '{ print $2 }')" ]; then
    die "no previous deployment recorded in .deploy-history; pass --rollback vX.Y.Z"
fi
if [ "$pre_server" = 0 ]; then
    if [ -n "$token_file" ]; then
        [[ $(read_token "$token_file") =~ $token_re ]] || die "the token is missing or not valid (at least 24 of A-Z a-z 0-9 . _ ~ + / = -)"
    fi
    [ -n "$token_file" ] || [ -s secrets/monitor_key ] || die "no token yet: pass --token-file (a file with the AI Watch server's token, or its config.local.json), or use --with-server"
    pre_url=${server_url:-$(existing UPSTREAM_URL)}
    { [ -n "$pre_url" ] && [ "$pre_url" != "$default_upstream" ]; } || die "no server configured: pass --server-url http://HOST:PORT, or use --with-server"
fi
password=""
if [ -n "$auth_user" ]; then
    if [ -s secrets/htpasswd ]; then die "secrets/htpasswd already exists. Delete it to set a new login."; fi
    if [ -n "$auth_password_file" ]; then
        [ -f "$auth_password_file" ] || die "password file '$auth_password_file' not found"
        password=$(head -n 1 "$auth_password_file" | tr -d '\r')
    elif [ -t 0 ]; then
        IFS= read -r -s -p "Password for $auth_user: " password; echo
        IFS= read -r -s -p "Repeat the password: " again; echo
        [ "$password" = "$again" ] || die "the passwords differ"
    else die "give the password with --auth-password-file FILE (there is no terminal to ask on)"; fi
    [ "${#password}" -ge 8 ] || die "the password needs at least 8 characters"
elif [ "$pre_auth" = 1 ] && [ ! -s secrets/htpasswd ]; then
    die "compose.auth.yaml is on but secrets/htpasswd is missing: run with --auth-user NAME, or remove it from COMPOSE_FILE in .env"
fi

new_env=0
if [ ! -f .env ]; then
    new_env=1
    if [ -f env.example ]; then cp env.example .env; else : > .env; fi
    chmod 600 .env 2>/dev/null || true
fi
# A .env edited on Windows has CRLF line ends, and one edited by hand may have trailing spaces: both are ignored.
env_get() { sed -n "s/^$1=//p" .env | tail -1 | tr -d '\r' | sed 's/[[:space:]]*$//'; }
env_set() { # key value: replace an active line, else append (on a line of its own)
    local tmp; tmp=$(mktemp)
    if grep -q "^$1=" .env; then sed "s|^$1=.*|$1=$2|" .env > "$tmp"
    else cat .env > "$tmp"; [ -z "$(tail -c1 "$tmp")" ] || echo >> "$tmp"; echo "$1=$2" >> "$tmp"; fi
    cat "$tmp" > .env; rm -f "$tmp"
}

# ---- which optional files are on (kept in .env as COMPOSE_FILE, so plain `docker compose` works too)
files=$(env_get COMPOSE_FILE); files=${files:-compose.yaml}
case ":$files:" in *:compose.server.yaml:*) server_on=1 ;; *) server_on=0 ;; esac
case ":$files:" in *:compose.auth.yaml:*) auth_on=1 ;; *) auth_on=0 ;; esac
if [ "$with_server" = 1 ] && [ "$server_on" = 0 ]; then files="$files:compose.server.yaml"; server_on=1; fi
if [ -n "$server_url" ] && [ "$server_on" = 1 ]; then die "this deployment runs the server next to the page (--with-server); to use another server, edit COMPOSE_FILE and UPSTREAM_URL in .env"; fi
if [ -n "$auth_user" ] && [ "$auth_on" = 0 ]; then files="$files:compose.auth.yaml"; auth_on=1; fi

# ---- image: explicit intent only, an existing .env keeps its image unless a version flag was given
history=.deploy-history
if [ -n "$rollback" ]; then
    if [ "$rollback" = previous ]; then
        last=$(tail -1 "$history" 2>/dev/null)
        target=$(printf '%s' "$last" | awk '{ print $2 }')
        [ -n "$target" ] || die "no previous deployment recorded in $history; pass --rollback vX.Y.Z"
        # A tag can be moved: ":latest" after an update is another image. The recorded digest is what was running.
        last_digest=$(printf '%s' "$last" | awk '{ print $3 }')
        case $target in *:latest) { [ -z "$last_digest" ] || [ "$last_digest" = unknown ]; } || target=$last_digest ;; esac
    else target="$image_repo:$rollback"; fi
    explicit=1
elif [ -n "$version" ]; then
    target="$image_repo:$version"; explicit=1
else
    target=""; explicit=0
fi

# ---- the token: only into secrets/monitor_key, never printed, never overwritten without a word
mkdir -p secrets
chmod 700 secrets 2>/dev/null || true
store_token() { # token: write secrets/monitor_key, or refuse when it holds a different one
    local token=$1
    [[ $token =~ $token_re ]] || die "the token is missing or not valid (at least 24 of A-Z a-z 0-9 . _ ~ + / = -)"
    if [ -s secrets/monitor_key ] && [ "$(tr -d '[:space:]' < secrets/monitor_key)" != "$token" ]; then
        die "secrets/monitor_key already holds a different token. Delete it if you want to replace it."
    fi
    if [ ! -s secrets/monitor_key ]; then
        ( umask 077; printf '%s' "$token" > secrets/monitor_key )
        # The container runs as an unprivileged user and must read it. The folder is private (700).
        chmod 644 secrets/monitor_key 2>/dev/null || true
        note "Saved the token in secrets/monitor_key"
    fi
}

# The web image is decided now, because the login hash below is made with it.
if [ -n "$target" ]; then env_set AI_WATCH_WEB_IMAGE "$target"
elif [ "$new_env" = 1 ] || [ -z "$(env_get AI_WATCH_WEB_IMAGE)" ]; then env_set AI_WATCH_WEB_IMAGE "$image_repo:latest"; fi

if [ "$server_on" = 1 ]; then
    [ -z "$server_port" ] || { env_set MONITOR_HOST_PORT "$server_port"; explicit=1; }
    # Lets a test or a mirror choose the server image without editing .env by hand.
    [ -z "${AI_WATCH_SERVER_IMAGE:-}" ] || env_set AI_WATCH_SERVER_IMAGE "$AI_WATCH_SERVER_IMAGE"
fi
server_image=$(env_get AI_WATCH_SERVER_IMAGE); server_image=${server_image:-ghcr.io/athegreat90/ai-watch-server:latest}

if [ "$server_on" = 1 ]; then
    mkdir -p server
    # Rootless Docker maps the host user to uid 0 inside the container, so there the server must run as root.
    rootless=0; docker info --format '{{.SecurityOptions}}' 2>/dev/null | grep -qi rootless && rootless=1
    case $(uname -s) in
        MINGW* | MSYS* | CYGWIN*) ;; # Docker Desktop maps file ownership itself
        *) if [ "$rootless" = 1 ]; then env_set PUID 0; env_set PGID 0
           else [ -n "$(env_get PUID)" ] || { env_set PUID "$(id -u)"; env_set PGID "$(id -g)"; }; fi ;;
    esac
    if [ ! -f server/config.local.json ]; then
        note "Generating server/config.local.json with a new random token (the server image's own init-config)"
        mount=$PWD/server; init_user=(--user "$(id -u):$(id -g)")
        if [ "$rootless" = 1 ]; then init_user=(); fi
        if command -v cygpath >/dev/null 2>&1; then mount=$(cygpath -m "$PWD/server"); init_user=(); fi
        MSYS_NO_PATHCONV=1 docker run --rm "${init_user[@]}" --entrypoint /app/ai-watch-server \
            -v "$mount:/cfg" "$server_image" init-config --config /cfg/config.local.json
    else
        note "Keeping the existing server/config.local.json and its token"
    fi
    store_token "$(read_token server/config.local.json)"
    env_set UPSTREAM_URL "$default_upstream"
else
    [ -z "$server_url" ] || { env_set UPSTREAM_URL "$server_url"; explicit=1; }
    [ -z "$token_file" ] || { store_token "$(read_token "$token_file")"; explicit=1; }
    [ -s secrets/monitor_key ] || die "no token yet: pass --token-file (a file with the AI Watch server's token, or its config.local.json), or use --with-server"
    [ "$(env_get UPSTREAM_URL)" != "$default_upstream" ] || die "no server configured: pass --server-url http://HOST:PORT, or use --with-server"
fi
upstream=$(env_get UPSTREAM_URL)

# ---- the optional login
if [ -n "$auth_user" ]; then
    # Salted SHA-512 made by the image itself (BusyBox cryptpw), so no extra tool is needed. The password
    # goes in through standard input and never appears in a process list.
    hash=$(printf '%s' "$password" | docker run --rm -i --entrypoint sh "$(env_get AI_WATCH_WEB_IMAGE)" -c 'cryptpw -m sha512 -P 0' 2>/dev/null | tr -d '\r\n') || true
    [[ $hash == \$6\$* ]] || die "could not create the password hash (is the web image available?)"
    ( umask 077; printf '%s:%s\n' "$auth_user" "$hash" > secrets/htpasswd )
    chmod 644 secrets/htpasswd 2>/dev/null || true
    note "Saved the login of '$auth_user' in secrets/htpasswd (a salted hash, not the password)"
    explicit=1
elif [ "$auth_on" = 1 ] && [ ! -s secrets/htpasswd ]; then
    die "compose.auth.yaml is on but secrets/htpasswd is missing: run with --auth-user NAME, or remove it from COMPOSE_FILE in .env"
fi

# ---- the remaining choices
[ -z "$bind" ] || { env_set WEB_HOST_BIND "$bind"; explicit=1; }
[ -z "$port" ] || { env_set WEB_HOST_PORT "$port"; explicit=1; }
if [ "$files" != compose.yaml ]; then env_set COMPOSE_FILE "$files"; env_set COMPOSE_PATH_SEPARATOR ":"; fi
[ "$with_server" = 0 ] || explicit=1
image=$(env_get AI_WATCH_WEB_IMAGE)
host_bind=$(env_get WEB_HOST_BIND); host_bind=${host_bind:-127.0.0.1}
host_port=$(env_get WEB_HOST_PORT); host_port=${host_port:-8080}
check_host=$host_bind; [ "$check_host" = 0.0.0.0 ] && check_host=127.0.0.1

running=$(docker compose ps -q web 2>/dev/null | head -1 || true)
if [ -n "$running" ] && [ "$update" = 0 ] && [ "$explicit" = 0 ] && [ "$force" = 0 ]; then
    note "AI Watch Web is already running; leaving it untouched (use --update, --version or --rollback to change it)."
    skip_deploy=1
else
    skip_deploy=0
fi

if [ "$skip_deploy" = 0 ]; then
    if [ -n "$running" ]; then
        prev_id=$(docker inspect --format '{{.Image}}' "$running")
        prev_ref=$(docker inspect --format '{{.Config.Image}}' "$running")
        prev_digest=$(docker image inspect --format '{{if .RepoDigests}}{{index .RepoDigests 0}}{{end}}' "$prev_id" 2>/dev/null || true)
    fi
    if [ "$pull" = 1 ]; then note "Pulling $image"; docker compose pull; fi
    note "Starting the containers"
    up=(docker compose up -d --wait --wait-timeout 90)
    [ "$force" = 0 ] || up+=(--force-recreate)
    "${up[@]}" || { docker compose logs --tail 30 >&2 || true; die "the containers did not become healthy"; }
    # Only a real change goes into the history: a rerun or an --update with nothing new would otherwise make
    # "--rollback" return to the image that is already running.
    if [ -n "$running" ]; then
        new_cid=$(docker compose ps -q web | head -1)
        if [ "$(docker inspect --format '{{.Config.Image}}' "$new_cid")" != "$prev_ref" ] || [ "$(docker inspect --format '{{.Image}}' "$new_cid")" != "$prev_id" ]; then
            echo "$(date -u +%FT%TZ) $prev_ref ${prev_digest:-unknown}" >> "$history"
        fi
    fi
fi

note "Waiting for the page on $check_host:$host_port"
for _ in $(seq 30); do
    curl -fsS -m 2 "http://$check_host:$host_port/healthz" >/dev/null 2>&1 && break
    sleep 1
done
curl -fsS -m 2 "http://$check_host:$host_port/healthz" >/dev/null || die "http://$check_host:$host_port/healthz did not answer"

cid=$(docker compose ps -q web | head -1)
image_id=$(docker inspect --format '{{.Image}}' "$cid")
resolved_version=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.version"}}' "$image_id" 2>/dev/null || true)
resolved_digest=$(docker image inspect --format '{{if .RepoDigests}}{{index .RepoDigests 0}}{{end}}' "$image_id" 2>/dev/null || true)

if [ "$check" = 1 ]; then
    # The end-to-end check: the page asks the server through the proxy with the secret token.
    if [ "$auth_on" = 1 ] && [ -z "${password:-}" ]; then
        note "A login is on and its password is not known to this run: skipping the server check (run it again with --auth-user to be asked, or open the page)"
    else
        note "Checking that the page reaches the AI Watch server at $upstream"
        reply=""; code=000
        # Inside a curl config file a backslash and a double quote are escapes, so escape them in the password.
        cfg_pw=${password//\\/\\\\}; cfg_pw=${cfg_pw//\"/\\\"}
        for _ in $(seq 12); do
            # Headers come back on standard output (no temp file: a native Windows curl cannot see a Git Bash /tmp path).
            # The password goes through curl's standard input, never onto its command line.
            reply=$(printf 'user = "%s:%s"\n' "${auth_user:-x}" "${cfg_pw:-x}" | curl -s -m 5 -o /dev/null -D - -w 'HTTPCODE=%{http_code}\n' \
                $([ -n "${password:-}" ] && echo "-K -") "http://$check_host:$host_port/api/status" || true)
            code=$(sed -n 's/^HTTPCODE=//p' <<< "$reply" | tail -1); code=${code:-000}
            [ "$code" = 502 ] || [ "$code" = 504 ] || [ "$code" = 000 ] || break
            sleep 2
        done
        refused=$(grep -i '^x-aiw-upstream-status: 401' <<< "$reply" || true)
        case $code in
            200) note "OK: the server answered and accepted the token." ;;
            401) if [ -n "$refused" ]; then die "the AI Watch server refused the token in secrets/monitor_key. Use the token of that server (--token-file) after deleting the old file."
                 else die "the page asked for a login and the one given was refused"; fi ;;
            502 | 504 | 000) die "the page cannot reach the AI Watch server at $upstream. Check that the server runs and listens on an address the container can reach (a container cannot use the 127.0.0.1 of this machine). Use --with-server to run it next to the page." ;;
            *) die "unexpected answer $code from /api/status" ;;
        esac
    fi
fi

cat <<EOF

AI Watch Web is running.
  requested image : $image
  deployed version: ${resolved_version:-unknown}
  image digest    : ${resolved_digest:-not available (local image)}
  page            : http://$host_bind:$host_port
  server          : $upstream   (token: $dir/secrets/monitor_key)
  update          : ./install.sh --update       roll back: ./install.sh --rollback [vX.Y.Z]
EOF
if [ "$host_bind" = 127.0.0.1 ]; then
    echo "  Note: the page listens on this machine only. For other devices run: ./install.sh --bind <this host's LAN IP> --auth-user NAME"
elif [ "$auth_on" = 0 ]; then
    echo "  WARNING: the page is reachable from the network and has no login. Add one with --auth-user NAME, or read 'Remote access' in README.md."
fi
