import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client.ts';
import { navigate } from '../components/router.tsx';
import { Badge, Button, Card, ConfirmDialog, EmptyState, formatBytes, formatDate, Input, Modal, PageHeader, Select, Spinner } from '../components/ui.tsx';
import { useToast } from '../state/app.tsx';
import type { DocumentDto, SubjectDto } from '@lumen/shared';

export function LibraryPage() {
  const { notify } = useToast();
  const [docs, setDocs] = useState<DocumentDto[] | null>(null);
  const [subjects, setSubjects] = useState<SubjectDto[]>([]);
  const [filter, setFilter] = useState<string>('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [subjectOpen, setSubjectOpen] = useState(false);
  const [newSubject, setNewSubject] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DocumentDto | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = () => {
    void api.get<{ documents: DocumentDto[] }>(`/api/documents${filter ? `?subjectId=${filter}` : ''}`).then((d) => setDocs(d.documents));
    void api.get<{ subjects: SubjectDto[] }>('/api/subjects').then((d) => setSubjects(d.subjects));
  };
  useEffect(load, [filter]);

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.set('file', file);
      if (title.trim()) form.set('title', title.trim());
      if (subjectId) form.set('subjectId', subjectId);
      await api.upload('/api/documents', form);
      notify('Uploaded — processing in the background');
      setUploadOpen(false);
      setFile(null);
      setTitle('');
      load();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  const addSubject = async () => {
    if (!newSubject.trim()) return;
    try {
      await api.post('/api/subjects', { name: newSubject.trim() });
      setNewSubject('');
      setSubjectOpen(false);
      load();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : 'Could not add subject');
    }
  };

  const remove = async (doc: DocumentDto) => {
    await api.delete(`/api/documents/${doc.id}`);
    notify('Document deleted');
    load();
  };

  const statusBadge = (d: DocumentDto) => {
    if (d.status === 'ready') return <Badge tone="accent">Ready</Badge>;
    if (d.status === 'processing') return <Badge tone="info">Processing…</Badge>;
    if (d.status === 'ocr_required') return <Badge tone="warning">OCR required</Badge>;
    return <Badge tone="danger">Failed</Badge>;
  };

  return (
    <div>
      <PageHeader
        title="Library"
        subtitle="PDF, DOCX, TXT and Markdown — processed locally with page-cited chunks"
        actions={
          <>
            <Button onClick={() => setSubjectOpen(true)}>New subject</Button>
            <Button variant="primary" onClick={() => setUploadOpen(true)}>
              Upload document
            </Button>
          </>
        }
      />

      <div style={{ display: 'flex', gap: 8, marginBottom: 'var(--space-4)', flexWrap: 'wrap', alignItems: 'center' }}>
        <Select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 220 }}>
          <option value="">All subjects</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.documentCount})
            </option>
          ))}
        </Select>
        <Button variant="ghost" size="sm" onClick={load}>
          Refresh
        </Button>
      </div>

      {docs === null ? (
        <Spinner label="Loading library…" />
      ) : docs.length === 0 ? (
        <Card>
          <EmptyState title="Your library is empty" action={<Button variant="primary" onClick={() => setUploadOpen(true)}>Upload your first document</Button>}>
            Upload a PDF, DOCX or text file. Lumen extracts the text, builds page-cited chunks, and makes it searchable for the AI Tutor and quizzes.
          </EmptyState>
        </Card>
      ) : (
        <Card pad={false}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-muted)', borderBottom: '1px solid var(--hairline)' }}>
                <th style={{ padding: '12px 16px' }}>Title</th>
                <th style={{ padding: '12px 8px' }}>Subject</th>
                <th style={{ padding: '12px 8px' }}>Pages</th>
                <th style={{ padding: '12px 8px' }}>Size</th>
                <th style={{ padding: '12px 8px' }}>Added</th>
                <th style={{ padding: '12px 8px' }}>Status</th>
                <th style={{ padding: '12px 16px' }}></th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id} style={{ borderBottom: '1px solid var(--hairline)' }}>
                  <td style={{ padding: '10px 16px' }}>
                    <button style={{ all: 'unset', cursor: 'pointer', color: 'var(--accent)', fontWeight: 500 }} onClick={() => navigate(`/library/${d.id}`)}>
                      {d.title}
                    </button>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-faint)' }}>{d.filename}</div>
                  </td>
                  <td style={{ padding: '10px 8px', color: 'var(--text-muted)' }}>{subjects.find((s) => s.id === d.subjectId)?.name ?? '—'}</td>
                  <td style={{ padding: '10px 8px' }}>{d.pageCount ?? '—'}</td>
                  <td style={{ padding: '10px 8px', color: 'var(--text-muted)' }}>{formatBytes(d.sizeBytes)}</td>
                  <td style={{ padding: '10px 8px', color: 'var(--text-muted)' }}>{formatDate(d.createdAt)}</td>
                  <td style={{ padding: '10px 8px' }}>{statusBadge(d)}</td>
                  <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                    <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(d)}>
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Modal open={uploadOpen} title="Upload a document" onClose={() => setUploadOpen(false)}>
        <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
          <input
            ref={fileInput}
            type="file"
            accept=".pdf,.docx,.txt,.md,.markdown,.png,.jpg,.jpeg,.webp,application/pdf,text/plain,text/markdown,image/*"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ''));
            }}
          />
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-faint)' }}>
            PDF, DOCX, TXT, Markdown, or Images (PNG/JPG) · up to 100 MB · Images & Scans are OCR'd automatically
          </div>
          <div>
            <label className="label">Title</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Chapter 4 — Cell Transport" />
          </div>
          <div>
            <label className="label">Subject</label>
            <Select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              <option value="">None</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => setUploadOpen(false)}>Cancel</Button>
            <Button variant="primary" disabled={!file || busy} onClick={() => void upload()}>
              {busy ? 'Uploading…' : 'Upload'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={subjectOpen} title="New subject" onClose={() => setSubjectOpen(false)}>
        <Input value={newSubject} onChange={(e) => setNewSubject(e.target.value)} placeholder="Biology" onKeyDown={(e) => e.key === 'Enter' && void addSubject()} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 'var(--space-4)' }}>
          <Button onClick={() => setSubjectOpen(false)}>Cancel</Button>
          <Button variant="primary" onClick={() => void addSubject()}>
            Add
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete document"
        message={deleteTarget ? `"${deleteTarget.title}" and its processed chunks will be removed. The original file will be deleted from storage.` : ''}
        onConfirm={() => deleteTarget && void remove(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
