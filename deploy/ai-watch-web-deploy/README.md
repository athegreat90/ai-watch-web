# AI Watch Web: standalone deployment

Everything here runs with **Docker only**. No git clone, Node or build is needed on the target machine. The
page is one small Nginx image (about 28 MB compressed, `linux/amd64` and `linux/arm64`: PC, server, Raspberry
Pi 4/5, Docker Desktop) that serves the app and asks your AI Watch server for the data.

Image: `ghcr.io/athegreat90/ai-watch-web`

| Tag       | Meaning                                                                                                                                                                                  |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `:vX.Y.Z` | One immutable release. It never changes. Use it for reproducible installs and rollbacks.                                                                                                 |
| `:latest` | The newest **stable** release. A mutable tag: it moves when a newer stable release is published, **but a running container never changes by itself**. You must pull and recreate it.     |

Both tags of a release point to the same multi-platform image (same digest). Prereleases never move `latest`.

## What you need to know first

Your browser only talks to this container, and never holds a secret. The container asks the **AI Watch server**
for the data and adds the server's **monitor token** itself. That token is a Docker secret in `secrets/monitor_key`. It is not in `.env`, not in the page, not in
the logs and not in any environment variable.

The container cannot use the `127.0.0.1` of this machine to reach a server that runs on it. So there are two
ways to install, and the installer asks for one of them:

- **`--with-server`** runs the AI Watch server image next to the page, in the same Docker network. Simplest, and
  the server needs no open port for the page. The installer creates the server's token for you.
- **`--server-url`** is for a server that already runs somewhere else (another machine, or this one listening on
  a LAN address). You give the URL and the server's token.

## Install

```sh
# Linux, macOS, Raspberry Pi (ARM64), WSL, Git Bash
./install.sh --with-server                 # the page and a new server, both private to this machine
./install.sh --server-url http://192.168.1.50:8765 --token-file ./config.local.json
./install.sh --version v0.1.0 --with-server  # a specific immutable version
./install.sh --update                      # pull the current tag again; the container is recreated if the image changed (--force recreates it anyway)
./install.sh --rollback                    # back to the previously deployed image (or: --rollback v0.1.0)
```

```powershell
# Windows Docker Desktop (Windows PowerShell 5.1 or PowerShell 7)
.\install.ps1 -WithServer
.\install.ps1 -ServerUrl http://192.168.1.50:8765 -TokenFile .\config.local.json
.\install.ps1 -Update
.\install.ps1 -Rollback previous           # or -Rollback v0.1.0
```

Then open `http://127.0.0.1:8080`.

- **`--token-file`** takes a file with only the token, or the `config.local.json` of the AI Watch server. The token
  must be at least 24 characters of `A-Z a-z 0-9 . _ ~ + / = -`.
- Safe to rerun. An existing `.env` and existing secrets are **never** overwritten (a different token is refused),
  and a running deployment is left alone unless you pass `--update`, `--version`, `--rollback` or `--force`.
- The installer finishes with a real check: it asks the server through the page with the secret token. It tells
  you if the server refused the token (`refused the token`) or cannot be reached (`cannot reach the AI Watch
  server`). `--no-check` skips it.
- Other options: `--dir`, `--bind`, `--port`, `--server-port`, `--no-pull`, `--force`, `--repo owner/name`
  (`-Dir -Bind -Port -ServerPort -NoPull -NoCheck -Force -Repo` on Windows).
- The installer can fetch the bundle by itself: put only `install.sh` in an empty folder and run it. It downloads the
  bundle and checks it against the release's `SHA256SUMS`. Previous deployments are logged in `.deploy-history`.

## Remote access

By default the page listens on `127.0.0.1` only and has **no login**. To open it to other devices:

1. Add a login: `./install.sh --bind <this host's LAN IP> --auth-user NAME` (it asks for a password of at least 8
   characters, or reads it from `--auth-password-file FILE`). The password is stored only as a salted SHA-512 hash in
   `secrets/htpasswd`.
2. Know the limit: the page is plain HTTP. A login over plain HTTP can be read by anyone on the same network. For
   anything but a network you fully trust, use a private network such as **Tailscale**, or put a reverse proxy with
   TLS in front of it.
3. The page never lets a browser change anything: it only reads `GET /health`, `/api/status` and `/api/sessions`.

## Method B: Docker Compose

```sh
cp env.example .env                  # choose the image, bind address and server
mkdir -p secrets && chmod 700 secrets
# Paste the token when asked (it is not echoed, and it stays out of your shell history).
# If you press Ctrl-C at the prompt, run: stty echo
printf 'Server token: '; stty -echo; IFS= read -r t; stty echo; printf '\n'
printf '%s' "$t" > secrets/monitor_key && chmod 644 secrets/monitor_key; unset t
docker compose pull
docker compose up -d --wait
```

`compose.yaml` is the page. Add the optional files with `COMPOSE_FILE` in `.env`, for example
`COMPOSE_FILE=compose.yaml:compose.server.yaml` and `COMPOSE_PATH_SEPARATOR=:` (see the comments in each file).
With `compose.server.yaml`, also put `PUID=$(id -u)` and `PGID=$(id -g)` in `.env` (numbers, not the commands), so the
server can read its private `server/config.local.json`; on rootless Docker use `0` for both.
`.env` selects the image: `AI_WATCH_WEB_IMAGE=ghcr.io/athegreat90/ai-watch-web:latest` or a pinned `:vX.Y.Z`. Update or
roll back by changing that line, then `docker compose pull && docker compose up -d --wait`.

## Which version am I running?

```sh
docker compose images
docker inspect "$(docker compose ps -q web)" --format '{{.Config.Image}} {{index .Config.Labels "org.opencontainers.image.version"}}'
docker buildx imagetools inspect ghcr.io/athegreat90/ai-watch-web:latest --format '{{json .Manifest}}'
```

`latest` equals the highest published stable version when the digests of `latest` and `:vX.Y.Z` are the same.

## Security defaults

Non-root user, read-only root filesystem, all Linux capabilities dropped, `no-new-privileges`, 64 MB, 0.5 CPU and
64 process limits, port bound to `127.0.0.1` unless you choose otherwise, the token as a read-only Docker secret,
a strict Content Security Policy, and only three read routes allowed to the server. The page has no TLS.
`secrets/` is private (mode 700); the key and password files inside are readable (644) because the container runs
as an unprivileged user.

## If something does not work

| You see                                                      | What it means                                                                                                       |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `cannot reach the AI Watch server`                           | The server is down, or listens where the container cannot reach. Use `--with-server`, or its LAN IP address, not `127.0.0.1`. Do not rely on `host.docker.internal` on Linux: Nginx does not read `/etc/hosts`, so the name may not resolve. |
| `refused the token`                                          | `secrets/monitor_key` is not the token of that server. Delete it and run again with the right `--token-file`.       |
| `secrets/monitor_key already holds a different token`        | The installer will not overwrite a secret. Delete the file to replace it.                                           |
| The page shows "Server token rejected"                       | The same as `refused the token`, seen in the browser.                                                               |
| The page shows "Login required"                              | A login is on. Sign in with the name and password you gave.                                                         |
