# Deployment

How to run AI Watch Web. Pick the method that fits; the first one is the recommended one.

> **Status:** `v0.1.0` is published (2026-11-27), so `ghcr.io/athegreat90/ai-watch-web` exists and anonymous pulls work. The image, the installers and their tests pass in CI and on Docker Desktop for Windows against a locally built image. Nobody has yet run the installers from the downloaded `v0.1.0` zip. `compose.standalone.yaml` was run from an empty folder with the real published image.

## What you need to decide first

1. **Where is the AI Watch server?** The page needs its address and its **monitor token** (the `token` of the server's `config.local.json`).
2. **Can the container reach it?** A container cannot use the `127.0.0.1` of its host. So either run the server next to the page (`--with-server`), or give the page the server's **LAN IP address** (not `127.0.0.1`, and not `host.docker.internal` on Linux: Nginx does not read `/etc/hosts`, so that name may not resolve).
3. **Who may open the page?** By default only this machine. For other devices, add a login and read "Remote access" below.

## Method A: the installer (recommended)

Download `ai-watch-web-deploy-vX.Y.Z.zip` from the release, unzip it, and run the installer inside it. It checks Docker, writes the secret, starts the container, waits until it is healthy, asks the server through the page with the secret token, and prints the version and digest it deployed.

```sh
./install.sh --with-server                 # the page and a new AI Watch server, both private
./install.sh --server-url http://192.168.1.50:8765 --token-file ./config.local.json
./install.sh --update                      # pull again; recreated if the image changed (--force recreates anyway)
./install.sh --rollback                    # the previously deployed image, or --rollback vX.Y.Z
```

On Windows use `install.ps1` with the same options (`-WithServer`, `-ServerUrl`, `-TokenFile`, `-Update`, `-Rollback`). Every option and every message is in `deploy/ai-watch-web-deploy/README.md`. The installer never overwrites an existing `.env` or secret, and it checks every download against the release's `SHA256SUMS`.

## Method B: Docker Compose by hand

In the unzipped bundle:

```sh
cp env.example .env
mkdir -p secrets && chmod 700 secrets
IFS= read -rs -p 'Server token: ' t && printf '%s' "$t" > secrets/monitor_key && unset t && chmod 644 secrets/monitor_key
# edit .env: UPSTREAM_URL=http://192.168.1.50:8765
docker compose pull
docker compose up -d --wait
```

`compose.yaml` is the page. Add `compose.server.yaml` (the server next to it, needs `PUID` and `PGID` in `.env` and a `server/config.local.json`) and `compose.auth.yaml` (a login, needs `secrets/htpasswd`) through `COMPOSE_FILE` in `.env`. The comments in each file say what they need. The Portainer "stack" form of the same files should work, but it has not been tried.

## Method C: `docker run`

```sh
docker run -d --name ai-watch-web --restart unless-stopped \
  --read-only --tmpfs /tmp:size=16m,mode=1777 --cap-drop ALL --security-opt no-new-privileges:true \
  --memory 64m --pids-limit 64 \
  -e UPSTREAM_URL=http://192.168.1.50:8765 \
  -p 127.0.0.1:8080:8080 \
  --mount type=bind,source="$PWD/secrets/monitor_key",target=/run/secrets/monitor_key,readonly \
  ghcr.io/athegreat90/ai-watch-web:latest
```

The key file must be readable by user 101 (the container's user): mode 644 inside a private directory.

## Method D: one Compose file (no zip, no clone)

For a server that already runs somewhere: a single file, `compose.standalone.yaml`, saved as `compose.yaml` next to `secrets/monitor_key` and a `.env` with `UPSTREAM_URL`. It uses only the published image (it has no `build` section) and needs nothing else from this repository. The steps, for Linux, macOS and Windows PowerShell, are in the "Docker Compose standalone" section of `README.md`, and the comments at the top of the file say the same.

It is Method B without the zip: no installer, no `compose.server.yaml`, no `compose.auth.yaml`, no `.deploy-history` rollback and no end-of-install check. `UPSTREAM_URL` is required, because the default of the bundle (`http://ai-watch-server:8765`) only exists when the server runs in the same project. `tests/standalone/standalone.test.sh` checks it alone in an empty folder, and CI runs it on every pull request.

## From source

```sh
npm ci
npm run docker:build                          # builds ai-watch-web:local
AI_WATCH_WEB_IMAGE=ai-watch-web:local UPSTREAM_URL=http://192.168.1.50:8765 docker compose up   # the compose.yaml at the repo root builds it too
```

## Which version is running?

```sh
docker compose images
docker inspect "$(docker compose ps -q web)" --format '{{.Config.Image}} {{index .Config.Labels "org.opencontainers.image.version"}}'
```

`:latest` is a moving tag. A running container never changes by itself: updating means pulling and recreating. The installer records the previous image **with its digest** in `.deploy-history`, so a rollback from `:latest` goes back to what actually ran.

## Remote access

By default the page listens on `127.0.0.1` and has no login. To open it to other devices:

- Add a login (`--auth-user NAME`). It is HTTP basic authentication with a salted hash.
- **It is plain HTTP.** A login sent over plain HTTP can be read by anyone on the same network. For anything but a network you fully trust, use a private network such as **Tailscale** (bind the page to the Tailscale address), or put a reverse proxy that terminates TLS in front of it.
- The page is read-only: it can show sessions but cannot change anything on the server.
- The AI Watch server itself has no TLS and should stay on a trusted network too.

A reverse proxy in front of the page needs nothing special: forward everything to the container's port 8080, keep the `Host` header, and let it add TLS. The page sets its own security headers; do not strip them.

## Raspberry Pi and other small machines

The image is built for `linux/amd64` and `linux/arm64`, uses about 6 to 9 MiB of memory as Docker counts it (`PERFORMANCE.md`), and has been run on arm64 only under emulation on an amd64 PC. **No real Raspberry Pi has been tried.** For a screen on the Pi, see `KIOSK.md`.

## Docker Desktop (Windows, macOS)

Works with `install.ps1` (Windows PowerShell 5.1 is tested). On macOS, `install.sh` avoids bash 4 features so the stock bash 3.2 should be enough, but it has not been run on a Mac. Docker Desktop resolves `host.docker.internal`, so a server on the same PC can be reached with it, but only if it listens on `0.0.0.0` or the LAN address (a server bound to `127.0.0.1` is not reachable from a container at all).

## Limits to know

- The container exposes plain HTTP only.
- SELinux hosts may need `:z` on the bind mounts, as for the server's own installer.
- Running the installer with `sudo` makes the optional server run as root. Run it as a user in the `docker` group.
