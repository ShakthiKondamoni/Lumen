import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.ts';
import { Badge, Button, Card, EmptyState, Input, PageHeader, Spinner, Stat } from '../components/ui.tsx';
import { useToast } from '../state/app.tsx';
import type { CardDto, DeckDto } from '@lumen/shared';

const GRADES: { g: 1 | 2 | 3 | 4; label: string; hint: string }[] = [
  { g: 1, label: 'Again', hint: 'blank / wrong' },
  { g: 2, label: 'Hard', hint: 'struggled' },
  { g: 3, label: 'Good', hint: 'recalled' },
  { g: 4, label: 'Easy', hint: 'instant' },
];

// Helper to check if text contains Anki Cloze syntax {{c1::term}}
function isClozeText(text: string): boolean {
  return /\{\{c\d+::.*?\}\}/.test(text);
}

// Render Cloze Deletions
function ClozeRenderer({
  text,
  revealed,
  onRevealOne,
  revealedIds,
}: {
  text: string;
  revealed: boolean;
  onRevealOne?: (id: string) => void;
  revealedIds: Set<string>;
}) {
  const parts: (string | { id: string; num: string; answer: string; hint?: string })[] = [];
  const regex = /\{\{c(\d+)::([^:]+?)(?:::([^}]+))?\}\}/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const num = match[1] ?? '1';
    const answer = match[2] ?? '';
    const hint = match[3];
    const id = `c${num}-${match.index}`;
    parts.push({ id, num, answer, hint });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return (
    <span style={{ lineHeight: 1.8 }}>
      {parts.map((p, idx) => {
        if (typeof p === 'string') {
          return <span key={idx}>{p}</span>;
        }
        const isRevealed = revealed || revealedIds.has(p.id);
        if (isRevealed) {
          return (
            <span
              key={idx}
              style={{
                background: 'var(--accent-soft)',
                color: 'var(--accent-strong)',
                border: '1px solid var(--accent)',
                padding: '2px 8px',
                borderRadius: 4,
                fontWeight: 600,
                margin: '0 2px',
                display: 'inline-block',
              }}
            >
              {p.answer}
            </span>
          );
        }
        return (
          <button
            key={idx}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRevealOne?.(p.id);
            }}
            title="Click to reveal blank"
            style={{
              background: 'var(--surface-2)',
              border: '1px dashed var(--accent)',
              color: 'var(--accent)',
              padding: '2px 8px',
              borderRadius: 4,
              fontWeight: 600,
              margin: '0 2px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 'inherit',
            }}
          >
            {p.hint ? `[${p.hint}]` : '[ ... ]'}
          </button>
        );
      })}
    </span>
  );
}

