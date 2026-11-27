# Troubleshooting

Find the message or the symptom, then follow the cause. The page's own messages are in the left column as they appear.

## In the browser

| You see | Cause | What to do |
|---|---|---|
| **Server token rejected** ("The server refused the token the proxy sends. Check the proxy secret.") | The AI Watch server answered 401 to the token in `secrets/monitor_key`. | Put the token of **that** server in the file (the `token` of its `config.local.json`), then recreate the container. The installer shows the same problem as "refused the token". |
| **Login required** | A login is on and the browser has none, or the one given is wrong. | Sign in with the name and password set with `--auth-user`. |
| **Proxy configuration error** ("The proxy blocks a route this page needs.") | The page asked for a route the proxy does not allow (404). | The image and the app do not match: update both to the same release. |
| **Offline** ("Server unreachable.") | The page cannot get an answer from the container, or the container cannot get one from the server (502 or 504). | See "502 and 504" below. |
| **Stale** ("Data may be out of date.") | No answer for three intervals. The last data stays on screen with its time. | It recovers by itself when answers return. |
| **Demo data** | Demo mode is on in this tab. | Settings, turn off "Show example data". |
| A white page, or "refused to execute script" in the console | A reverse proxy or extension changed the page or its headers (the Content Security Policy only allows the page's own scripts). | Let the page's headers through unchanged, and test without the extension. |
| The theme is wrong for a moment at load | The saved theme is applied by `theme-init.js` before the first paint. If it flashes, that file is being blocked or cached oddly. | Check that `/theme-init.js` loads (it is not hashed, and is `no-cache`). |
| No sound or desktop notification | Both are **off** by default and need a user action to turn on. A browser also blocks sound until the page has been touched. | Settings: tick "Play a tone", then press "Play a test tone" once. Allow notifications in the browser. |
| The alert keeps coming back | Dismissing only hides it, on purpose. It returns every 2 minutes while a session still needs you. | Press **Acknowledge** (it is remembered for that update of that session). |
| The kiosk screen turns off | The browser refused the wake lock (it needs HTTPS or `localhost`). | See `KIOSK.md`. |
| Times look a few seconds off | The server sends whole seconds and the page moves them forward between answers, so a new answer can move a counter back by up to a second. | Nothing to do. |

## 502 and 504 (the container cannot reach the server)

The container asks the server with a 2 s connect and a 5 s read timeout.

- **The server is down** or not started yet: start it. The container needs no restart.
- **`UPSTREAM_URL` is `127.0.0.1` or `localhost`:** a container cannot use its host's loopback. Use the server's LAN IP, or install with `--with-server`.
- **`host.docker.internal` on Linux:** Nginx does not read `/etc/hosts`, so the name may not resolve. Use the LAN IP.
- **The server listens only on `127.0.0.1`:** even the right IP is refused. Make it listen on the LAN address, or use `--with-server`.
- A firewall between the two.

Check from the host: `docker exec <web container> wget -S -O - http://<server>:8765/health` (the server's `/health` is public).

## The container does not start

It refuses on purpose, with one of these messages (`docker logs <container>`):

| Message | Fix |
|---|---|
| `the monitor key file is missing or not readable: /run/secrets/monitor_key` | The secret is not mounted, or user 101 cannot read it (mode 644 in a private directory). |
| `the monitor key must have at least 24 characters from A-Z a-z 0-9 . _ ~ + / = -` | The token is too short or has a forbidden character (a newline, a space, a quote). Use the server's token exactly. |
| `UPSTREAM_URL must look like http://host or http://host:port` | Only `http`, no path, a plain name or IP. |
| `UPSTREAM_URL has a port above 65535` | Fix the port. |
| `RESOLVER must be an IP address` | Give an IP, or leave it empty. |
| `POLL_INTERVAL_MS must be a number from 1000 to 60000` | Fix the value or leave it empty. |
| `<name> must be one line` | A value has a newline in it. |
| `the Nginx configuration is not valid` | Something in a mounted file broke the generated configuration. |

## The installer

| Message | Cause |
|---|---|
| `no token yet: pass --token-file ...` | Nothing to put in `secrets/monitor_key`. Give `--token-file`, or use `--with-server`. |
| `no server configured: pass --server-url ...` | The default `http://ai-watch-server:8765` only exists with `--with-server`. |
| `the token is missing or not valid` | The file has no token, or an invalid one (24 or more of `A-Z a-z 0-9 . _ ~ + / = -`). |
| `secrets/monitor_key already holds a different token` | The installer never overwrites a secret. Delete the file to replace it. |
| `secrets/htpasswd already exists` | The same, for a login. |
| `refused the token` / `cannot reach the AI Watch server` | The end-of-install check found the problems described above. |
| `checksum mismatch for ...: refusing to use it.` | A download does not match the release's `SHA256SUMS`. Nothing was used. Try again; if it repeats, do not install. |
| `the password needs at least 8 characters` | Choose a longer password. |
| `--bind must be an IPv4 address` | IPv6 is not supported for the published port. |
| `Docker Compose X is too old` | The installer needs Compose 2.17 or newer. |
| `unzip (or Python 3) is needed to open the bundle.` (`install.sh` only) | Install either, or unzip the bundle by hand. `install.ps1` opens the zip with .NET. |
| `the containers did not become healthy` | Read the logs it prints. The usual cause is one of the start-up messages above. |
| `The Docker daemon is not reachable (is it running, and do you have permission?)` | Docker is not running, or your user is not in the `docker` group. Do not use `sudo` for the installer if you use `--with-server`: the server would run as root. |

## Port already in use

`--port N` for the page (default 8080), `--server-port N` for the server (default 8765).

## Still stuck

Run the page's connection test (Settings, "Test connection"), look at `docker logs <container>`, and at `docker compose ps`. Nothing in the logs contains the token or a password. If you report a problem, say which message you saw and your Docker version, and never paste `secrets/` or `.env`.
