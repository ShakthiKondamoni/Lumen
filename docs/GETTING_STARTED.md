# Getting started with Lumen

## Requirements

- **Node.js 24 LTS** (`node --version` → v24.x; the manifest allows `>=24 <27`).
- **pnpm 10.11** — Node ships Corepack: `corepack enable` once, or use
  `corepack pnpm` for every command below.
- That is all. The database, file storage and key material live in `data/`
  and are created on first run. No services, no accounts, no internet
  (except when your chosen AI providers need it).

## First run (Windows PowerShell, from the Lumen folder)

```powershell
Copy-Item .env.example .env      # optional — safe defaults exist
corepack pnpm install            # one-time dependency install
pnpm start                       # API on 127.0.0.1:8687 + web on 5173
```

Then open **http://localhost:5173**, click **Create account**, and sign in.
Everything you do stays on this machine under `data/`.

> `pnpm start` serves the **prebuilt** web bundle in `apps/web/dist`. It
> never rebuilds, so it works even on machines whose security software
> blocks the esbuild binary from writing files.

## Everyday use

| Command | What it does |
|---|---|
| `pnpm start` | API + prebuilt web app (preview mode, no hot reload) |
| `pnpm dev:web` | Vite dev server + API, with hot reload |
| `pnpm dev:server` | API only |
| `pnpm dev:desktop` | Electron desktop window (uses the dev web server) |
| `pnpm build:web` | Rebuild the production web bundle |
| `pnpm check` | typecheck + lint + full test suite |
| `pnpm package:win` | Build the web bundle, then the Windows installer (NSIS) |

After changing web code with `pnpm start`, rerun `pnpm build:web` and
restart, or switch to `pnpm dev:web` for automatic reloads.

## A five-minute tour

1. **Library → Upload document** — add a PDF, DOCX, TXT or Markdown file
   (≤ 100 MB). Processing runs in the background; watch **Jobs** for
   progress, then open the document to read it and see its indexed chunks.
2. **AI Tutor** — ask a question about what you uploaded. The tutor
   searches your library first and cites pages like `[1]`. Scope it to one
   document or your whole library.
3. **Settings → AI providers** — add Ollama (`http://localhost:11434/v1`,
   no key) for a fully offline setup, or a cloud provider with its API key.
   Then **Model routing** picks which model answers chat, tutoring, quiz
   generation and summaries — with fallback steps.
4. **Review** — flashcards scheduled by FSRS. Create decks and cards, then
   grade 1–4 (keyboard: Space to reveal, 1–4 to grade).
5. **Quizzes → Generate** — pick a processed document; Lumen writes
   questions grounded in its chunks and grades attempts with citations.
6. **Notes** — Markdown with `[[wiki links]]`; type `[[` and an existing
   note title to link. Find everything from **Ctrl+K**.

## Data & backups

- Database: `data/lumen.sqlite` · files: `data/files/` · key: `data/secret.key`
- **Settings → Account & data → Export backup** downloads a JSON snapshot
  (notes, cards, quizzes, tasks, metadata — never API keys).
- Delete `data/` to reset the installation completely.

## Desktop app (optional)

- Dev: `pnpm dev:desktop` (loads the Vite dev server).
- Package: `pnpm package:win` produces `apps/desktop/release/Lumen-Setup-*.exe`.
  The installer is **unsigned** (no certificate configured) — SmartScreen
  will ask you to confirm; the app itself is identical to the web build.

## Troubleshooting

- **Port already in use** — change `LUMEN_PORT` / `LUMEN_WEB_PORT` in `.env`.
- **"No enabled provider is routed"** — configure a provider and route in
  Settings first; the tutor/chat/quiz features refuse to guess.
- **OCR button on a scanned PDF does nothing useful without engines** —
  install Tesseract (fast path) or allow `tesseract.js` to fetch its
  language data once (offline after that).
- **Forgotten password** — local accounts have no recovery flow by design;
  delete `data/lumen.sqlite` to start over (or ask on the project thread).
