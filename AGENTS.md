# AGENTS.md

Instructions for coding agents working on AI Watch Web.

**The full rules are in [`CLAUDE.md`](CLAUDE.md). Read it first.** It is not repeated here, so that there is one copy to keep right. Then read [`MEMORY.md`](MEMORY.md) for the decisions and their reasons.

The rules that matter most, in short:

1. **Never expose the AI Watch server's monitor token** (`X-Monitor-Key`): not in the Angular code, the bundle, `/config.json`, browser storage, logs, test output, a command line or documentation. It lives only in the Docker secret and the generated Nginx file under `/tmp`.
2. **Never change the AI Watch server or firmware.** They are the source of truth.
3. **The app is read-only**: only `GET /health`, `GET /api/status` and `GET /api/sessions`.
4. **Never fabricate data.** Real data is never replaced by demo data.
5. **Verify before you claim.** Check behaviour in the code or by running it. A test that passes with its rule broken proves nothing, so break the rule and see it fail.
6. **Never bypass a failed gate** (tests, a Trivy finding, the Quality Gate). The only exceptions are the dated, owner-approved entries of `security/accepted-risks.json`.
7. **Do not add AI attribution** to commits or pull request descriptions. Use Conventional Commits.
8. **Keep answers short** and ask one question at a time, only for a real product decision.

Where to find things: `README.md` (what it is), `docs/ARCHITECTURE.md` (how), `docs/TESTING.md` (how to test), `docs/MAINTAINING.md` (routine jobs), `docs/TROUBLESHOOTING.md`, `CONTRIBUTING.md`.
