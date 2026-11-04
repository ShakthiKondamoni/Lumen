# Lumen security model

This is a single-machine application. The goal is: nothing leaves the
machine except the AI provider calls you configure, and nothing on the
machine can touch another user's data.

## Network boundary

- The API binds to **127.0.0.1 only** — never reachable from other machines.
- A host/origin boundary rejects any request whose `Host` is not the local
  API host, and any browser `Origin` that is not the local web origin. The
  only additional accepted origin is `lumen://local` (the Electron
  renderer), which a web page cannot forge.
- Cross-origin requests from the desktop shell get a scoped CORS grant
  (credentials allowed, headers limited to `content-type` and
  `x-csrf-token`); everything else is same-origin only.

## Accounts and sessions

- Passwords: **scrypt** (Node built-in, per-user random salt, 64-byte key)
  with constant-time comparison. Login responses are uniform for unknown
  users and wrong passwords.
- Sessions: 256-bit opaque tokens; only a SHA-256 hash is stored. The
  cookie is **HttpOnly + SameSite=Strict** with a 30-day expiry. Logout and
  logout-all revoke server-side.
- Registration/login are rate-limited (sliding window, in-memory).

## CSRF

Mutating requests with an authenticated session require a double-submit
token: the readable `lumen_csrf` cookie value must be echoed in the
`x-csrf-token` header. The desktop renderer (which cannot read 127.0.0.1
cookies) obtains the same token from `GET /api/auth/csrf` over its
credentialed CORS grant. All covered by tests, including the negative case.

## Provider API keys

- Encrypted with **AES-256-GCM** using a 32-byte master key created on
  first run at `data/secret.key`.
- Keys are **never** returned to any client (the API exposes only
  `hasKey: true/false`), never logged, and never included in backups.
- An undecryptable key makes that provider silently skipped by routing
  rather than crashing a turn.

## Per-user isolation

Every repository query filters by `user_id` (child tables through their
parents). Ownership is re-checked per request; cross-user access returns
404 rather than 403 so IDs do not leak existence. Dedicated tests verify
that a second account sees none of the first account's documents, notes,
decks or tasks, and cannot fetch their files.

## Input handling

- Every request body passes a Zod schema before any logic runs.
- Uploads: MIME sniffing (magic bytes) plus extension allow-list
  (PDF/DOCX/TXT/MD), 100 MB cap, and **checksum-based duplicate
  rejection**.
- Storage keys are server-generated UUIDs re-validated on every read;
  path escapes are rejected.
- The web app ships a strict CSP (`script-src 'self'`, `object-src 'none'`)
  and the markdown renderer escapes all HTML before rendering a safe
  subset — assistant output is never trusted as raw HTML.
- SQL is exclusively parameterized.

## Audit

`audit_events` records registration, logins, logout-all and account
changes with timestamps — local accountability without telemetry.

## Honest limits

- The machine's local admin can always read `data/` — this is not DRM.
- There is no 2FA/email recovery: accounts exist to separate study data
  per person on a shared computer, not to defend against the machine's
  owner.
- The Windows installer is unsigned (no certificate configured).
