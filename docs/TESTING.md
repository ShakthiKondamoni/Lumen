# Testing Lumen

## What exists

```
tests/
  helpers.ts            boots a REAL API on an ephemeral port with a
                        throwaway data dir; cookie-jar + CSRF test client
  unit/fsrs.test.ts     FSRS math properties (monotonicity, lapses, clamps)
  unit/intel.test.ts    embeddings, chunking, hybrid-search fusion
  unit/security.test.ts scrypt, tokens, AES-GCM + tamper, rate limiter
  unit/migrations.test.ts apply/idempotence/tamper-detection/tables
  api/auth.test.ts      registration, login, logout-all, CSRF enforcement,
                        origin boundary, uniform auth errors, structured 404s
  api/library.test.ts   upload → background processing → chunks → hybrid
                        search → ownership → duplicates → deletion
  api/ai.test.ts        provider CRUD (no key leak), model catalogue,
                        routing, SSE turn streaming, concurrency guard,
                        provider fallback chain, quiz generation + grading
  api/app.test.ts       FSRS endpoints, notes wiki-links, planner/focus,
                        stats, settings validation, backup export/import,
                        cross-user isolation
```

66 tests total. The API tests exercise the **real HTTP surface** (not
function calls): real cookies, real CSRF handshake, real multipart upload,
a stub OpenAI-compatible SSE provider for streaming, and a deliberately
broken provider for the fallback chain.

Everything is portable: temp dirs from `os.tmpdir()` (no hardcoded
sandbox paths — a deliberate fix over the predecessor project), explicit
Host/Origin headers, no POSIX-only file-mode assertions.

## Running

```powershell
pnpm test          # full suite (watch: pnpm test:watch)
pnpm typecheck     # strict tsc over shared + server + web
pnpm lint          # eslint
pnpm check         # all three
```

## Conventions for new tests

- API tests: `startTestServer()` once per file in `beforeAll`,
  `TestClient.register()` per scenario, `client.authed()` for mutations.
  Use `waitForDocumentStatus`/poll helpers for background jobs — never
  fixed sleeps against real work.
- Unit tests stay pure (no I/O) except the database/security ones, which
  create their own temp files.
- Every new route needs at least: happy path, validation failure, and an
  ownership or CSRF negative case.
