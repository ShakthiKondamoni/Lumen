import type { Config } from '../config.ts';
import { errors, log } from '../core.ts';
import type { Db } from '../db/db.ts';
import { JobRepo, type JobRow } from '../repos/jobs.ts';
import { LibraryRepo } from '../repos/library.ts';
import type { FileStorage } from './storage.ts';
import { chunkPages, embed, embedToBlob, type RawPage } from './intel.ts';
import { extractAny, extractPdf, pickOcrEngine, renderPdfPage, type OcrEngine } from './extract.ts';

export interface JobContext {
  job: JobRow;
  progress: (pct: number) => void;
  cancelled: () => boolean;
}

type Handler = (ctx: JobContext) => Promise<void>;

/**
 * In-process job queue with cooperative cancellation. Runs document
 * processing and OCR jobs; every stage persists progress so the Jobs page
 * and operation stream can observe it.
 */
export class JobRunner {
  private handlers = new Map<string, Handler>();
  private active = new Set<string>();
  private stopped = false;

  constructor(
    private readonly db: Db,
    private readonly config: Config,
    private readonly storage: FileStorage,
    concurrency = 2,
  ) {
    this.register('process-document', (ctx) => this.processDocument(ctx));
    this.register('ocr-document', (ctx) => this.ocrDocument(ctx));
    for (let i = 0; i < concurrency; i++) void this.loop();
  }

  register(kind: string, handler: Handler): void {
    this.handlers.set(kind, handler);
  }

  stop(): void {
    this.stopped = true;
  }

  private repo(): JobRepo {
    return new JobRepo(this.db);
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      const row = this.db.get<JobRow>(
        `SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1`,
      );
      if (!row) {
        await sleep(500);
        continue;
      }
      this.repo().update(row.id, { status: 'running', attempts: row.attempts + 1 });
      this.active.add(row.id);
      try {
        const handler = this.handlers.get(row.kind);
        if (!handler) throw new Error(`No handler for job kind ${row.kind}`);
        await handler({
          job: row,
          progress: (pct) => this.repo().update(row.id, { progress: Math.max(0, Math.min(1, pct)) }),
          cancelled: () => {
            const fresh = this.db.get<{ cancel_requested: number }>(
              'SELECT cancel_requested FROM jobs WHERE id = ?',
              row.id,
            );
            return fresh?.cancel_requested === 1;
          },
        });
        const fresh = this.repo().job(row.user_id, row.id);
        const cancelled = fresh?.cancel_requested === 1;
        this.repo().update(row.id, { status: cancelled ? 'cancelled' : 'done', progress: cancelled ? fresh?.progress ?? 0 : 1 });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log('warn', 'jobs.failed', { jobId: row.id, kind: row.kind, error: message });
        this.repo().update(row.id, { status: 'failed', error: message.slice(0, 500) });
      } finally {
        this.active.delete(row.id);
      }
    }
  }

  // ----- document processing: extract → chunk → embed → index -----
  private async processDocument(ctx: JobContext): Promise<void> {
    const library = new LibraryRepo(this.db);
    const payload = JSON.parse(ctx.job.payload) as { documentId: string };
    const doc = library.document(ctx.job.user_id, payload.documentId);
    if (!doc) throw errors.notFound('Document no longer exists');
    library.updateDocument(doc.user_id, doc.id, { status: 'processing' });

    const buffer = await this.storage.read(doc.storage_key);
    const extraction = await extractAny(doc.filename, doc.mime, buffer);
    ctx.progress(0.4);
    if (ctx.cancelled()) return;

    if (extraction.needsOcr) {
      // Image-only PDF: no text to index. Flag it; user decides on OCR.
      library.updateDocument(doc.user_id, doc.id, { status: 'ocr_required', needs_ocr: 1, page_count: extraction.pageCount });
      return;
    }

    const pages: RawPage[] = extraction.pages.map((p) => ({ page: p.page, text: p.text, headings: p.headings }));
    const built = chunkPages(pages);
    if (built.length === 0) {
      library.updateDocument(doc.user_id, doc.id, { status: 'failed', page_count: extraction.pageCount });
      throw errors.badRequest('No extractable text found in this document');
    }
    library.deleteChunksForDocument(doc.user_id, doc.id);
    library.insertChunks(
      doc.user_id,
      doc.id,
      built.map((c) => ({
        page_start: c.pageStart,
        page_end: c.pageEnd,
        heading_path: c.headingPath,
        content: c.content,
        embedding: embedToBlob(embed(`${c.headingPath}\n${c.content}`)),
      })),
    );
    ctx.progress(0.95);
    library.updateDocument(doc.user_id, doc.id, { status: 'ready', page_count: extraction.pageCount, needs_ocr: 0 });
  }

  // ----- OCR: render pages → recognize → replace chunks -----
  private async ocrDocument(ctx: JobContext): Promise<void> {
    const library = new LibraryRepo(this.db);
    const engine: OcrEngine | null = await pickOcrEngine();
    if (!engine) throw errors.badRequest('No OCR engine available (install Tesseract or allow tesseract.js downloads)');
    const payload = JSON.parse(ctx.job.payload) as { documentId: string; pages?: number[] };
    const doc = library.document(ctx.job.user_id, payload.documentId);
    if (!doc) throw errors.notFound('Document no longer exists');
    const buffer = await this.storage.read(doc.storage_key);

    const pdfInfo = await extractPdf(buffer);
    const pageCount = pdfInfo.pageCount ?? 0;
    const targets = payload.pages && payload.pages.length > 0 ? payload.pages : Array.from({ length: pageCount }, (_, i) => i + 1);

    library.updateDocument(doc.user_id, doc.id, { status: 'processing' });
    const pages: RawPage[] = [];
    for (let i = 0; i < targets.length; i++) {
      if (ctx.cancelled()) {
        if (pages.length === 0) {
          library.updateDocument(doc.user_id, doc.id, { status: 'ocr_required', needs_ocr: 1 });
          return;
        }
        break;
      }
      const pageNo = targets[i]!;
      const png = await renderPdfPage(buffer, pageNo);
      const text = (await engine.recognize(png)).replace(/[ \t]+\n/g, '\n').trim();
      pages.push({ page: pageNo, text, headings: [] });
      ctx.progress(0.2 + (0.7 * (i + 1)) / targets.length);
    }

    const built = chunkPages(pages);
    if (built.length > 0) {
      library.deleteChunksForDocument(doc.user_id, doc.id);
      library.insertChunks(
        doc.user_id,
        doc.id,
        built.map((c) => ({
          page_start: c.pageStart,
          page_end: c.pageEnd,
          heading_path: c.headingPath,
          content: c.content,
          embedding: embedToBlob(embed(`${c.headingPath}\n${c.content}`)),
        })),
      );
    }
    library.updateDocument(doc.user_id, doc.id, { status: 'ready', needs_ocr: 0, page_count: pageCount });
    log('info', 'ocr.completed', { engine: engine.name, pages: pages.length, jobId: ctx.job.id });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
