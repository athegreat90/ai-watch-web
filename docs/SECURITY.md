# Security checks

What is checked, what blocks a release, and how to run it. The checks run on your machine today. Phase 11 runs them in GitHub Actions.

## Policy

| Check | Blocks when | Tool |
|---|---|---|
| Image vulnerabilities, both `linux/amd64` and `linux/arm64` | a HIGH or CRITICAL vulnerability **has a fixed version** | Trivy `0.76.2`, pinned by digest |
| Secrets in the image and in the repository | any secret | Trivy |
| Misconfiguration (Dockerfile, compose files) | a HIGH or CRITICAL finding | Trivy |
| npm dependencies | a HIGH or CRITICAL advisory | `npm audit --audit-level=high` and Trivy on `package-lock.json` |
| Base images | not pinned by digest, or `.nvmrc` and the Dockerfile disagree | `security/check_version.py` |
| Quality Gate | the gate fails | SonarQube (see `SONARQUBE.md`) |

A vulnerability **without** a fix is printed and does not block, because nobody can act on it. Moderate and lower advisories in development tools are reported and do not block.

Never skip or bypass a failed or unavailable gate. An exception needs a written decision by the owner in `MEMORY.md`, and goes into `security/accepted-risks.json` (see below). Secrets and misconfigurations can never be accepted.

## Run it

```sh
npm run test:security        # unit tests of the scripts below (no Docker, no network)
npm run security:repo        # npm audit + Trivy on the repository: dependencies, secrets, misconfiguration
npm run security:image amd64 # build, smoke test, scan and SBOM of one architecture
npm run security:image arm64 #   (the arm64 image is built and run under emulation on an amd64 machine)
python security/check_version.py --installed   # Node and Nginx pins are consistent
python security/refresh_base.py                # move both base images to the newest patch (needs the network)
```

Results go to `security-results/` (git-ignored): `amd64.json`, `arm64.json`, `repo.json`, and the SBOMs `sbom-amd64.cdx.json` and `sbom-arm64.cdx.json` (CycloneDX). They need Docker. The first Trivy run downloads its 138 MB vulnerability database.

## The scripts

| File | What it does |
|---|---|
| `security/check_findings.py` | Reads a Trivy report and exits 1 on what the policy blocks, after applying the accepted risks. |
| `security/accepted-risks.json` | The time-boxed exceptions. Each covers one advisory of one package at one fixed version. |
| `security/check_nginx_features.py` | Fails when the Nginx configuration enables a feature the accepted advisories need. |
| `security/check-image.sh` | Builds one architecture, runs `smoke.sh`, scans, writes the SBOM, runs `check_findings.py`. |
| `security/smoke.sh` | Runs the image like production (user 101, read-only root, no capabilities, key as a read-only secret) and checks the page, a deep link, 502 without a server, 405 and 404 on the closed routes, the CSP, the user id, that the key is in no answer and no log, and the container health check. |
| `security/scan-repo.sh` | `npm audit` and Trivy on the repository. |
| `security/check_version.py` | Both base images pinned by version **and** digest, stages use the pins, `.nvmrc` equals the Dockerfile Node, optionally the running Node too. |
| `security/refresh_base.py` | Newest patch of the Node major and of the Nginx minor, with both architectures required, rewriting the Dockerfile and `.nvmrc`. |
| `security/remediate.sh` | The daily job: scan both images, keep one open issue with the findings (`upsert-issue.sh`), refresh the bases, and accept the refresh only if both architectures pass. |
| `security/upsert-issue.sh` | One open "Daily container vulnerability findings" issue: edit it if it exists, create it otherwise. It does not use the search API (it returns nothing for a GitHub App token). |

## What the Dockerfile does for this

- Both base images are pinned by digest. The build stage runs on the build machine, so the arm64 image needs no emulated npm build.
- The runtime stage **removes** the Nginx modules this site never loads (geoip, image filter, njs, xslt) and `curl` and `envsubst`. apk then also removes the libraries only they needed (libxml2, libxslt, libgd, expat, fontconfig and more). The image keeps 20 packages.
- It runs `apk upgrade`, which takes the Alpine fixes published after the base image was built. **That makes a build depend on the Alpine mirror of the day.** The daily scan is what keeps it honest, and the `check_version.py` digest rule still pins the bases.

## Status on 2026-11-27

| Check | Result |
|---|---|
| `npm audit` | 0 vulnerabilities (7 moderate ones in `typescript-eslint` were fixed by updating it to 8.74.0). |
| Repository scan | clean. It does detect a planted secret and a planted root Dockerfile (both tested). |
| Smoke test | passes on amd64 and arm64. |
| Image scan | passes on both architectures **with 6 accepted Nginx findings** (fixed in 1.30.7, not yet published). The exception ends on 2026-12-27. |
| Before this phase's Dockerfile change | 26 fixable HIGH or CRITICAL findings (libxml2, libxslt, expat, curl, musl, zlib and Nginx). The change removed 20 of them. |

### The accepted Nginx findings (owner decision, 2026-11-27)

| CVE | Needs | In this configuration |
|---|---|---|
| CVE-2026-113425 | the mail proxy | not used |
| CVE-2026-121810 | HTTP/3 | not used |
| CVE-2026-123007, CVE-2026-123633 | HTTP/2 | not used (plain HTTP/1.1 on port 8080) |
| CVE-2026-118899 | `listen ... ssl` | not used (no TLS here) |
| CVE-2026-123634 | a subrequest (SSI or `mirror`) to a location that resolves the same name | not used |

Nginx 1.30.7 is **not yet published** in the `nginxinc/nginx-unprivileged` images (the newest is 1.30.6) and not in the Alpine repository (`apk upgrade` does not offer it). Trivy calls these "fixable" because the fix exists upstream, so without an exception the gate would block every release until it is published.

The owner accepted them for a limited time. The exception cannot hide a real risk:

- **It ends by itself on 2026-12-27.** After that the gate blocks again.
- **It covers exactly these 6 advisories** of the package `nginx` at the fixed version `1.30.7-r0`. Another advisory, package or fixed version is not covered.
- **It stops applying when the configuration enables a feature the advisories need.** `security/check_nginx_features.py` fails on HTTP/2, HTTP/3, QUIC, TLS, mail, stream, SSI, `mirror`, `load_module`, and on any `listen` that is not a plain port. The last rule is strict on purpose: a new listener should make someone reread this section.
- **It prints every accepted finding on every run** (`ACCEPTED ... until 2026-12-27`), and prints a note for an entry that is no longer reported, so it gets removed.

When Nginx 1.30.7 is published, run `python security/refresh_base.py`, rebuild, and delete the entries. If it is still unpublished near the date, decide again.

## Not done or not verified

- GitHub Actions run none of this yet (phase 11), and no GitHub repository exists, so `remediate.sh` and `upsert-issue.sh` were tested only with a stubbed `gh`. `remediate.sh` was never run end to end.
- CodeQL is not set up. It is only free for a public repository.
- SonarQube has never analysed this project (see `SONARQUBE.md`).
- Trivy reports an alpine Linux version (3.24.x) from the base image. It does not scan the Angular bundle's dependencies in the image, because the bundle is compiled static files. They are covered by `npm audit` and the scan of `package-lock.json`.
