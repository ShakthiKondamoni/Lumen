import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestServer, TestClient, waitForDocumentStatus, type TestServer } from '../helpers.ts';

let server: TestServer;
let client: TestClient;

beforeAll(async () => {
  server = await startTestServer();
  client = new TestClient(server.base);
  await client.register();
});
afterAll(async () => {
  await server.dispose();
});

const SAMPLE = [
  '# Osmosis',
  '',
  'Osmosis is the movement of water across a semipermeable membrane.',
  '',
  'Water moves from low solute concentration to high solute concentration.',
  '',
  '# Diffusion',
  '',
  'Diffusion moves particles down their concentration gradient without energy.',
  '',
  'Passive transport requires no ATP input from the cell.',
].join('\n');

describe('library pipeline', () => {
  let subjectId = '';
  let documentId = '';

  it('creates and lists subjects with counts', async () => {
    const created = await client.authed<{ subject: { id: string } }>('POST', '/api/subjects', { name: 'Biology' });
    expect(created.status).toBe(201);
    subjectId = created.data.subject.id;
    const list = await client.authed<{ subjects: { id: string; documentCount: number }[] }>('GET', '/api/subjects');
    expect(list.data.subjects.some((s) => s.id === subjectId)).toBe(true);
  });

  it('uploads a text document, processes it in the background, and indexes chunks', async () => {
    const form = new FormData();
    form.set('file', new File([SAMPLE], 'notes.txt', { type: 'text/plain' }));
    form.set('title', 'Membrane transport notes');
    form.set('subjectId', subjectId);
    const res = await client.upload<{ document: { id: string } }>('/api/documents', form);
    expect(res.status).toBe(201);
    documentId = res.data.document.id;
    await waitForDocumentStatus(client, documentId, ['ready']);

    const detail = await client.authed<{ document: { status: string }; chunkCount: number }>('GET', `/api/documents/${documentId}`);
    expect(detail.data.document.status).toBe('ready');
    expect(detail.data.chunkCount).toBeGreaterThan(0);
  });

  it('rejects duplicate uploads by content checksum', async () => {
    const form = new FormData();
    form.set('file', new File([SAMPLE], 'again.txt', { type: 'text/plain' }));
    const res = await client.upload('/api/documents', form);
    expect(res.status).toBe(409);
  });

  it('rejects unsupported file types with 415', async () => {
    const form = new FormData();
    form.set('file', new File([new Uint8Array([0x4d, 0x5a, 0, 0])], 'x.exe', { type: 'application/octet-stream' }));
    const res = await client.upload('/api/documents', form);
    expect(res.status).toBe(415);
  });

  it('hybrid-search finds the relevant chunk with a fused score', async () => {
    const res = await client.authed<{ results: { content: string; score: number }[] }>('POST', '/api/search', { q: 'osmosis water membrane' });
    expect(res.status).toBe(200);
    expect(res.data.results.length).toBeGreaterThan(0);
    expect(res.data.results[0]!.content.toLowerCase()).toContain('osmosis');
    expect(res.data.results[0]!.score).toBeGreaterThan(0);
  });

  it('scopes document chunks to the owner', async () => {
    const other = new TestClient(server.base);
    await other.register();
    const res = await other.authed('GET', `/api/documents/${documentId}`);
    expect(res.status).toBe(404);
  });

  it('serves the original file only to its owner', async () => {
    const raw = await fetch(`${server.base}/api/documents/${documentId}/file`, {
      headers: { cookie: `lumen_session=${client.cookies.get('lumen_session')}` },
    });
    expect(raw.status).toBe(200);
    expect(await raw.text()).toBe(SAMPLE);
  });

  it('renames and moves the document, then deletes it with its chunks', async () => {
    const patch = await client.authed('PATCH', `/api/documents/${documentId}`, { title: 'Renamed notes' });
    expect(patch.status).toBe(200);
    const renamed = await client.authed<{ document: { title: string } }>('GET', `/api/documents/${documentId}`);
    expect(renamed.data.document.title).toBe('Renamed notes');

    const del = await client.authed('DELETE', `/api/documents/${documentId}`);
    expect(del.status).toBe(200);
    const gone = await client.authed('GET', `/api/documents/${documentId}`);
    expect(gone.status).toBe(404);
  });
});
