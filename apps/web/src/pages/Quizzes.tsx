import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client.ts';
import { Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner } from '../components/ui.tsx';
import { Markdown } from '../components/Markdown.tsx';
import { useToast } from '../state/app.tsx';
import type { ChunkDto, DocumentDto, QuizDto } from '@lumen/shared';

interface QuestionView {
  id: string;
  prompt: string;
  choices: string[];
}
interface AttemptView {
  scorePct: number;
  perQuestion: { questionId: string; correct: boolean; expected: string; citation: ChunkDto | null }[];
}

export function QuizzesPage() {
  const { notify } = useToast();
  const [quizzes, setQuizzes] = useState<QuizDto[] | null>(null);
  const [docs, setDocs] = useState<DocumentDto[]>([]);
  const [genOpen, setGenOpen] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [genDoc, setGenDoc] = useState('');
  const [genCount, setGenCount] = useState(8);
  const [genShort, setGenShort] = useState(false);
  const [active, setActive] = useState<{ quiz: QuizDto; questions: QuestionView[] } | null>(null);
  const [answers, setAnswers] = useState<Record<string, number | string>>({});
  const [attempt, setAttempt] = useState<AttemptView | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<QuizDto | null>(null);

  const load = () => {
    void api.get<{ quizzes: QuizDto[] }>('/api/quizzes').then((d) => setQuizzes(d.quizzes));
    void api.get<{ documents: DocumentDto[] }>('/api/documents').then((d) => setDocs(d.documents.filter((x) => x.status === 'ready')));
  };
  useEffect(load, []);

  const generate = async () => {
    setGenBusy(true);
    try {
      const data = await api.post<{ quizId: string }>('/api/quizzes/generate', {
        documentId: genDoc,
        count: genCount,
        kinds: genShort ? ['mcq', 'short'] : ['mcq'],
      });
      notify('Quiz generated');
      setGenOpen(false);
      load();
      void openQuiz(data.quizId);
    } catch (err) {
      notify(err instanceof ApiError ? err.message : 'Generation failed');
    } finally {
      setGenBusy(false);
    }
  };

  const openQuiz = async (id: string) => {
    const data = await api.get<{ quiz: QuizDto; questions: QuestionView[] }>(`/api/quizzes/${id}`);
    setActive({ quiz: data.quiz, questions: data.questions });
    setAnswers({});
    setAttempt(null);
  };

  const submit = async () => {
    if (!active) return;
    const payload = active.questions.map((q) => {
      const a = answers[q.id];
      return typeof a === 'number' ? { questionId: q.id, choiceIndex: a } : { questionId: q.id, choiceIndex: null, text: typeof a === 'string' ? a : '' };
    });
    const data = await api.post<{ attempt: AttemptView }>(`/api/quizzes/${active.quiz.id}/submit`, { answers: payload });
    setAttempt(data.attempt);
    load();
  };

  if (quizzes === null) return <Spinner label="Loading quizzes…" />;

  return (
    <div>
      <PageHeader
        title="Quizzes"
        subtitle="AI-generated from your documents, graded locally with citations back to the source"
        actions={
          <Button variant="primary" onClick={() => setGenOpen(true)} disabled={docs.length === 0}>
            Generate quiz
          </Button>
        }
      />

      {active ? (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ fontSize: 'var(--text-xl)' }}>{active.quiz.title}</h2>
            <Button onClick={() => setActive(null)}>← All quizzes</Button>
          </div>
          {attempt && (
            <div style={{ marginTop: 'var(--space-3)', padding: 'var(--space-3)', background: 'var(--accent-soft)', borderRadius: 'var(--radius-md)', color: 'var(--accent-strong)', fontWeight: 600 }}>
              Score: {attempt.scorePct}%
            </div>
          )}
          <div style={{ display: 'grid', gap: 'var(--space-4)', marginTop: 'var(--space-4)' }}>
            {active.questions.map((q, i) => {
              const result = attempt?.perQuestion.find((p) => p.questionId === q.id);
              return (
                <div key={q.id} style={{ borderTop: '1px solid var(--hairline)', paddingTop: 'var(--space-4)' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' }}>{i + 1}.</span>
                    <strong>{q.prompt}</strong>
                  </div>
                  {q.choices.length > 0 ? (
                    <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
                      {q.choices.map((choice, ci) => {
                        const picked = answers[q.id] === ci;
                        const isCorrect = result && result.correct && picked;
                        const isWrongPick = result && !result.correct && picked;
                        return (
                          <label key={ci} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 10px', borderRadius: 'var(--radius-sm)', background: isCorrect ? 'var(--accent-soft)' : isWrongPick ? 'var(--danger-soft)' : picked ? 'var(--surface-2)' : 'transparent', cursor: attempt ? 'default' : 'pointer' }}>
                            <input type="radio" name={q.id} disabled={attempt !== null} checked={picked} onChange={() => setAnswers((a) => ({ ...a, [q.id]: ci }))} />
                            {choice}
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <textarea className="input" style={{ marginTop: 10 }} disabled={attempt !== null} value={typeof answers[q.id] === 'string' ? (answers[q.id] as string) : ''} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} placeholder="Type your answer…" />
                  )}
                  {result && (
                    <div style={{ marginTop: 8, fontSize: 'var(--text-sm)' }}>
                      <Badge tone={result.correct ? 'accent' : 'danger'}>{result.correct ? 'Correct' : 'Incorrect'}</Badge>
                      <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>
                        <Markdown text={result.expected} />
                      </div>
                      {result.citation && (
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-faint)', marginTop: 4 }}>
                          Source: {result.citation.documentTitle}, pages {result.citation.pageStart}–{result.citation.pageEnd}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {!attempt && <Button variant="primary" style={{ marginTop: 'var(--space-4)' }} onClick={() => void submit()}>Submit answers</Button>}
        </Card>
      ) : quizzes.length === 0 ? (
        <Card>
          <EmptyState title="No quizzes yet" action={docs.length > 0 ? <Button variant="primary" onClick={() => setGenOpen(true)}>Generate from a document</Button> : undefined}>
            {docs.length > 0 ? 'Pick a processed document and Lumen writes questions grounded in its content, with explanations and citations.' : 'Upload and process a document first — quizzes are generated from its indexed chunks.'}
          </EmptyState>
        </Card>
      ) : (
        <Card pad={false}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-muted)', borderBottom: '1px solid var(--hairline)' }}>
                <th style={{ padding: '12px 16px' }}>Quiz</th>
                <th style={{ padding: '12px 8px' }}>Questions</th>
                <th style={{ padding: '12px 8px' }}>Best</th>
                <th style={{ padding: '12px 16px' }}></th>
              </tr>
            </thead>
            <tbody>
              {quizzes.map((q) => (
                <tr key={q.id} style={{ borderBottom: '1px solid var(--hairline)' }}>
                  <td style={{ padding: '10px 16px' }}>
                    <button style={{ all: 'unset', cursor: 'pointer', color: 'var(--accent)', fontWeight: 500 }} onClick={() => void openQuiz(q.id)}>
                      {q.title}
                    </button>
                  </td>
                  <td style={{ padding: '10px 8px' }}>{q.questionCount}</td>
                  <td style={{ padding: '10px 8px' }}>{q.bestScore !== null ? `${Math.round(q.bestScore)}%` : '—'}</td>
                  <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                    <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(q)}>
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Modal open={genOpen} title="Generate a quiz" onClose={() => setGenOpen(false)}>
        <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
          <Field label="Document">
            <Select value={genDoc} onChange={(e) => setGenDoc(e.target.value)}>
              <option value="">Choose a processed document…</option>
              {docs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Number of questions">
            <Input type="number" min={3} max={30} value={genCount} onChange={(e) => setGenCount(Math.max(3, Math.min(30, Number(e.target.value) || 8)))} />
          </Field>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 'var(--text-sm)' }}>
            <input type="checkbox" checked={genShort} onChange={(e) => setGenShort(e.target.checked)} />
            Include short-answer questions (in addition to multiple choice)
          </label>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-faint)' }}>Uses the model routed for “quiz” in Settings → AI providers.</div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => setGenOpen(false)}>Cancel</Button>
            <Button variant="primary" disabled={!genDoc || genBusy} onClick={() => void generate()}>
              {genBusy ? 'Generating…' : 'Generate'}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog open={deleteTarget !== null} title="Delete quiz" message={deleteTarget ? `"${deleteTarget.title}" and its attempts will be removed.` : ''} onConfirm={() => deleteTarget && void api.delete(`/api/quizzes/${deleteTarget.id}`).then(load)} onClose={() => setDeleteTarget(null)} />
    </div>
  );
}