export function ReviewPage() {
  const { notify } = useToast();
  const [tab, setTab] = useState<'review' | 'occlusion'>('review');
  const [queue, setQueue] = useState<CardDto[] | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [revealedClozeIds, setRevealedClozeIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [sessionDone, setSessionDone] = useState(0);

  // Image Occlusion State
  const [occlusionMasks, setOcclusionMasks] = useState<{ id: number; label: string; x: number; y: number; w: number; h: number; hidden: boolean }[]>([
    { id: 1, label: 'Sinoatrial (SA) Node', x: 160, y: 70, w: 150, h: 26, hidden: true },
    { id: 2, label: 'Atrioventricular (AV) Node', x: 235, y: 165, w: 175, h: 26, hidden: true },
    { id: 3, label: 'Bundle of His', x: 250, y: 225, w: 120, h: 26, hidden: true },
    { id: 4, label: 'Purkinje Fibers', x: 380, y: 265, w: 130, h: 26, hidden: true },
  ]);

  const load = useCallback(() => {
    void api.get<{ queue: CardDto[]; remaining: number }>('/api/review/queue?new=10&due=40').then((d) => {
      setQueue(d.queue);
      setRemaining(d.remaining);
      setIndex(0);
      setRevealed(false);
      setRevealedClozeIds(new Set());
    });
  }, []);
  useEffect(load, [load]);

  const grade = async (g: 1 | 2 | 3 | 4) => {
    const card = queue?.[index];
    if (!card || busy) return;
    setBusy(true);
    try {
      const data = await api.post<{ result: { card: CardDto; remaining: number } }>(`/api/review/cards/${card.id}/grade`, g);
      setRemaining(data.result.remaining);
      setSessionDone((n) => n + 1);
      if (g === 1) {
        setQueue((q) => (q ? [...q.slice(0, index), ...q.slice(index + 1), card] : q));
        setRevealed(false);
        setRevealedClozeIds(new Set());
      } else {
        setIndex((i) => i + 1);
        setRevealed(false);
        setRevealedClozeIds(new Set());
      }
      if (data.result.remaining === 0) notify('Queue clear — nice work');
    } finally {
      setBusy(false);
    }
  };

  const createSampleCloze = async () => {
    try {
      const { decks } = await api.get<{ decks: DeckDto[] }>('/api/decks');
      let deckId = decks[0]?.id;
      if (!deckId) {
        const { deck } = await api.post<{ deck: DeckDto }>('/api/decks', { name: 'Medical Pharmacology' });
        deckId = deck.id;
      }
      await api.post(`/api/decks/${deckId}/cards`, {
        front: 'The primary intrinsic cardiac pacemaker is the {{c1::sinoatrial (SA) node}}, which generates spontaneous action potentials via {{c2::HCN channels::channel type}} ("funny current").',
        back: 'Sympathetic beta-1 stimulation accelerates SA discharge; vagal parasympathetic M2 stimulation slows it down.',
      });
      notify('Sample Cloze deletion card created!');
      load();
    } catch {
      notify('Failed to create sample card');
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (tab !== 'review') return;
      if (!revealed && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        setRevealed(true);
        return;
      }
      if (revealed) {
        const map: Record<string, 1 | 2 | 3 | 4> = { '1': 1, '2': 2, '3': 3, '4': 4 };
        const g = map[e.key];
        if (g) void grade(g);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const toggleOcclusionMask = (id: number) => {
    setOcclusionMasks((masks) => masks.map((m) => (m.id === id ? { ...m, hidden: !m.hidden } : m)));
  };

  const resetAllOcclusions = () => {
    setOcclusionMasks((masks) => masks.map((m) => ({ ...m, hidden: true })));
  };

  if (queue === null) return <Spinner label="Building your queue…" />;

  const card = queue[index];
  const finished = !card;
  const isCloze = card ? isClozeText(card.front) : false;

  return (
    <div>
      <PageHeader
        title="Review"
        subtitle="FSRS-5 schedules each card at your desired retention — Anki Cloze Deletions & Image Occlusion supported"
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant={tab === 'review' ? 'primary' : 'secondary'} size="sm" onClick={() => setTab('review')}>
              Review Queue ({queue.length - index})
            </Button>
            <Button variant={tab === 'occlusion' ? 'primary' : 'secondary'} size="sm" onClick={() => setTab('occlusion')}>
              Image Occlusion Studio
            </Button>
          </div>
        }
      />

      {tab === 'occlusion' ? (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
            <div>
              <h3 style={{ fontSize: 'var(--text-lg)', margin: 0 }}>Anatomy: Cardiac Conduction System</h3>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', margin: '4px 0 0' }}>
                Click any red occlusion mask to test yourself and reveal the underlying label.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-faint)' }}>
                Revealed: {occlusionMasks.filter((m) => !m.hidden).length} / {occlusionMasks.length}
              </span>
              <Button size="sm" onClick={resetAllOcclusions}>
                Reset Masks
              </Button>
            </div>
          </div>

          <div
            style={{
              background: 'var(--surface-2)',
              borderRadius: 8,
              padding: 'var(--space-5)',
              display: 'flex',
              justifyContent: 'center',
              border: '1px solid var(--hairline)',
            }}
          >
            <svg viewBox="0 0 620 340" style={{ width: '100%', maxWidth: 580, height: 'auto', userSelect: 'none' }}>
              <rect x="30" y="30" width="560" height="280" rx="16" fill="var(--surface)" stroke="var(--hairline-strong)" strokeWidth="2" />
              
              {/* Heart Chambers Representation */}
              <circle cx="210" cy="130" r="45" fill="var(--info-soft)" stroke="var(--info)" strokeWidth="1.5" />
              <text x="180" y="135" fill="var(--info)" fontSize="12" fontFamily="var(--font-body)">Right Atrium</text>

              <circle cx="410" cy="130" r="45" fill="var(--danger-soft)" stroke="var(--danger)" strokeWidth="1.5" />
              <text x="385" y="135" fill="var(--danger)" fontSize="12" fontFamily="var(--font-body)">Left Atrium</text>

              <rect x="160" y="195" width="105" height="75" rx="8" fill="var(--info-soft)" stroke="var(--info)" strokeWidth="1.5" />
              <text x="175" y="235" fill="var(--info)" fontSize="12" fontFamily="var(--font-body)">Right Ventricle</text>

              <rect x="360" y="195" width="105" height="75" rx="8" fill="var(--danger-soft)" stroke="var(--danger)" strokeWidth="1.5" />
              <text x="375" y="235" fill="var(--danger)" fontSize="12" fontFamily="var(--font-body)">Left Ventricle</text>

              {/* Labels & Occlusion Masks */}
              {occlusionMasks.map((m) => (
                <g key={m.id}>
                  <text
                    x={m.x + 8}
                    y={m.y + 17}
                    fill="var(--text)"
                    fontSize="12"
                    fontWeight="600"
                    fontFamily="var(--font-body)"
                  >
                    {m.label}
                  </text>
                  {m.hidden && (
                    <rect
                      x={m.x}
                      y={m.y}
                      width={m.w}
                      height={m.h}
                      rx="4"
                      fill="var(--danger)"
                      stroke="var(--danger-soft)"
                      strokeWidth="1.5"
                      style={{ cursor: 'pointer', transition: 'opacity 0.2s' }}
                      onClick={() => toggleOcclusionMask(m.id)}
                    />
                  )}
                </g>
              ))}
            </svg>
          </div>
        </Card>
      ) : finished ? (
        <Card>
          <EmptyState
            title={sessionDone > 0 ? 'Session complete' : 'Nothing due right now'}
            action={
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                <Button variant="primary" onClick={load}>Check for more</Button>
                <Button variant="secondary" onClick={() => void createSampleCloze()}>
                  + Create Sample Cloze Card
                </Button>
              </div>
            }
          >
            {sessionDone > 0
              ? `You reviewed ${sessionDone} card${sessionDone === 1 ? '' : 's'} this session. FSRS will bring the next cards when they mature.`
              : 'New cards and due cards appear here as they mature. You can also create Cloze cards using {{c1::term}}.'}
          </EmptyState>
        </Card>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-4)', alignItems: 'center', flexWrap: 'wrap' }}>
            <Stat label="In queue" value={queue.length - index} />
            <Stat label="Remaining total" value={remaining} />
            <Badge tone="info">{card.deckName}</Badge>
            <Badge tone={isCloze ? 'accent' : 'default'}>{isCloze ? 'Anki Cloze' : card.state}</Badge>
            <div style={{ marginLeft: 'auto', fontSize: 'var(--text-sm)', color: 'var(--text-faint)' }}>
              {index + 1} of {queue.length}
            </div>
          </div>
          <Card>
            <div
              className="flashcard"
              onClick={() => setRevealed(true)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') setRevealed(true);
              }}
              style={{ cursor: 'pointer' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {isCloze ? 'Active Recall (Cloze Deletion)' : 'Question'}
                </span>
                {isCloze && (
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--accent)' }}>
                    Tip: Click blank or press Space to reveal
                  </span>
                )}
              </div>

              <div style={{ fontSize: 'var(--text-lg)', lineHeight: 1.6 }}>
                {isCloze ? (
                  <ClozeRenderer
                    text={card.front}
                    revealed={revealed}
                    revealedIds={revealedClozeIds}
                    onRevealOne={(id) => setRevealedClozeIds((s) => new Set([...s, id]))}
                  />
                ) : (
                  card.front
                )}
              </div>

              {revealed ? (
                <>
                  <div style={{ width: 64, height: 1, background: 'var(--hairline-strong)', margin: 'var(--space-4) 0' }} />
                  <div style={{ color: 'var(--accent)', fontSize: 'var(--text-base)', lineHeight: 1.6 }}>
                    {card.back}
                  </div>
                </>
              ) : (
                <div style={{ marginTop: 'var(--space-5)', fontSize: 'var(--text-sm)', color: 'var(--text-faint)' }}>
                  Click card or press Space to reveal answer
                </div>
              )}
            </div>

            {revealed && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 'var(--space-4)' }}>
                {GRADES.map((g) => (
                  <Button key={g.g} variant={g.g === 3 ? 'primary' : 'secondary'} disabled={busy} onClick={() => void grade(g.g)} title={g.hint}>
                    {g.label} <span style={{ opacity: 0.6, fontFamily: 'var(--font-mono)' }}>{g.g}</span>
                  </Button>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
