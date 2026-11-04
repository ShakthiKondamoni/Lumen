import { useEffect, useState } from 'react';
import { api, qs } from '../api/client.ts';
import { navigate } from '../components/router.tsx';
import { Badge, Button, Card, ConfirmDialog, Input, PageHeader, Spinner } from '../components/ui.tsx';
import { useToast } from '../state/app.tsx';
import type { ChunkDto, DeckDto, DocumentDto, JobDto } from '@lumen/shared';

interface PageHighlight {
  id: string;
  page: number;
  text: string;
  color: string;
  note?: string;
}

export function ReaderPage({ documentId }: { documentId: string }) {
  const { notify } = useToast();
  const [doc, setDoc] = useState<DocumentDto | null>(null);
  const [chunkCount, setChunkCount] = useState(0);
  const [page, setPage] = useState(1);
  const [chunks, setChunks] = useState<ChunkDto[] | null>(null);
  const [find, setFind] = useState('');
  const [hits, setHits] = useState<ChunkDto[]>([]);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Text selection & Annotations state
  const [selectedText, setSelectedText] = useState('');
  const [highlights, setHighlights] = useState<PageHighlight[]>(() => {
    try {
      const saved = localStorage.getItem(`lumen_highlights_${documentId}`);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const load = () => {
    void api.get<{ document: DocumentDto; chunkCount: number }>(`/api/documents/${documentId}`).then((d) => {
      setDoc(d.document);
      setChunkCount(d.chunkCount);
    });
  };
  useEffect(load, [documentId]);

  useEffect(() => {
    setChunks(null);
    void api.get<{ chunks: ChunkDto[] }>(`/api/documents/${documentId}/chunks`).then((d) => setChunks(d.chunks));
  }, [documentId, doc?.status]);

  // Persist highlights
  useEffect(() => {
    localStorage.setItem(`lumen_highlights_${documentId}`, JSON.stringify(highlights));
  }, [highlights, documentId]);

  // Listen to mouseup selection on chunks
  const handleMouseUp = () => {
    const sel = window.getSelection()?.toString().trim();
    if (sel && sel.length >= 3) {
      setSelectedText(sel);
    }
  };

  const runSearch = async () => {
    if (find.trim().length < 2) {
      setHits([]);
      return;
    }
    const data = await api.post<{ results: ChunkDto[] }>('/api/search', { q: find, documentId, limit: 12 });
    setHits(data.results);
  };

  const startOcr = async () => {
    setOcrBusy(true);
    try {
      await api.post<{ job: JobDto }>(`/api/documents/${documentId}/ocr`, {});
      notify('OCR started — watch the Jobs page for progress');
      load();
    } finally {
      setOcrBusy(false);
    }
  };

  const remove = async () => {
    await api.delete(`/api/documents/${documentId}`);
    navigate('/library');
  };

  // Action: Create Cloze Card from selected text
  const makeClozeCard = async () => {
    if (!selectedText) return;
    try {
      const { decks } = await api.get<{ decks: DeckDto[] }>('/api/decks');
      let deckId = decks[0]?.id;
      if (!deckId) {
        const { deck } = await api.post<{ deck: DeckDto }>('/api/decks', { name: doc?.title || 'Study Deck' });
        deckId = deck.id;
      }
      await api.post(`/api/decks/${deckId}/cards`, {
        front: `According to ${doc?.title} (p. ${page}): {{c1::${selectedText}}}`,
        back: `Source: ${doc?.title}, Page ${page}`,
      });
      notify('✓ Created Cloze Flashcard in review queue!');
      setSelectedText('');
    } catch {
      notify('Failed to create flashcard');
    }
  };

  // Action: Ask AI Tutor about selection
  const askAITutor = async () => {
    if (!selectedText) return;
    try {
      const res = await api.post<{ conversation: { id: string } }>('/api/conversations', {
        kind: 'tutor',
        documentId,
        title: `Question: ${selectedText.slice(0, 32)}…`,
      });
      navigate(`/chat?c=${res.conversation.id}`);
    } catch {
      notify('Failed to start AI Tutor conversation');
    }
  };

  // Action: Save as Markdown Note
  const saveAsNote = async () => {
    if (!selectedText) return;
    try {
      await api.post('/api/notes', {
        title: `${doc?.title} (Page ${page})`,
        body: `> ${selectedText}\n\n*Reference: [[${doc?.title}]] — Page ${page}*\n`,
      });
      notify('✓ Added excerpt to your Notes!');
      setSelectedText('');
    } catch {
      notify('Failed to save note');
    }
  };

  // Action: Highlight text
  const addHighlight = () => {
    if (!selectedText) return;
    const newHl: PageHighlight = {
      id: Math.random().toString(36).slice(2, 9),
      page,
      text: selectedText,
      color: 'var(--accent-soft)',
    };
    setHighlights((prev) => [newHl, ...prev]);
    notify('✓ Text highlighted for page ' + page);
    setSelectedText('');
  };

  const removeHighlight = (id: string) => {
    setHighlights((prev) => prev.filter((h) => h.id !== id));
  };

  if (!doc) return <Spinner label="Opening document…" />;

  const fileUrl = `/api/documents/${documentId}/file${qs({})}`;
  const isPdf = doc.mime === 'application/pdf';
  const chunkForPage = (p: number) => (chunks ?? []).filter((c) => p >= c.pageStart && p <= c.pageEnd);
  const pageHighlights = highlights.filter((h) => h.page === page);

  return (
    <div>
      <PageHeader
        title={doc.title}
        subtitle={`${doc.filename} · ${doc.pageCount ?? '?'} pages · ${chunkCount} indexed chunks`}
        actions={
          <>
            {doc.status === 'ocr_required' && (
              <Button variant="primary" disabled={ocrBusy} onClick={() => void startOcr()}>
                {ocrBusy ? 'Starting…' : 'Run OCR'}
              </Button>
            )}
            <Button onClick={() => navigate('/library')}>← Library</Button>
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          </>
        }
      />

      <div style={{ display: 'flex', gap: 8, marginBottom: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
        <Badge tone={doc.status === 'ready' ? 'accent' : doc.status === 'ocr_required' ? 'warning' : doc.status === 'failed' ? 'danger' : 'info'}>{doc.status}</Badge>
        {isPdf && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <Button size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))}>
              ‹
            </Button>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
              page {page} / {doc.pageCount ?? '?'}
            </span>
            <Button size="sm" onClick={() => setPage((p) => Math.min(doc.pageCount ?? p + 1, p + 1))}>
              ›
            </Button>
            <Input
              type="number"
              min={1}
              max={doc.pageCount ?? undefined}
              value={page}
              onChange={(e) => setPage(Math.max(1, Math.min(doc.pageCount ?? 9999, Number(e.target.value) || 1)))}
              style={{ width: 76 }}
            />
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, flex: 1, maxWidth: 380, marginLeft: 'auto' }}>
          <Input placeholder="Search inside this document…" value={find} onChange={(e) => setFind(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void runSearch()} />
          <Button onClick={() => void runSearch()}>Find</Button>
        </div>
      </div>

      {/* Floating Selection Action Banner */}
      {selectedText && (
        <div
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--accent)',
            borderRadius: 8,
            padding: '12px 16px',
            marginBottom: 'var(--space-4)',
            boxShadow: 'var(--shadow-pop)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ fontSize: 'var(--text-sm)', maxWidth: 480, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <span style={{ color: 'var(--text-faint)', marginRight: 6 }}>Selected:</span>
            <strong>"{selectedText}"</strong>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Button size="sm" variant="primary" onClick={() => void makeClozeCard()}>
              🗂️ Make Cloze Card
            </Button>
            <Button size="sm" onClick={() => void askAITutor()}>
              ✨ Ask AI Tutor
            </Button>
            <Button size="sm" onClick={() => void saveAsNote()}>
              📝 Save Note
            </Button>
            <Button size="sm" onClick={addHighlight}>
              🖍️ Highlight
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setSelectedText('')}>
              ✕
            </Button>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: isPdf ? '1.6fr 1fr' : '1fr', gap: 'var(--space-4)', alignItems: 'start' }}>
        {isPdf && (
          <Card pad={false} style={{ overflow: 'hidden' }}>
            <iframe key={page} src={`${fileUrl}#page=${page}`} title={doc.title} style={{ width: '100%', height: 640, border: 0, background: 'var(--surface-2)' }} />
          </Card>
        )}

        <div style={{ display: 'grid', gap: 'var(--space-4)' }} onMouseUp={handleMouseUp}>
          {hits.length > 0 && (
            <Card>
              <h3 style={{ fontSize: 'var(--text-lg)' }}>Matches</h3>
              <div style={{ display: 'grid', gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
                {hits.map((h) => (
                  <div key={h.id} style={{ borderTop: '1px solid var(--hairline)', paddingTop: 'var(--space-3)' }}>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-faint)', marginBottom: 4 }}>
                      {h.documentTitle} · pages {h.pageStart}–{h.pageEnd}
                      {h.headingPath ? ` · ${h.headingPath}` : ''}
                    </div>
                    <div style={{ fontSize: 'var(--text-sm)' }}>
                      {h.content.slice(0, 280)}
                      {h.content.length > 280 ? '…' : ''}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Page Highlights & Notes */}
          {pageHighlights.length > 0 && (
            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontSize: 'var(--text-sm)', margin: 0, fontWeight: 600 }}>🖍️ Highlights on Page {page}</h3>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-faint)' }}>{pageHighlights.length} active</span>
              </div>
              <div style={{ display: 'grid', gap: 6, marginTop: 'var(--space-3)' }}>
                {pageHighlights.map((h) => (
                  <div
                    key={h.id}
                    style={{
                      padding: '6px 10px',
                      background: 'var(--accent-soft)',
                      borderRadius: 4,
                      fontSize: 'var(--text-xs)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <span style={{ color: 'var(--accent-strong)' }}>"{h.text}"</span>
                    <button
                      type="button"
                      onClick={() => removeHighlight(h.id)}
                      style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 12 }}
                      title="Remove highlight"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {doc.status === 'ocr_required' && (
            <Card>
              <h3 style={{ fontSize: 'var(--text-lg)' }}>Scanned document</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                Every page of this PDF is image-only, so no text could be extracted. Run OCR to recognize the text — pages are processed locally; with the built-in engine the recognition data is fetched once.
              </p>
            </Card>
          )}

          {doc.status === 'processing' && (
            <Card>
              <Spinner label="Processing in the background — chunks appear when ready." />
            </Card>
          )}

          {!isPdf && chunks !== null && (
            <Card>
              <h3 style={{ fontSize: 'var(--text-lg)' }}>Extracted text</h3>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-faint)', marginBottom: 'var(--space-2)' }}>
                Tip: Select any text to create a Cloze Card, ask the AI Tutor, or save a note.
              </p>
              <div style={{ fontSize: 'var(--text-sm)', whiteSpace: 'pre-wrap', marginTop: 'var(--space-3)', maxHeight: 560, overflowY: 'auto' }}>
                {chunks.map((c) => (
                  <p key={c.id}>{c.content}</p>
                ))}
                {chunks.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No text indexed yet.</p>}
              </div>
            </Card>
          )}

          {isPdf && chunks !== null && chunks.length > 0 && (
            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontSize: 'var(--text-base)', margin: 0, fontWeight: 600 }}>This page in the index</h3>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-faint)' }}>Select text to create flashcards</span>
              </div>
              <div style={{ display: 'grid', gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
                {chunkForPage(page).map((c) => (
                  <div key={c.id} style={{ borderTop: '1px solid var(--hairline)', paddingTop: 'var(--space-3)', fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>
                    {c.headingPath && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--accent)', marginBottom: 4 }}>{c.headingPath}</div>}
                    {c.content}
                  </div>
                ))}
                {chunkForPage(page).length === 0 && (
                  <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: 'var(--text-sm)' }}>No indexed chunks reference page {page}.</p>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>

      <ConfirmDialog open={confirmDelete} title="Delete document" message={`"${doc.title}" will be removed along with its chunks.`} onConfirm={() => void remove()} onClose={() => setConfirmDelete(false)} />
    </div>
  );
}
