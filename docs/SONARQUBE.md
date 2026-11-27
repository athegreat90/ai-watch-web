# SonarQube

Code quality and security analysis for this repository, set up like the one of `ai-watch-server`. A passing SonarQube Quality Gate is a **required check for publishing**: no `vX.Y.Z` image tag and no `latest` comes from a commit whose analysis failed.

> **Status:** the configuration (`sonar-project.properties`) and the coverage report exist and were checked locally. **No analysis has run yet**: it needs the SonarQube project, the Tailscale credential and the GitHub repository, which do not exist yet. The `sonar` job of `ci.yml` is written and waits for them.

## How it works

| Item | Value |
|---|---|
| Server | `https://sonarqube.alexandermora.de` (reachable only inside the tailnet) |
| Project key | `athegreat90_ai-watch-web` |
| Runs on | Pushes to `main` and manual runs of `CI` on `main`. Never on pull requests. |
| Network | The GitHub-hosted runner joins the tailnet as an ephemeral `tag:ci` node using OIDC workload identity federation. No long-lived Tailscale key. SonarQube is not exposed publicly, and TLS verification is never disabled. |
| Inputs | `coverage/ai-watch-web/lcov.info` from `npm run test:ci`, and `sonar-project.properties` |
| Gate | `sonar.qualitygate.wait=true`, `sonar.qualitygate.timeout=300`. A failed gate fails the `sonar` job, so CI fails and releases are blocked. |

Analysed as production code: `src/`. Classified as tests: `*.spec.ts`, `e2e/`, `tests/`. Excluded from coverage: `src/main.ts` and `src/app/testing/`. The Docker files, the shell scripts and the Python scripts are covered by their own tests (`npm run test:entrypoint`, `test:proxy`, `test:security`), not by Sonar.

Current local coverage: 94.5 % of lines, 92.3 % of branches (583 unit tests).

## One-time setup (needs admin access)

1. **SonarQube project.** Create `athegreat90_ai-watch-web` (manually, "Other CI"). Generate a project analysis token. Never put it in a file or on a command line.
2. **Quality Gate.** Assign a gate whose conditions apply to new code: bugs = 0, vulnerabilities = 0, code smells = 0, security hotspots reviewed = 100 %, coverage >= 80 %, duplicated lines <= 3 %, reliability, security and maintainability ratings = A. A gate without conditions always passes and enforces nothing.
3. **Tailscale ACL.** `"tagOwners": {"tag:ci": ["autogroup:admin"]}` and a grant `{"src": ["tag:ci"], "dst": ["<SonarQube tailnet IP>"], "ip": ["tcp:9000"]}`. The grant of `ai-watch-server` is enough if it already exists.
4. **Tailscale trust credential** (OpenID Connect, issuer GitHub). Use the immutable subject format, which includes the owner and repository IDs. Read it from the new repository with `gh api repos/athegreat90/ai-watch-web/actions/oidc/customization/sub`, and build the subject as `repo:athegreat90@<owner id>/ai-watch-web@<repository id>:ref:refs/heads/main`. The short form is rejected with HTTP 403. Scope: Auth Keys, Write. Tag: `tag:ci`. Create a new credential for this repository, because the others are bound to their own.
5. **GitHub secrets and variable** (`athegreat90/ai-watch-web`):
   ```sh
   gh secret set TS_OAUTH_CLIENT_ID -R athegreat90/ai-watch-web
   gh secret set TS_AUDIENCE        -R athegreat90/ai-watch-web
   gh secret set SONAR_TOKEN        -R athegreat90/ai-watch-web   # paste at the prompt
   gh variable set SONAR_HOST_URL   -R athegreat90/ai-watch-web --body "<URL the runner can reach>"
   ```
6. **Host URL.** The job runs with `--accept-dns=false`, so use the SonarQube tailnet IP over plain HTTP (it only travels inside the WireGuard tunnel), for example `http://100.x.y.z:9000`.
7. **First run.** Push to `main`, or run `CI` manually from `main` (other refs fail the OIDC subject by design).

Until steps 1 to 6 are done the `sonar` job fails and **automatic releases are paused**. That is intended.

## Local scan

```sh
npm run test:ci
SONAR_TOKEN=<token> sonar-scanner -Dsonar.host.url=https://sonarqube.alexandermora.de
```

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Tailscale step fails with `token exchange failed with status 403` | The credential subject does not match the OIDC token. Use the immutable subject from step 4, then check the audience, the Client ID secret and that the credential allows `tag:ci`. |
| `curl` to `/api/system/status` times out | The ACL grant is missing or wrong, or the SonarQube node is offline. |
| Analysis passes but nothing is enforced | The assigned Quality Gate has no conditions (step 2). |
| Coverage is 0 % | `npm run test:ci` did not run first, or the path in `sonar-project.properties` is wrong. On Windows the LCOV file has backslash paths, so scan from CI (Linux). |
| Gate fails on new code only | Expected: fix the new issues, or review the hotspots in the SonarQube UI. |
