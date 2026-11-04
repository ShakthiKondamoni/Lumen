import { Hono } from 'hono';
import { subjectCreateSchema } from '@lumen/shared';
import { errors } from '../core.ts';
import { LibraryRepo, chunkDtoFromRow } from '../repos/library.ts';
import { JobRepo } from '../repos/jobs.ts';
import { ACCEPTED_MIMES, detectKind } from '../services/extract.ts';
import type { Deps, Env } from '../middleware.ts';
import { requireUser } from '../middleware.ts';

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export function libraryRouter(deps: Deps): Hono<Env> {
  const r = new Hono<Env>();
  const library = new LibraryRepo(deps.db);
  const jobs = new JobRepo(deps.db);

  r.get('/subjects', (c) => {
    const userId = requireUser(c);
    return c.json({
      subjects: library.listSubjects(userId).map((s) => ({ id: s.id, name: s.name, color: s.color, documentCount: s.document_count })),
    });
  });

  r.post('/subjects', async (c) => {
    const userId = requireUser(c);
    const input = subjectCreateSchema.parse(await c.req.json());
    const row = library.createSubject(userId, input.name, input.color ?? '#4A7C59');
    return c.json({ subject: { id: row.id, name: row.name, color: row.color, documentCount: 0 } }, 201);
  });

  r.delete('/subjects/:id', (c) => {
    const userId = requireUser(c);
    library.deleteSubject(userId, c.req.param('id'));
    return c.json({ ok: true });
  });

  r.get('/documents', (c) => {
    const userId = requireUser(c);
    const subjectId = c.req.query('subjectId') || undefined;
    return c.json({
      documents: library.listDocuments(userId, subjectId).map((d) => ({
        id: d.id, subjectId: d.subject_id, title: d.title, filename: d.filename, mime: d.mime,
        sizeBytes: d.size_bytes, pageCount: d.page_count, status: d.status, needsOcr: d.needs_ocr === 1, createdAt: d.created_at,
      })),
    });
  });

  r.post('/documents', async (c) => {
    const userId = requireUser(c);
    const form = await c.req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw errors.badRequest('Missing file field');
    if (file.size > MAX_UPLOAD_BYTES) throw errors.payloadTooLarge(`Maximum upload size is ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB`);
    const subjectId = typeof form.get('subjectId') === 'string' && form.get('subjectId') !== '' ? String(form.get('subjectId')) : null;
    if (subjectId && !library.subject(userId, subjectId)) throw errors.badRequest('Unknown subject');

    const buffer = Buffer.from(await file.arrayBuffer());
    const mime = file.type || 'application/octet-stream';
    if (!detectKind(file.name, mime, buffer)) throw errors.unsupportedMedia('Supported: PDF, DOCX, TXT, Markdown, Images (PNG, JPG, WEBP)');
    if (!ACCEPTED_MIMES.has(mime) && !/\.(pdf|docx|txt|md|markdown|png|jpe?g|webp|bmp)$/i.test(file.name)) {
      throw errors.unsupportedMedia('Supported: PDF, DOCX, TXT, Markdown, Images (PNG, JPG, WEBP)');
    }

    const { storageKey, checksum } = await deps.storage.save(buffer);
    const duplicate = library.documentByChecksum(userId, checksum);
    if (duplicate) {
      await deps.storage.delete(storageKey);
      throw errors.conflict(`Already in your library as "${duplicate.title}"`);
    }

    const title = typeof form.get('title') === 'string' && String(form.get('title')).trim() !== '' ? String(form.get('title')).trim() : file.name.replace(/\.[^.]+$/, '');
    const doc = library.createDocument({
      id: crypto.randomUUID(),
      user_id: userId,
      subject_id: subjectId,
      title,
      filename: file.name,
      mime: detectKind(file.name, mime, buffer) === 'pdf' ? 'application/pdf' : mime,
      size_bytes: buffer.length,
      checksum,
      storage_key: storageKey,
      page_count: null,
      status: 'processing',
      needs_ocr: 0,
    });
    jobs.create(userId, 'process-document', `Process ${title}`, { documentId: doc.id });
    return c.json({
      document: {
        id: doc.id, subjectId: doc.subject_id, title: doc.title, filename: doc.filename, mime: doc.mime,
        sizeBytes: doc.size_bytes, pageCount: doc.page_count, status: doc.status, needsOcr: false, createdAt: doc.created_at,
      },
    }, 201);
  });

  r.get('/documents/:id', (c) => {
    const userId = requireUser(c);
    const doc = library.document(userId, c.req.param('id'));
    if (!doc) throw errors.notFound('Document not found');
    return c.json({
      document: { id: doc.id, subjectId: doc.subject_id, title: doc.title, filename: doc.filename, mime: doc.mime, sizeBytes: doc.size_bytes, pageCount: doc.page_count, status: doc.status, needsOcr: doc.needs_ocr === 1, createdAt: doc.created_at },
      chunkCount: library.countChunks(userId, doc.id),
    });
  });

  r.patch('/documents/:id', async (c) => {
    const userId = requireUser(c);
    const body = await c.req.json().catch(() => ({})) as { title?: string; subjectId?: string | null };
    const patch: Parameters<LibraryRepo['updateDocument']>[2] = {};
    if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim().slice(0, 200);
    if (body.subjectId !== undefined) {
      if (body.subjectId !== null && !library.subject(userId, body.subjectId)) throw errors.badRequest('Unknown subject');
      patch.subject_id = body.subjectId;
    }
    library.updateDocument(userId, c.req.param('id'), patch);
    return c.json({ ok: true });
  });

  r.delete('/documents/:id', async (c) => {
    const userId = requireUser(c);
    const removed = library.deleteDocument(userId, c.req.param('id'));
    if (!removed) throw errors.notFound('Document not found');
    await deps.storage.delete(removed.storage_key);
    return c.json({ ok: true });
  });

  // Authenticated file serving for the reader (same-origin only).
  r.get('/documents/:id/file', (c) => {
    const userId = requireUser(c);
    const doc = library.document(userId, c.req.param('id'));
    if (!doc) throw errors.notFound('Document not found');
    const stream = deps.storage.readStream(doc.storage_key);
    return c.body(stream as unknown as ReadableStream, 200, {
      'content-type': doc.mime,
      'content-disposition': `inline; filename="${encodeURIComponent(doc.filename)}"`,
      'cache-control': 'no-store',
    });
  });

  r.get('/documents/:id/chunks', (c) => {
    const userId = requireUser(c);
    const doc = library.document(userId, c.req.param('id'));
    if (!doc) throw errors.notFound('Document not found');
    const rows = library.chunksForDocument(userId, doc.id);
    return c.json({ chunks: rows.map((row) => chunkDtoFromRow(row, doc.title)) });
  });

  r.post('/documents/:id/ocr', async (c) => {
    const userId = requireUser(c);
    const doc = library.document(userId, c.req.param('id'));
    if (!doc) throw errors.notFound('Document not found');
    if (doc.mime !== 'application/pdf') throw errors.badRequest('OCR applies to PDF documents');
    const body = await c.req.json().catch(() => ({})) as { pages?: number[] };
    const job = jobs.create(userId, 'ocr-document', `OCR ${doc.title}`, { documentId: doc.id, pages: body.pages });
    return c.json({ job }, 201);
  });

  return r;
}
