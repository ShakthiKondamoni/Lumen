import type { ChunkDto } from '@lumen/shared';
import type { ChunkRow } from '../repos/library.ts';

// ---------- hashed local embeddings ----------
// A deterministic local embedding: words + bigrams hashed into a fixed
// 256-dim vector, L2-normalized. This is NOT a neural embedding — it is a
// lexical-approximation used for semantic-ish recall on a fully offline
// machine. Honest limitation, also documented in FEATURES.md.

export const EMBEDDING_DIMS = 256;

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function embed(text: string): Float32Array {
  const vec = new Float32Array(EMBEDDING_DIMS);
  const words = text.toLowerCase().match(/[a-z0-9']{2,}/g) ?? [];
  const grams: string[] = [...words];
  for (let i = 0; i < words.length - 1; i++) grams.push(`${words[i]}_${words[i + 1]}`);
  for (const g of grams) {
    const h = fnv1a(g);
    const idx = h % EMBEDDING_DIMS;
    vec[idx] = (vec[idx] ?? 0) + (h >>> 31 ? -1 : 1);
  }
  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIMS; i++) norm += vec[i]! * vec[i]!;
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < EMBEDDING_DIMS; i++) vec[i] = vec[i]! / norm;
  return vec;
}

export function embedToBlob(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

export function blobToEmbed(blob: Buffer): Float32Array {
  return new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += a[i]! * b[i]!;
  return dot;
}

// ---------- chunking ----------
export interface RawPage {
  page: number;
  text: string;
  headings: string[];
}

export interface BuiltChunk {
  pageStart: number;
  pageEnd: number;
  headingPath: string;
  content: string;
}

const TARGET_CHARS = 1200;
const OVERLAP_CHARS = 150;

/** Structure-aware chunking: paragraphs first, then hard split with overlap. */
export function chunkPages(pages: RawPage[]): BuiltChunk[] {
  const chunks: BuiltChunk[] = [];
  let heading = '';
  for (const p of pages) {
    if (p.headings.length > 0) heading = p.headings[p.headings.length - 1]!;
    const paragraphs = p.text.split(/\n{2,}/).map((t) => t.trim()).filter((t) => t.length > 0);
    let buffer = '';
    let startPage = p.page;
    let lastHeading = heading;
    const flush = (endPage: number) => {
      const content = buffer.trim();
      if (content.length >= 40) {
        chunks.push({ pageStart: startPage, pageEnd: endPage, headingPath: lastHeading, content });
      }
      buffer = buffer.length > OVERLAP_CHARS ? buffer.slice(-OVERLAP_CHARS) : '';
    };
    for (const para of paragraphs) {
      if (buffer.length + para.length + 1 > TARGET_CHARS && buffer.trim().length > 0) flush(p.page);
      if (buffer.trim().length === 0) {
        startPage = p.page;
        lastHeading = heading;
      }
      buffer += (buffer.length > 0 ? '\n\n' : '') + para;
      while (buffer.length > TARGET_CHARS * 2) {
        flush(p.page);
        buffer = para.slice(0, TARGET_CHARS);
      }
    }
    if (buffer.trim().length > 0) flush(p.page);
  }
  return chunks;
}

// ---------- hybrid search ----------
/**
 * Reciprocal-rank fusion of FTS5 keyword ranking and local-embedding cosine
 * ranking. Returns the top `limit` chunk rows with a fused score.
 */
export function hybridSearch(
  query: string,
  keywordHits: (ChunkRow & { rank: number })[],
  embedded: ChunkRow[],
  limit: number,
): (ChunkRow & { fused: number })[] {
  const K = 60;
  const scores = new Map<string, { row: ChunkRow; score: number }>();
  const bump = (row: ChunkRow, score: number) => {
    const cur = scores.get(row.id);
    if (cur) cur.score += score;
    else scores.set(row.id, { row, score });
  };
  keywordHits.forEach((row, idx) => bump(row, 1 / (K + idx + 1)));
  const qv = embed(query);
  const semantic = embedded
    .map((row) => ({ row, sim: row.embedding ? cosine(qv, blobToEmbed(row.embedding)) : -1 }))
    .sort((a, b) => b.sim - a.sim);
  semantic.forEach((entry, idx) => {
    if (entry.sim > 0.05) bump(entry.row, 1 / (K + idx + 1));
  });
  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((e) => ({ ...e.row, fused: e.score }));
}

export function toChunkDto(row: ChunkRow, documentTitle: string, score?: number): ChunkDto {
  return {
    id: row.id,
    documentId: row.document_id,
    documentTitle,
    pageStart: row.page_start,
    pageEnd: row.page_end,
    headingPath: row.heading_path,
    content: row.content.length > 1200 ? `${row.content.slice(0, 1200)}…` : row.content,
    ...(score !== undefined ? { score: Math.round(score * 1000) / 1000 } : {}),
  };
}
