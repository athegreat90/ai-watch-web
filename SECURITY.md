# Security policy

## Supported versions

Only the newest stable release receives security fixes. Older versions are not patched: update to the latest.

## Reporting a vulnerability

**Do not open a public issue for a vulnerability.**

Use GitHub's private reporting on this repository: the **Security** tab, then **Report a vulnerability**. Include:

- what you found and what an attacker could do with it,
- the version or image digest (`docker inspect` shows it) and how it is deployed,
- the smallest steps that reproduce it.

**Never include a real monitor token, a password, or the contents of `secrets/` or `.env`.** If a real secret is part of the problem, say so and we will agree how to share it.

This is a small project. A report is read as soon as possible and answered when there is something to say, but there is no promise of a response time.

## What counts

Anything that breaks one of these promises:

- the AI Watch server's monitor token appears anywhere a browser, a log, a process list, an image layer or a release asset can see it;
- a browser (or anyone reaching the page) can make the proxy call a route other than `GET /health`, `GET /api/status` and `GET /api/sessions`, change the server's data, or choose the key it sends;
- the Content Security Policy can be bypassed, or script can run in the page;
- the installers overwrite a secret, write one with a mode that exposes it, or accept a download that does not match its checksum;
- a release can be published for a commit that did not pass CI, or a published version tag can be changed.

## What does not count

- **No TLS.** The container serves plain HTTP on purpose, and HTTP basic authentication over it is readable on the network. This is documented in `docs/DEPLOYMENT.md`: use a private network or a TLS reverse proxy.
- Vulnerabilities of the **AI Watch server** itself. Report those to `ai-watch-server`.
- A local user with access to the Docker socket or to the host's files. They can read the secret anyway.
- Findings in a base image that already have an entry in `security/accepted-risks.json`: those are known, dated, and described in `docs/SECURITY.md`.

## What is checked

Every release is scanned for fixable HIGH and CRITICAL vulnerabilities on both architectures, for secrets and misconfiguration, and its npm dependencies are audited. How, and what blocks a release, is in `docs/SECURITY.md`.
