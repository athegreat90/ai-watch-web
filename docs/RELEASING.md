# Releasing

How CI and releases work, and the one-time GitHub setup they need.

> **Status on 2026-11-27:** the repository exists and the workflows have run. `v0.1.0` was published automatically (tag, GitHub release with the bundle, both SBOMs and `SHA256SUMS`, and the multi-architecture image, with `:latest` at the same digest). Setup steps 1 to 4 and 6 below are done; step 5 (the security GitHub App) is not. The first push released nothing because its CI was red, and the merge of #1 released nothing because it changed no shipped file: a release needs a green `CI` on a push that changes a shipped path (`package.json` counts, a `.md` file does not).

## What runs

| Workflow | When | What it does |
|---|---|---|
| `ci.yml` | push and pull request to `main`, daily, manual | `node` (format, lint, types, unit tests with coverage, build, entrypoint tests, release and security tooling tests, pin check), `e2e` (image build, proxy tests, browser tests and the contract test against the pinned server), `static` (npm audit, Trivy, actionlint), `images` (amd64 and arm64: build, smoke test, Trivy, SBOM), `release-script` (the publication script against a local registry), `deploy` (the installer of the bundle against real Docker), `release-eligibility`, and `sonar` (not for pull requests). |
| `automatic-release.yml` | after `CI` succeeded on a push to `main` | Reserves a version for the tested commit, scans both architectures again, builds the assets, publishes the image and creates the GitHub release. |
| `publish-image.yml` | a release is published by hand, or run manually with a tag | The same publication script. It first requires a green `CI` run on `main` for that exact commit. |
| `remediate.yml` | daily, manual | Scans both images, keeps one issue with the findings, and opens a pull request when a newer Node or Nginx base image passes on both architectures. |
| `codeql.yml` | push, pull request, weekly | CodeQL for TypeScript. Free for a public repository only. |

## Versions

- The first release is **v0.1.0**, declared by `## [0.1.0]` in `CHANGELOG.md`. After that, each release is the next patch of the highest tag (published or not), unless `CHANGELOG.md` declares a higher version. A change to `CHANGELOG.md` alone releases nothing: a shipped file must change in the same push. A Node bump changes the Dockerfile, so `.nvmrc` is not listed on its own.
- The version tag is created **before** the image is scanned and published. If that run fails, **rerun the failed run** instead of pushing again: a new push would find the orphan tag and take the next patch.
- A push releases only if it changes a shipped file: `src/`, `public/`, `docker/` (except `docker/test/`), `deploy/`, `package.json`, `package-lock.json`, `angular.json`, `tsconfig.json`, `tsconfig.app.json`, `compose.yaml`, `compose.release.yaml` or `.dockerignore`. Markdown, specs, `e2e/`, `tests/`, `security/`, `release/`, `.nvmrc` and workflows never release by themselves.
- A version tag is **immutable**: it is never rebuilt or overwritten, and a rerun reuses the image. `latest` moves only to the highest stable version and always has the same digest as it. A prerelease (`v0.2.0-rc.1`, made by hand) never touches `latest`.
- Each release has: the image `ghcr.io/athegreat90/ai-watch-web:vX.Y.Z` (amd64 and arm64), `latest` when eligible, the deployment bundle `ai-watch-web-deploy-vX.Y.Z.zip` (built by `release/assets.sh` from `deploy/ai-watch-web-deploy/`, with the version in its `VERSION` file), the SBOM of each architecture, and `SHA256SUMS`. The installer inside the bundle checks every download against that `SHA256SUMS`.

## Why a release cannot go out untested

1. The release starts from a `CI` run that succeeded **on `main`, on a push, in this repository**, for exactly the commit it releases (not the branch tip).
2. `CI` includes the Quality Gate, the Trivy scan of both architectures and the browser tests. Any failure stops everything.
3. The release scans both architectures again before it publishes.
4. The manual path calls `release/require-ci.sh`, which refuses a commit without a green `CI` run.
5. Both paths share one queue (`publish-release`), so two publications never run at the same time.

## One-time GitHub setup

1. **Create the repository** `athegreat90/ai-watch-web` (public is assumed: free arm64 and CodeQL). Push `main`. *Done.*
2. **Protect `main`.** *Done on 2026-11-27*, as classic branch protection: a pull request is required (0 approvals, because a single owner cannot approve their own pull request; raise it when there are collaborators), the branch must be up to date, conversations must be resolved, force pushes and deletion are off, and it applies to administrators too (turn that off in Settings, Branches, only for an emergency, and back on afterwards). Required status checks: `node`, `e2e`, `static`, `images (amd64)`, `images (arm64)`, `release-script`, `deploy` and `analyze` (CodeQL). Do not require `release-eligibility` (it only runs on a push to `main`) or `sonar` (it never runs for pull requests). `sonar` blocks the release instead, because the release only starts from a green `CI` run.
3. **Workflow permissions.** Leave the repository default at read-only (Settings, Actions, General). Each workflow asks for the permissions it needs, and only the release workflows ask to write.
4. **Make the GHCR package public** after the first image is pushed: the package page, Package settings, Change visibility. Users pull it without a login.
5. **The security GitHub App** (the one `ai-watch-server` uses): install it on this repository, then set the variable `SECURITY_APP_CLIENT_ID` and the secret `SECURITY_APP_PRIVATE_KEY`. It needs Contents, Issues and Pull requests: Read and write. A 403 means the App is not installed here or lacks one of them.
6. **SonarQube:** follow `SONARQUBE.md` (project, Quality Gate, Tailscale ACL and trust credential, `TS_OAUTH_CLIENT_ID`, `TS_AUDIENCE`, `SONAR_TOKEN`, `SONAR_HOST_URL`). Until then the `sonar` job fails and **automatic releases are paused**, on purpose.
7. **Dependabot** is configured in `.github/dependabot.yml`. It opens the pull requests that move the pinned action SHAs.

## Try the publication script yourself

```sh
bash release/test_push_image.sh   # needs Docker with buildx and QEMU, takes a few minutes
```

It starts a throwaway registry and builder, publishes real multi-platform images, and checks the rules above. It removes everything and does not change your default builder.

## Rolling back

Versions are immutable, so a bad release is replaced by a newer one, not edited. To make an older image the one people run, point the compose file at its version tag (`AI_WATCH_WEB_IMAGE=ghcr.io/athegreat90/ai-watch-web:vX.Y.Z`). `latest` only moves forward; if a bad `latest` must be undone, publish a fixed higher version.

## Known limits

- Nothing here ran on GitHub yet (see the status at the top).
- `queue: max` under `concurrency` is accepted by GitHub (the sibling repositories use it) but the pinned actionlint does not know it, so that one message is ignored.
- The first release needs the SBOMs, so the release job always scans both architectures.
- The PowerShell installer is tested only on a Windows machine with Docker Desktop (`npm run test:deploy:windows`): GitHub's Windows runners cannot run Linux containers, so CI covers `install.sh` only.
