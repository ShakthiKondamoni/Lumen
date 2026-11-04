# Lumen architecture

## System shape

```
┌────────────────────────────────────────────────────────────────┐
│  Browser (http://localhost:5173)   ·   Electron (lumen://)     │
│  React 19 SPA — Calm Studio design system                      │
│  hash router · typed fetch client · SSE turn streaming         │
└───────────────┬────────────────────────────────────────────────┘
                │ /api (same-origin proxy | lumen CORS bridge)
┌───────────────▼────────────────────────────────────────────────┐
│  Hono API (127.0.0.1:8687, loopback-only)                      │
│                                                                │
│  routes/        HTTP only: validate → service → map errors     │
│  middleware.ts  request-id · host/origin boundary · sessions   │
│                 · CSRF · route protection · error mapper       │
│  services/      business rules: extraction, intelligence,      │
│                 jobs, AI adapters/routing, quiz-gen, stats     │
│  repositories/  the ONLY SQL layer — every query user-scoped   │
│  db/            node:sqlite adapter + append-only migrations   │
└───────────────┬────────────────────────────────────────────────┘
                │
        SQLite (WAL, FTS5)  ·  data/files storage  ·  AI providers
```

`packages/shared` holds the Zod contracts and the FSRS scheduler; both the
API and the web bundle import the same source, so a schema change fails the
typecheck everywhere at once.

## The no-bundler backend

The API is **run from TypeScript source** via Node 24's type stripping with
`--experimental-transform-types` (needed for parameter properties). There
is no server build step and no bundler to break: `node src/main.ts` is the
whole deployment story. The constraint is erasable-plus-transformable
syntax only — no enums, no namespaces — which the codebase respects.

## The esbuild-free web build

Recall's successor constraint: on some machines a security product blocks
the native `esbuild.exe` from file operations, which kills Vite's default
render-chunk pipeline (large payloads go through esbuild temp files). Lumen
is built to never invoke esbuild for output:

- **SWC** (`@vitejs/plugin-react-swc`) transforms TSX — an in-process NAPI
  addon inside node.exe, not a separate executable.
- **terser** (pure JS) minifies; `target: 'esnext'` skips esbuild
  transpilation (Vite's transpile plugin returns null in that
  configuration).
- Rollup (Node) writes `dist/`.

The shipped ZIP contains a prebuilt `apps/web/dist`, so the first run
requires no build at all; `pnpm build:web` reproduces it when needed.

## Database

`node:sqlite` (built into Node 24, WAL mode, foreign keys on). Eleven
append-only migrations create identity/sessions/audit, settings, providers
and routes, the library (subjects/documents), the intelligence layer
(chunks + external-content FTS5 triggers + jobs), conversations/messages,
notes (+ FTS), review (decks/cards/log), quizzes, planner/focus and
concepts. The migration runner records a SHA-256 of every applied
migration and **refuses to start if an applied migration's SQL changes**.

Repositories are the only code that touches SQL. Every table is
user-scoped; child tables without a `user_id` column (messages, note
links, quiz questions) are reached only through their parents.

## Intelligence pipeline

1. **Extract** — pdf.js (text + per-page heading detection via font-size
   heuristics), Mammoth for DOCX, UTF-8 for TXT/MD. A PDF whose pages are
   all image-only is flagged `ocr_required`.
2. **Chunk** — paragraph-aware ~1200-char chunks with overlap, carrying
   page ranges and heading paths.
3. **Embed** — 256-dim hashed word+bigram vectors, L2-normalized, stored as
   BLOBs. Deterministic, offline, fast — and honestly lexical (see
   FEATURES.md).
4. **Search** — FTS5 bm25 (titles weighted) fused with cosine similarity by
   reciprocal-rank fusion (k=60).
5. **OCR** — native Tesseract CLI when installed, otherwise tesseract.js
   WASM; PDF pages are rendered with @napi-rs/canvas. Progress checkpoints
   per page.

Background work runs in an in-process queue (2 workers) with persisted
progress, cooperative cancellation and typed failures, visible on the Jobs
page.

## AI layer

One normalized adapter over three wire formats (OpenAI-compatible chat
completions, Anthropic messages, Gemini generateContent), all streaming
SSE and all yielding `{delta}` / `{usage}` events. **Routing** maps each
task (`chat`, `tutor`, `quiz`, `summarize`) to an ordered list of
provider+model steps; a step that fails **before emitting anything** falls
through to the next, and a mid-stream failure propagates honestly. Turns
are persisted in two steps (user message before streaming, assistant
message after) so cancellation and failures never duplicate turns.

The tutor prompt is grounded with the top hybrid-search chunks for the
user's query (scoped to a document when chosen) and instructs the model to
cite `[n]` — citations are stored with the message.

## Desktop

Plain CommonJS Electron (no build step): sandboxed, context-isolated
renderer; `lumen://` custom protocol serving the packaged web build with
path-escape rejection; navigation/window/permission guards; a supervised
API child process (exits the app if it dies); single-instance lock; the
renderer reaches the API via the preload-provided `window.lumen.apiBase`
with a CORS grant for the `lumen://local` origin only.

## Web application

React 19 + Tailwind 4 with a dependency-free hash router. The **Calm
Studio** system defines three full token themes (paper, graphite, midnight)
plus `system`, density scales, reduced-motion, and a small component set
(Button/Card/Input/Modal/Badge/EmptyState…). Appearance applies pre-paint
via an external `theme-init.js` (CSP-safe) and mirrors to the user's
server-side settings on login.
