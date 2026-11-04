import { useEffect, useState } from 'react';
import { api } from '../api/client.ts';
import { navigate } from '../components/router.tsx';
import { Button, Card, ConfirmDialog, EmptyState, Input, PageHeader, Spinner, Textarea } from '../components/ui.tsx';
import { Markdown } from '../components/Markdown.tsx';
import { useToast } from '../state/app.tsx';
import type { NoteDto } from '@lumen/shared';

export function NotesPage({ selectedId }: { selectedId?: string }) {
  const { notify } = useToast();
  const [notes, setNotes] = useState<NoteDto[] | null>(null);
  const [draft, setDraft] = useState<{ id?: string; title: string; body: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = () => void api.get<{ notes: NoteDto[] }>('/api/notes').then((d) => setNotes(d.notes));
  useEffect(load, []);

  useEffect(() => {
    if (!selectedId || !notes) return;
    const n = notes.find((x) => x.id === selectedId);
    if (n && draft?.id !== n.id) setDraft({ id: n.id, title: n.title, body: n.body });
  }, [selectedId, notes]);

  const openNew = () => {
    setDraft({ title: '', body: '' });
    navigate('/notes');
  };

  const save = async () => {
    if (!draft || !draft.title.trim()) return;
    const data = await api.post<{ note: NoteDto }>('/api/notes', draft);
    notify('Note saved');
    setDraft(null);
    load();
    if (!selectedId) navigate(`/notes/${data.note.id}`);
  };

  const remove = async () => {
    if (!draft?.id) return;
    await api.delete(`/api/notes/${draft.id}`);
    notify('Note deleted');
    setDraft(null);
    navigate('/notes');
    load();
  };

  if (notes === null) return <Spinner label="Loading notes…" />;

  return (
    <div>
      <PageHeader
        title="Notes"
        subtitle="Markdown with [[wiki links]] — links resolve automatically to note titles"
        actions={
          <Button variant="primary" onClick={openNew}>
            New note
          </Button>
        }
      />
      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 'var(--space-4)', alignItems: 'start' }}>
        <Card pad={false} style={{ padding: 'var(--space-2)' }}>
          {notes.length === 0 ? (
            <div style={{ padding: 'var(--space-3)', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>No notes yet.</div>
          ) : (
            notes.map((n) => (
              <button key={n.id} className={`nav-item${(selectedId === n.id || draft?.id === n.id) && !draft?.id ? ' active' : ''}`} onClick={() => navigate(`/notes/${n.id}`)}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title}</span>
              </button>
            ))
          )}
        </Card>

        {draft === null ? (
          <Card>
            <EmptyState title="Select a note" action={<Button variant="primary" onClick={openNew}>Write something</Button>}>
              Notes support the full study loop: link related ideas with [[Note title]], then find everything again from the command palette (Ctrl+K).
            </EmptyState>
          </Card>
        ) : (
          <Card>
            <div style={{ display: 'flex', gap: 8, marginBottom: 'var(--space-3)' }}>
              <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Note title" style={{ fontWeight: 600 }} />
              <Button variant="primary" onClick={() => void save()} disabled={!draft.title.trim()}>
                Save
              </Button>
              {draft.id && (
                <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                  Delete
                </Button>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
              <Textarea value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} placeholder={'# Heading\n\nWrite with **bold**, `code`, lists and [[Links]].'} style={{ minHeight: 420, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }} />
              <div style={{ border: '1px solid var(--hairline)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)', background: 'var(--surface)', maxHeight: 420, overflowY: 'auto' }}>
                {draft.body.trim() === '' ? (
                  <p style={{ color: 'var(--text-faint)' }}>Live preview…</p>
                ) : (
                  <Markdown text={draft.body} />
                )}
              </div>
            </div>
          </Card>
        )}
      </div>

      <ConfirmDialog open={confirmDelete} title="Delete note" message="This note will be removed. Links pointing to it will simply stop resolving." onConfirm={() => void remove()} onClose={() => setConfirmDelete(false)} />
    </div>
  );
}
