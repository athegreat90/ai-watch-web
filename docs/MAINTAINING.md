# Maintaining

The routine jobs, and where the knowledge is. Read `MEMORY.md` first: it holds the decisions and the reasons.

## Things with a date

| What | When | What to do |
|---|---|---|
| **Six accepted Nginx findings** (`security/accepted-risks.json`) | They expire on **2026-12-27**. | When Nginx 1.30.7 is published, run `python security/refresh_base.py`, rebuild, and delete the entries. If it is still unpublished near the date, decide again: the gate blocks releases after it. |
| **The security GitHub App** | Not set up yet. | Step 5 of `RELEASING.md`: install the App and set `SECURITY_APP_CLIENT_ID` and `SECURITY_APP_PRIVATE_KEY`. Until then the daily `remediate.yml` cannot open its issue or pull request. |
| **First release** | Done: `v0.1.0`, 2026-11-27. | `main` is protected, so every change is a branch and a pull request, and the owner merges. See `RELEASING.md` for how a merge becomes a release. |

## Routine

| Job | How |
|---|---|
| **Base images** (Node and Nginx, pinned by digest) | The daily `remediate.yml` opens a pull request when a newer patch passes on both architectures. By hand: `python security/refresh_base.py`, then `python security/check_version.py --installed`. |
| **Scan the image** | `npm run security:image amd64` and `arm64` (Docker, network). A fixable HIGH or CRITICAL blocks a release. |
| **Scan the repository** | `npm run security:repo` (npm audit, Trivy for secrets and misconfiguration). |
| **Dependencies** | Dependabot opens weekly pull requests for npm and for the pinned action SHAs. Angular, TypeScript and RxJS move together within Angular's peer ranges: a major version of them is a deliberate upgrade (take the ranges from Angular's peer dependencies, never npm "latest"). |
| **Node** | `.nvmrc`, the Dockerfile's `NODE_IMAGE` and CI must agree (`security/check_version.py` fails otherwise). |
| **Reference repositories** | The firmware and the server are the source of truth and are never changed here. If their behaviour changes, update `docs/FUNCTIONAL-PARITY.md` and `docs/API.md`, and re-run the contract test against the new server release (change the digest in `compose.test.yaml`). |
| **A release** | Push shipped changes to `main`; the release is automatic after a green CI. `CHANGELOG.md` declares a higher version when you want to skip ahead. A failed release: **rerun the failed run**, do not push again (the tag is reserved first). |

## Reference repositories checked on 2026-11-27

| Repository | `main` head | Note |
|---|---|---|
| `ai-watch-server` | `a495671` | Same as analysed. The contract test runs against release **v1.1.4**; `main` is 6 commits ahead, and they only touch CI, docs and security scripts. |
| `ai-watch-firmware` | `fb7261e` | Analysed at `97bb7c9`. The two newer commits only update a GitHub Action in a workflow. |
| `ai-watch-hooks` | `646f476` | Same as analysed. |

## Changing the app

- A new status, field or route in the server: `core/api` first (the type guards and `parse.ts`, which must keep only `import type` because the contract test loads it directly), then the pages. Update `docs/API.md` and the contract test.
- A new agent in the limits table: `KNOWN_LIMIT_AGENTS` in `core/limits/limits-view.ts`. Any other agent the server reports is listed after the known ones.
- A colour: use the `--aiw-*` tokens only, keep 4.5:1 contrast in all three themes and while dimmed, and run the axe tests. jsdom cannot measure contrast, so look at the page in a browser after any colour change.
- The Nginx image: `npm run test:proxy` and `npm run test:entrypoint` must stay green on a rebuilt image. The Content Security Policy is never widened to make something work.
- Do not enable HTTP/2, HTTP/3, TLS, SSI, `mirror` or a dynamic module in the Nginx configuration without reading `docs/SECURITY.md`: the accepted findings are not exploitable only because none of them is on, and `security/check_nginx_features.py` voids the exception if one is.

## Rotating the monitor token

The token belongs to the AI Watch server. Change it there (it is `config.local.json`), put the new value in `secrets/monitor_key`, and recreate the page container (`./install.sh --force`). The installer will not overwrite the secret by itself: delete the old file first.

## When you add a rule

Add its test, break the rule to see the test fail, and put the decision and its reason in `MEMORY.md`. Update the help text and the docs when a command, an option or a message changes.
