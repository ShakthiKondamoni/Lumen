import { Hono } from 'hono';
import { z } from 'zod';
import { errors } from '../core.ts';
import { collectStats } from '../services/stats.ts';
import { exportBackup, importBackup } from '../services/backup.ts';
import type { Deps, Env } from '../middleware.ts';
import { requireUser } from '../middleware.ts';

export function miscRouter(deps: Deps): Hono<Env> {
  const r = new Hono<Env>();

  r.get('/stats', (c) => {
    const userId = requireUser(c);
    return c.json({ stats: collectStats(deps.db, userId) });
  });

  r.get('/backup/export', (c) => {
    const userId = requireUser(c);
    return c.json(exportBackup(deps.db, userId), 200, {
      'content-disposition': `attachment; filename="lumen-backup-${new Date().toISOString().slice(0, 10)}.json"`,
    });
  });

  r.post('/backup/import', async (c) => {
    const userId = requireUser(c);
    const input = z
      .object({
        notes: z.array(z.object({ title: z.string().min(1), body: z.string().default('') })).optional(),
        planTasks: z.array(z.object({ title: z.string().min(1), dueDate: z.string().nullable().optional() })).optional(),
        decks: z.array(z.object({ name: z.string().min(1), cards: z.array(z.object({ front: z.string(), back: z.string() })).default([]) })).optional(),
      })
      .parse(await c.req.json());
    const result = importBackup(deps.db, userId, input);
    return c.json({ imported: result });
  });

  r.get('/health', (c) => c.json({ ok: true }));

  r.post('/export/pdf', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { title?: string; content?: string };
    const title = body.title || 'Lumen AI Study Guide';
    const content = body.content || '';

    const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    let page = pdfDoc.addPage([595.28, 841.89]); // A4
    const { height } = page.getSize();
    let y = height - 50;

    // Header Title
    page.drawText(title.slice(0, 50), { x: 50, y, size: 18, font: fontBold, color: rgb(0.18, 0.35, 0.23) });
    y -= 22;
    page.drawText(`Generated with Lumen AI · ${new Date().toLocaleDateString()}`, { x: 50, y, size: 9, font, color: rgb(0.45, 0.45, 0.45) });
    y -= 25;

    // Divider
    page.drawLine({
      start: { x: 50, y },
      end: { x: 545, y },
      thickness: 1,
      color: rgb(0.85, 0.85, 0.82),
    });
    y -= 20;

    const lines = content.split('\n');
    for (const rawLine of lines) {
      if (y < 60) {
        page = pdfDoc.addPage([595.28, 841.89]);
        y = height - 50;
      }
      const line = rawLine.trim();
      if (!line) {
        y -= 10;
        continue;
      }
      if (line.startsWith('#')) {
        y -= 6;
        const headingText = line.replace(/^#+\s*/, '');
        page.drawText(headingText.slice(0, 70), { x: 50, y, size: 12, font: fontBold, color: rgb(0.15, 0.15, 0.15) });
        y -= 18;
      } else {
        const words = line.split(' ');
        let currentLine = '';
        for (const w of words) {
          if ((currentLine + w).length > 85) {
            page.drawText(currentLine, { x: 50, y, size: 9.5, font, color: rgb(0.2, 0.2, 0.2) });
            y -= 14;
            if (y < 60) {
              page = pdfDoc.addPage([595.28, 841.89]);
              y = height - 50;
            }
            currentLine = w + ' ';
          } else {
            currentLine += w + ' ';
          }
        }
        if (currentLine) {
          page.drawText(currentLine, { x: 50, y, size: 9.5, font, color: rgb(0.2, 0.2, 0.2) });
          y -= 14;
        }
      }
    }

    const pdfBytes = await pdfDoc.save();
    return new Response(pdfBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${title.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf"`,
      },
    });
  });

  r.use('/admin/*', () => {
    void deps;
    throw errors.forbidden('No admin surface in the local app');
  });

  return r;
}
