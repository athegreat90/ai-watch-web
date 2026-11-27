# Changelog

The version of a release is the highest `## [X.Y.Z]` heading below, or the next patch after the latest release, whichever is higher (`release/automatic.py`). A change that ships no file (documentation, tests, CI) does not release by itself.

## [Unreleased]

- `compose.standalone.yaml`: the page as one Compose file that needs only Docker and the published image (no Dockerfile, no clone), with its steps in the README.

## [0.1.0]

First release. A dashboard for the AI Watch server that works in any browser and as a kiosk.

- Dashboard, Sessions (list and detail) and Usage limits pages, kept up to date every 3 seconds with a backoff when the server is down, and a clear connection state (live, stale, offline, token rejected, login required).
- The NEEDS YOU alert (repeats every 2 minutes, acknowledged per update), the task-done celebration, the focus timer, meeting mode and the idle robot, as in the firmware.
- A kiosk page that fits 800x480 and 1024x600 without scrolling.
- Every page asks the server once every 3 seconds (20 requests a minute, none in a hidden tab). The Sessions pages also read the full list, at twice that interval, so they make 30 a minute.
- Themes: AMOLED (true black, the default), dark, light and system. Demo data for trying it without a server.
- One Nginx image (`linux/amd64` and `linux/arm64`, about 28 MB compressed, non-root, read-only) that serves the app and proxies only `GET /health`, `/api/status` and `/api/sessions`. The server token lives only in a Docker secret.
- Release assets: the deployment bundle (Compose files, `install.sh` and `install.ps1`), the SBOM of each architecture and `SHA256SUMS`. The installers set up the page with or without the AI Watch server next to it, an optional login, updates and rollbacks, and check every download against `SHA256SUMS`.
