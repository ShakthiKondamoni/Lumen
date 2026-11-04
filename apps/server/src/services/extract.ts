import { execFile } from 'node:child_process';
import { writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { errors, log } from '../core.ts';

// Extraction service: turns uploaded bytes into per-page text with heading
// detection, and renders PDF pages for OCR. All local — nothing leaves the
// machine.

export interface ExtractedPage {
  page: number;
  text: string;
  headings: string[];
  hasText: boolean;
}

export interface Extraction {
  mime: string;
  pages: ExtractedPage[];
  pageCount: number | null;
  needsOcr: boolean;
}

const PDF_MIMES = new Set(['application/pdf']);
const DOCX_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const TEXT_MIMES = new Set(['text/plain', 'text/markdown']);
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/bmp']);

export const ACCEPTED_MIMES = new Set([...PDF_MIMES, ...DOCX_MIMES, ...TEXT_MIMES, ...IMAGE_MIMES]);

function looksLikePdf(buf: Buffer): boolean {
  return buf.subarray(0, 5).toString('latin1') === '%PDF-';
}

function looksLikeDocx(buf: Buffer): boolean {
  return buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b; // PK zip header
}

function looksLikeImage(buf: Buffer): boolean {
  if (buf.length < 4) return false;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true; // PNG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true; // JPEG
  if (buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return true; // WEBP
  return false;
}

export function detectKind(filename: string, mime: string, buf: Buffer): 'pdf' | 'docx' | 'text' | 'image' | null {
  if (looksLikePdf(buf) || PDF_MIMES.has(mime)) return 'pdf';
  if (DOCX_MIMES.has(mime) || looksLikeDocx(buf) || filename.toLowerCase().endsWith('.docx')) return 'docx';
  if (TEXT_MIMES.has(mime) || /\.(txt|md|markdown)$/i.test(filename)) return 'text';
  if (looksLikeImage(buf) || IMAGE_MIMES.has(mime) || /\.(png|jpe?g|webp|bmp)$/i.test(filename)) return 'image';
  return null;
}

// ---------- PDF ----------
interface PdfTextItem {
  str: string;
  height?: number;
  transform?: number[];
}

export async function extractPdf(buffer: Buffer): Promise<Extraction> {
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as {
    getDocument: (src: unknown) => { promise: Promise<PdfDoc> };
  };
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: false,
    isEvalSupported: false,
    verbosity: 0,
  }).promise;
  const pages: ExtractedPage[] = [];
  let imageOnlyPages = 0;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = content.items as PdfTextItem[];
    const heights = items.filter((i) => i.height && i.height > 0).map((i) => i.height!).sort((a, b) => a - b);
    const median = heights.length > 0 ? heights[Math.floor(heights.length / 2)]! : 0;
    const headings: string[] = [];
    const lines: string[] = [];
    for (const item of items) {
      const str = item.str ?? '';
      if (str.trim().length === 0) continue;
      if (median > 0 && (item.height ?? 0) >= median * 1.3 && str.trim().length <= 120) {
        headings.push(str.trim());
      }
      lines.push(str);
    }
    const text = lines.join(' \n').replace(/\n{3,}/g, '\n\n').trim();
    if (text.length < 20) imageOnlyPages++;
    pages.push({ page: p, text, headings, hasText: text.length >= 20 });
    page.cleanup();
  }
  const needsOcr = imageOnlyPages === doc.numPages && doc.numPages > 0;
  await doc.destroy();
  return { mime: 'application/pdf', pages, pageCount: doc.numPages, needsOcr };
}

interface PdfDoc {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
  destroy(): Promise<void>;
}

interface PdfPage {
  getTextContent(): Promise<{ items: PdfTextItem[] }>;
  getViewport(opts: { scale: number }): { width: number; height: number };
  render(opts: Record<string, unknown>): { promise: Promise<void> };
  cleanup(): void;
}

