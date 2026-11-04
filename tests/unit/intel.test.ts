import { describe, expect, it } from 'vitest';
import { blobToEmbed, chunkPages, cosine, embed, embedToBlob, hybridSearch } from '../../apps/server/src/services/intel.ts';
import type { ChunkRow } from '../../apps/server/src/repos/library.ts';

describe('local embeddings', () => {
  it('are deterministic and L2-normalized', () => {
    const a = embed('cell membrane transport osmosis');
    const b = embed('cell membrane transport osmosis');
    expect([...a]).toEqual([...b]);
    const norm = Math.sqrt(a.reduce((acc, v) => acc + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it('score similar texts higher than unrelated ones', () => {
    const doc = embed('osmosis moves water across a semipermeable membrane toward higher solute concentration');
    const near = embed('water moves across the membrane by osmosis');
    const far = embed('the treaty of versailles reshaped european borders in 1919');
    expect(cosine(doc, near)).toBeGreaterThan(cosine(doc, far));
  });

  it('round-trip through blob storage', () => {
    const vec = embed('photosynthesis light reactions');
    const back = blobToEmbed(embedToBlob(vec));
    expect(cosine(vec, back)).toBeCloseTo(1, 5);
  });
});

describe('chunkPages', () => {
  it('splits long text on paragraphs with page tracking', () => {
    const para = 'Water moves across membranes. '.repeat(40); // ~1200 chars
    const pages = [
      { page: 1, text: `# Intro\n\n${para}`, headings: ['Intro'] },
      { page: 2, text: `${para}\n\n${para}`, headings: [] },
    ];
    const chunks = chunkPages(pages);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]!.pageStart).toBe(1);
    expect(chunks.some((c) => c.pageEnd === 2)).toBe(true);
    expect(chunks[0]!.headingPath).toBe('Intro');
  });

  it('drops tiny fragments', () => {
    const chunks = chunkPages([{ page: 1, text: 'hi', headings: [] }]);
    expect(chunks).toHaveLength(0);
  });
});

describe('hybridSearch', () => {
  const row = (id: string, content: string): ChunkRow & { rank: number } => ({
    id, user_id: 'u', document_id: 'd1', page_start: 1, page_end: 1, heading_path: '', content,
    embedding: embedToBlob(embed(content)), rank: 0,
  });

  it('fuses keyword and semantic rankings (RRF)', () => {
    const kw = [row('a', 'osmosis definition water membrane'), row('b', 'unrelated history of mining')];
    const embedded = [row('b', 'unrelated history of mining'), row('a', 'osmosis definition water membrane')];
    const results = hybridSearch('osmosis membrane water', kw, embedded, 5);
    expect(results[0]!.id).toBe('a');
  });

  it('returns semantic-only hits when keywords miss', () => {
    const kw: (ChunkRow & { rank: number })[] = [];
    const embedded = [row('s1', 'diffusion passive transport gradient'), row('s2', 'napoleonic wars timeline')];
    const results = hybridSearch('passive transport across gradients', kw, embedded, 5);
    expect(results[0]!.id).toBe('s1');
  });
});
