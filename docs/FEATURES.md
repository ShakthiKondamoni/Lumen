# Lumen features — what it does, and what it does not

## Included

### Accounts & settings
- Local multi-user accounts (scrypt passwords, session cookies, logout-all).
- Per-user settings: theme, density, reduced motion, **desired retention**
  (feeds FSRS scheduling).
- JSON backup export/import (notes, tasks, decks; metadata for the rest).

### Library & intelligence
- Upload PDF, DOCX, TXT, Markdown (≤ 100 MB); per-subject organization;
  rename/move; delete removes chunks and the stored file.
- Extraction with page tracking and font-size heading detection; DOCX as a
  single long page; FTS-indexed notes and chunks.
- **OCR required** flagging for image-only PDFs; on-demand OCR over the
  native Tesseract CLI or the bundled tesseract.js engine; per-page
  progress and cancellation.
- In-app reader: native PDF viewer with page jump, per-page chunk panel,
  in-document hybrid search.

### AI
- Providers: OpenAI-compatible (incl. Ollama, LM Studio), Anthropic, Gemini.
- Encrypted key storage; connection tester; per-provider model catalogue.
- **Model routing per task** with ordered fallback chains.
- **Chat** and **AI Tutor**: SSE streaming, Stop/cancel, one user message
  per turn (no double-persist on failure), conversation rename/delete,
  tutor grounding with page citations, document or whole-library scope.
- Quiz generation from document chunks (MCQ + optional short-answer),
  answer keys withheld until submission, graded attempts with citations,
  best-score tracking.

### Study loop
- **FSRS-4.5** review scheduling with the review queue (new cards
  interleaved with due cards), lapse/relearning handling, review log,
  14-day workload forecast.
- **Notes**: Markdown + live preview, `[[wiki links]]` resolved against
  titles (unresolved links are skipped), FTS search, command-palette reach.
- **Planner**: dated, estimated tasks with done toggling.
- **Focus**: 15/25/45/50-minute sessions feeding streak and stats.
- **Stats**: due-today, streak (reviews + focus), 7-day reviews/minutes,
  quiz average, workspace size, forecast chart.
- **Command palette** (Ctrl+K): jump to pages, documents and notes; global
  search across notes and documents.

### Design (Calm Studio)
- Three complete themes — **Paper** (light, warm), **Graphite** (dark
  neutral), **Midnight** (deep blue-black) — plus follow-OS mode, applied
  pre-paint with no flash.
- Comfortable/compact density; reduced-motion support; serif display
  headings; hairline borders; keyboard-first navigation; WCAG-AA oriented
  contrast.

## Deliberately not included (honest limits)

- **No neural embeddings** — semantic search uses deterministic hashed
  lexical vectors. It works offline and instantly, but it is not a
  replacement for a real embedding model; keyword (FTS5) ranking carries
  precision, the vector side adds recall.
- **No OCR at upload time** — scanned PDFs are flagged, and OCR runs when
  you ask. The bundled WASM engine downloads its language data once.
- **No PDF table extraction / layout reconstruction** — text and headings
  only.
- **Quiz generation needs a routed `quiz` provider** — there is no offline
  question generator (by design: generated content is AI-only, everything
  else is local).
- **No email verification, 2FA or password recovery** — accounts separate
  people on one machine; they are not internet-facing identities.
- **Unsigned Windows installer** — SmartScreen will warn on first install.
- **No cloud sync** — export/import JSON is the transport between machines.
- Concept maps are stored and editable via the API/UI shell but the visual
  graph canvas is planned, not shipped.