/** Render one PDF page to a PNG buffer (used before OCR). */
export async function renderPdfPage(buffer: Buffer, pageNumber: number, scale = 1.5): Promise<Buffer> {
  const { createCanvas } = await import('@napi-rs/canvas');
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as {
    getDocument: (src: unknown) => { promise: Promise<any> };
  };
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, verbosity: 0 }).promise;
  try {
    const page = await doc.getPage(Math.min(Math.max(1, pageNumber), doc.numPages));

    // Fast & Crash-Free Path for Scanned PDFs: Extract embedded full-page image directly
    try {
      const ops = await page.getOperatorList();
      for (let i = 0; i < ops.fnArray.length; i++) {
        if (ops.fnArray[i] === 85 && ops.argsArray[i]?.[0]) {
          const imgName = ops.argsArray[i][0];
          const img: any = await new Promise((res) => {
            if (page.objs?.get) page.objs.get(imgName, (obj: any) => res(obj));
            else res(null);
          });
          if (img && img.data && img.width && img.height) {
            const canvas = createCanvas(img.width, img.height);
            const ctx = canvas.getContext('2d');
            const imgData = ctx.createImageData(img.width, img.height);
            let j = 0;
            if (img.data.length === img.width * img.height * 3) {
              for (let k = 0; k < img.data.length; k += 3) {
                imgData.data[j++] = img.data[k];
                imgData.data[j++] = img.data[k + 1];
                imgData.data[j++] = img.data[k + 2];
                imgData.data[j++] = 255;
              }
            } else if (img.data.length === img.width * img.height * 4) {
              imgData.data.set(img.data);
            } else if (img.data.length === img.width * img.height) {
              for (let k = 0; k < img.data.length; k++) {
                const g = img.data[k];
                imgData.data[j++] = g;
                imgData.data[j++] = g;
                imgData.data[j++] = g;
                imgData.data[j++] = 255;
              }
            }
            ctx.putImageData(imgData, 0, 0);
            return canvas.toBuffer('image/png');
          }
        }
      }
    } catch (e) {
      log('warn', 'ocr.direct-image-failed', { error: String(e) });
    }

    // Fallback: Safe Bounded Canvas Render
    const rawVp = page.getViewport({ scale: 1.0 });
    const maxDim = Math.max(rawVp.width, rawVp.height);
    const safeScale = maxDim > 1200 ? 1200 / maxDim : Math.min(scale, 1.5);
    const viewport = page.getViewport({ scale: safeScale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    return canvas.toBuffer('image/png');
  } finally {
    await doc.destroy();
  }
}

// ---------- DOCX ----------
export async function extractDocx(buffer: Buffer): Promise<Extraction> {
  const mammoth = (await import('mammoth')) as unknown as {
    extractRawText: (opts: { buffer: Buffer }) => Promise<{ value: string }>;
  };
  const { value } = await mammoth.extractRawText({ buffer });
  const text = value.replace(/\r\n/g, '\n').trim();
  // DOCX has no pages; model as a single long page.
  return {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pages: [{ page: 1, text, headings: [], hasText: text.length > 0 }],
    pageCount: null,
    needsOcr: false,
  };
}

// ---------- text / markdown ----------
export function extractText(buffer: Buffer): Extraction {
  const text = buffer.toString('utf8').replace(/\r\n/g, '\n').trim();
  const headings = [...text.matchAll(/^#{1,3}\s+(.+)$/gm)].map((m) => m[1]!.trim());
  return {
    mime: 'text/markdown',
    pages: [{ page: 1, text, headings, hasText: text.length > 0 }],
    pageCount: null,
    needsOcr: false,
  };
}

// ---------- images (direct OCR) ----------
export async function extractImage(buffer: Buffer): Promise<Extraction> {
  const engine = await pickOcrEngine();
  if (!engine) {
    return {
      mime: 'image/png',
      pages: [{ page: 1, text: '', headings: [], hasText: false }],
      pageCount: 1,
      needsOcr: true,
    };
  }
  const text = (await engine.recognize(buffer)).replace(/[ \t]+\n/g, '\n').trim();
  const headings = [...text.matchAll(/^#{1,3}\s+(.+)$/gm)].map((m) => m[1]!.trim());
  return {
    mime: 'image/png',
    pages: [{ page: 1, text, headings, hasText: text.length > 0 }],
    pageCount: 1,
    needsOcr: text.length === 0,
  };
}

export async function extractAny(filename: string, mime: string, buffer: Buffer): Promise<Extraction> {
  const kind = detectKind(filename, mime, buffer);
  if (kind === 'pdf') return extractPdf(buffer);
  if (kind === 'docx') return extractDocx(buffer);
  if (kind === 'text') return extractText(buffer);
  if (kind === 'image') return extractImage(buffer);
  throw errors.unsupportedMedia(`Unsupported file type: ${mime || filename}`);
}

// ---------- OCR (dual engine) ----------
export interface OcrEngine {
  name: string;
  recognize: (png: Buffer) => Promise<string>;
}

/**
 * Native Tesseract CLI when installed (fast), tesseract.js WASM otherwise
 * (zero install). Returns null when no engine can run.
 */
export async function pickOcrEngine(): Promise<OcrEngine | null> {
  const native = await new Promise<boolean>((resolvePromise) => {
    try {
      execFile('tesseract', ['--version'], { timeout: 5000 }, (err) => resolvePromise(!err));
    } catch {
      resolvePromise(false);
    }
  });
  if (native) {
    return {
      name: 'tesseract-cli',
      recognize: (png) =>
        new Promise((resolvePromise, rejectPromise) => {
          const inFile = join(tmpdir(), `lumen-ocr-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
          void writeFile(inFile, png)
            .then(() => {
              execFile(
                'tesseract',
                [inFile, 'stdout', '--psm', '3'],
                { timeout: 120_000, maxBuffer: 32 * 1024 * 1024 },
                (err, stdout) => {
                  void rm(inFile, { force: true }).catch(() => undefined);
                  if (err) rejectPromise(err);
                  else resolvePromise(stdout);
                },
              );
            })
            .catch(rejectPromise);
        }),
    };
  }
  try {
    const tesseract = (await import('tesseract.js')) as unknown as {
      recognize: (image: Buffer, lang?: string, opts?: Record<string, unknown>) => Promise<{ data: { text: string } }>;
    };
    return {
      name: 'tesseract-wasm',
      recognize: async (png) => {
        const result = await tesseract.recognize(png, 'eng', { logger: () => undefined });
        return result.data.text;
      },
    };
  } catch (err) {
    log('warn', 'ocr.engine-unavailable', { error: String(err) });
    return null;
  }
}
