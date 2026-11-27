# Contributing

Thanks for helping. This page is the short version; the details are linked.

## Before you start

- Read `README.md` (what it is) and `docs/ARCHITECTURE.md` (how it is built). `MEMORY.md` has the decisions and their reasons: check it before you change something that looks odd, because it probably has a reason.
- The AI Watch **server and firmware are the source of truth** and are not changed here. If their behaviour looks wrong, say so in an issue.
- The app is **read-only**: it may only call `GET /health`, `GET /api/status` and `GET /api/sessions`, and it never holds the server token.
- Open an issue before a large change, so the direction is agreed.

## Set up

```sh
nvm use                # Node from .nvmrc (the version in the Dockerfile)
npm ci
npm start              # the dev server; see docs/CONFIGURATION.md for AIW_DEV_TOKEN and AIW_DEV_UPSTREAM
```

Docker is needed for the proxy, installer and end-to-end tests. Playwright's browser: `npm run e2e:install` once.

## Before you open a pull request

```sh
npm run format:check
npm run lint
npm run typecheck
npm run test:ci          # unit tests with coverage
npm run build
```

And the suites your change touches (`docs/TESTING.md` says which):

- the app or its pages: `npm run e2e`
- anything under `docker/`: `npm run test:entrypoint` and `npm run test:proxy` on a rebuilt image
- anything under `deploy/`: `npm run test:deploy` (and `npm run test:deploy:windows` on Windows)
- anything under `release/`, `security/` or `.github/`: `npm run test:release` and `npm run test:security`

CI runs them again, but a pull request that fails them locally will not be reviewed.

## Rules for the code

- Standalone components, Signals, `OnPush`, strict TypeScript, lazy routes, no NgRx, no Bootstrap JavaScript, inline SVG icons. The full list is in `CLAUDE.md`.
- Colours only from the `--aiw-*` tokens, with 4.5:1 contrast in all three themes. No shadows, gradients or blur.
- A new dependency needs a reason in the pull request.
- Code, comments, UI text, tests and docs are in English.
- Write the test first when there is something to run, and **break the rule on purpose to see the test fail**. A test that passes with the rule broken proves nothing.
- Do not widen the Content Security Policy, do not add a call to a server route that writes, and never put a token, a password or a secret in a file, a log or a test output.
- When you change a command, an option or a message, update the help text and the docs.

## Commits and pull requests

- [Conventional Commits](https://www.conventionalcommits.org/), for example `feat(core): add status poller` or `fix(kiosk): fit 800x480`.
- Keep commits reviewable (about 400 changed lines), with the tests and docs that belong to the behaviour.
- A change that ships no file (docs, tests, CI) does not make a release. A change to a shipped file does (the list is in `docs/RELEASING.md`: most of `src/`, `docker/`, `deploy/`, `package.json` and `package-lock.json`; not specs, `src/app/testing/` or `docker/test/`).
- Do not add AI attribution lines to commits or pull request descriptions.

## Security

Do not report a vulnerability in a public issue: see `SECURITY.md`.
