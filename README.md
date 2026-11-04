# Lumen — a calm, local-first study workspace

Lumen is a personal study application that runs entirely on your machine:
a document library with AI-ready search, a grounded AI tutor, FSRS spaced
repetition, quiz generation, notes with wiki links, a planner, focus timer
and progress analytics — behind real multi-user accounts, with no cloud and
no telemetry.

Built from scratch as the successor design to the Recall project, with the
same product philosophy and a cleaner architecture, toolchain and UI.

```
Web (React 19 + Vite + SWC)  ·  API (Hono + node:sqlite)  ·  Desktop (Electron)
```

## Highlights

- **Library** — upload PDF, DOCX, TXT and Markdown; text extraction,
  heading-aware chunking and page citations; scanned PDFs are flagged
  **OCR required** and can be OCR'd with a native or bundled engine.
- **Hybrid search** — SQLite FTS5 keyword ranking fused (RRF) with local
  hashed-embedding similarity. Fully offline.
- **AI Tutor & Chat** — streaming answers over SSE with inline citations,
  document scoping, turn cancellation, and a provider **routing with
  fallback chains** per task.
- **Providers** — OpenAI-compatible (OpenAI, Groq, OpenRouter, **Ollama**,
  **LM Studio**), Anthropic and Google Gemini. API keys are AES-256-GCM
  encrypted at rest and never returned to the client.
- **Review** — FSRS-4.5 scheduling with per-user desired retention.
- **Quizzes** — AI-generated MCQ + short-answer questions grounded in your
  documents, graded locally with citations.
- **Notes** — Markdown with live preview and `[[wiki links]]` that resolve
  automatically; full-text search.
- **Planner, Focus, Stats** — dated tasks, timed sessions feeding your
  streak, and a 14-day review workload forecast.
- **Real accounts** — scrypt-hashed passwords, HttpOnly session cookies,
  CSRF double-submit tokens, login rate limiting, per-user data isolation,
  JSON backup export/import.

## Quick start

See **[GETTING_STARTED.md](docs/GETTING_STARTED.md)**. In short:

```powershell
corepack pnpm install
pnpm start           # starts the API + serves the prebuilt web app
# open http://localhost:5173 and create your account
```

A prebuilt web bundle is included, so the first run needs **no web build** —
this keeps Lumen working on machines where the esbuild binary is blocked
from file operations (the full build uses SWC + terser instead and works
there too; see `docs/ARCHITECTURE.md`).

## Repository layout

```
apps/server     Hono API: routes → services → repositories → SQLite
apps/web        React SPA (Calm Studio design system, 3 themes)
apps/desktop    Electron shell (sandboxed renderer, supervised API child)
packages/shared Zod contracts + FSRS scheduler shared by web and server
scripts         dev / build / typecheck entry points
tests           unit + full HTTP API integration tests (Vitest)
docs            GETTING_STARTED, ARCHITECTURE, SECURITY, TESTING, FEATURES
```

## Verification status

All checks below were run on the target Windows machine before packaging:

- `pnpm typecheck` — clean (strict TypeScript, three projects)
- `pnpm lint` — clean (eslint, zero warnings)
- `pnpm test` — **66/66 passing** (unit + live API integration, portable paths)
- `pnpm build:web` — passes on this machine (SWC + terser; no esbuild)
- Live smoke — page serve, registration, authenticated API calls, document
  upload → background processing → hybrid search all verified over HTTP.

Known limitations are listed honestly in `docs/FEATURES.md` (no OCR at
upload time, hashed embeddings are lexical approximations rather than
neural models, quiz generation requires a routed provider, and the Windows
installer is unsigned).

## License note

This is a private, local application. No account, subscription or network
service is involved beyond the AI providers you configure yourself.
