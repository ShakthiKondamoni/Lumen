import { useCallback, useEffect, useRef, useState } from 'react';
import { api, streamTurn } from '../api/client.ts';
import { navigate } from '../components/router.tsx';
import { Markdown } from '../components/Markdown.tsx';
import { Badge, Button, EmptyState, Spinner } from '../components/ui.tsx';
import { useToast } from '../state/app.tsx';
import type { ChunkDto, ConversationDto, DocumentDto, MessageDto } from '@lumen/shared';

interface TurnState {
  streaming: boolean;
  text: string;
  model: string | null;
  error: string | null;
}

export function ChatPage({ kind, conversationId }: { kind: 'chat' | 'tutor'; conversationId?: string }) {
  const { notify } = useToast();
  const [conversations, setConversations] = useState<ConversationDto[]>([]);
  const [docs, setDocs] = useState<DocumentDto[]>([]);
  const [active, setActive] = useState<ConversationDto | null>(null);
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [turn, setTurn] = useState<TurnState>({ streaming: false, text: '', model: null, error: null });
  const [scopeDocId, setScopeDocId] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const cancelRef = useRef<(() => void) | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loadList = useCallback(() => {
    void api.get<{ conversations: ConversationDto[] }>(`/api/conversations?kind=${kind}`).then((d) => setConversations(d.conversations));
    void api.get<{ documents: DocumentDto[] }>('/api/documents').then((d) => setDocs(d.documents.filter((x) => x.status === 'ready')));
  }, [kind]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    if (!conversationId) {
      setActive(null);
      setMessages([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    void api
      .get<{ conversation: ConversationDto; messages: MessageDto[] }>(`/api/conversations/${conversationId}`)
      .then((d) => {
        setActive(d.conversation);
        setMessages(d.messages);
        setScopeDocId(d.conversation.documentId ?? '');
      })
      .catch(() => navigate(kind))
      .finally(() => setLoading(false));
  }, [conversationId, kind]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, turn.text]);

  const createConversation = async () => {
    const data = await api.post<{ conversation: ConversationDto }>('/api/conversations', { kind, documentId: scopeDocId || undefined });
    loadList();
    navigate(`${kind}/${data.conversation.id}`);
  };

  const send = async (overridePrompt?: string) => {
    const promptToSend = (overridePrompt ?? draft).trim();
    if (!promptToSend || turn.streaming) return;
    let conv = active;
    if (!conv) {
      const data = await api.post<{ conversation: ConversationDto }>('/api/conversations', { kind, documentId: scopeDocId || undefined });
      conv = data.conversation;
      setActive(conv);
      loadList();
      navigate(`${kind}/${conv.id}`);
    }
    const content = promptToSend;
    setDraft('');
    setMessages((m) => [...m, { id: `local-${Date.now()}`, role: 'user', content, citations: [], model: null, createdAt: new Date().toISOString() }]);
    setTurn({ streaming: true, text: '', model: null, error: null });

    const handle = streamTurn(conv.id, content, {
      onMeta: (meta) => setTurn((t) => ({ ...t, model: meta.model })),
      onDelta: (text) => setTurn((t) => ({ ...t, text: t.text + text })),
      onDone: (message) => {
        setTurn({ streaming: false, text: '', model: null, error: null });
        setMessages((m) => [...m.filter((x) => !x.id.startsWith('local-')), { ...message, role: 'assistant', citations: message.citations as ChunkDto[], createdAt: new Date().toISOString() } as MessageDto]);
      },
      onError: (message) => {
        setTurn((t) => ({ ...t, streaming: false, error: message }));
        notify(message);
      },
    });
    cancelRef.current = handle.cancel;
    await handle.promise;
    setTurn((t) => ({ ...t, streaming: false }));
  };

  const cancel = () => {
    cancelRef.current?.();
    if (active) void api.post(`/api/conversations/${active.id}/cancel`);
  };

  const removeConversation = async (id: string) => {
    await api.delete(`/api/conversations/${id}`);
    if (active?.id === id) navigate(kind);
    loadList();
  };

  // Generate & Download PDF using backend pdf-lib endpoint
  const downloadAsPdf = async (title: string, content: string) => {
    setExportingPdf(true);
    try {
      const res = await fetch('/api/export/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content }),
      });
      if (!res.ok) throw new Error('PDF generation failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notify('✓ Downloaded PDF Study Guide!');
    } catch {
      notify('Could not generate PDF');
    } finally {
      setExportingPdf(false);
    }
  };

  const showCitations = (c: ChunkDto, i: number) => (
    <div key={c.id} style={{ borderTop: '1px solid var(--hairline)', paddingTop: 6, marginTop: 6, fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
      <span className="citation-chip">[{i + 1}]</span> <strong>{c.documentTitle}</strong> (p. {c.pageStart}–{c.pageEnd})
      {c.headingPath ? ` · ${c.headingPath}` : ''}
    </div>
  );

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100%', overflow: 'hidden', position: 'relative' }}>
      
      {/* Collapsible History Sidebar */}
      {showHistory && (
        <div
          style={{
            width: 260,
            flexShrink: 0,
            borderRight: '1px solid var(--hairline)',
            background: 'var(--surface)',
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            zIndex: 20,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', borderBottom: '1px solid var(--hairline)' }}>
            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>Conversation History</span>
            <button
              type="button"
              onClick={() => setShowHistory(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', fontSize: 16 }}
            >
              ✕
            </button>
          </div>
          <div style={{ padding: 8 }}>
            <Button variant="primary" size="sm" onClick={() => void createConversation()} style={{ width: '100%', justifyContent: 'center' }}>
              + New {kind === 'tutor' ? 'Session' : 'Chat'}
            </Button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px' }}>
            {conversations.length === 0 ? (
              <div style={{ padding: 16, fontSize: 'var(--text-xs)', color: 'var(--text-muted)', textAlign: 'center' }}>No past sessions.</div>
            ) : (
              conversations.map((cv) => (
                <div key={cv.id} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                  <button
                    className={`nav-item${active?.id === cv.id ? ' active' : ''}`}
                    onClick={() => {
                      navigate(`${kind}/${cv.id}`);
                      if (window.innerWidth < 768) setShowHistory(false);
                    }}
                    style={{ flex: 1, minWidth: 0, fontSize: 'var(--text-xs)', padding: '8px 10px' }}
                    title={cv.title}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cv.title}</span>
                  </button>
                  <Button variant="ghost" size="sm" aria-label="Delete" onClick={() => void removeConversation(cv.id)} style={{ padding: 4 }}>
                    ✕
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Main Full-Bleed Chat Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0, background: 'var(--bg)' }}>
        
        {/* Antigravity-Style Top Navigation & Scope Bar */}
        <header
          style={{
            height: 52,
            borderBottom: '1px solid var(--hairline)',
            background: 'var(--surface)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 20px',
            flexShrink: 0,
            zIndex: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              type="button"
              onClick={() => setShowHistory(!showHistory)}
              className="nav-item"
              style={{ padding: '6px 10px', fontSize: 'var(--text-xs)', background: showHistory ? 'var(--surface-2)' : 'transparent' }}
              title="Toggle Conversation History"
            >
              <span>☰ History</span>
              {conversations.length > 0 && <span style={{ opacity: 0.6 }}>({conversations.length})</span>}
            </button>

            <div style={{ height: 16, width: 1, background: 'var(--hairline)' }} />

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{kind === 'tutor' ? 'AI Socratic Tutor' : 'AI Chat'}</span>
              <Badge tone="accent">{kind === 'tutor' ? 'Grounded with Citations' : 'Direct Conversation'}</Badge>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {kind === 'tutor' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Document:</span>
                <select
                  className="input"
                  style={{ width: 180, height: 32, fontSize: 'var(--text-xs)', padding: '0 8px' }}
                  value={scopeDocId}
                  onChange={(e) => setScopeDocId(e.target.value)}
                  disabled={active !== null}
                >
                  <option value="">Whole Library</option>
                  {docs.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <Button variant="secondary" size="sm" onClick={() => void createConversation()}>
              + New
            </Button>
          </div>
        </header>

        {/* Message Stream Viewport */}
        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '24px 20px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ maxWidth: 860, width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', flex: 1 }}>
            
            {loading ? (
              <Spinner label="Loading conversation…" />
            ) : messages.length === 0 && !turn.text ? (
              <div style={{ margin: 'auto', textAlign: 'center', padding: 'var(--space-6) 0' }}>
                <EmptyState title={kind === 'tutor' ? 'Grounded Socratic Study Workspace' : 'How can I assist your study today?'}>
                  {kind === 'tutor'
                    ? 'Ask questions about your uploaded PDFs, generate detailed study guides, or drill concepts. All tutor answers cite exact pages.'
                    : 'Chat with local Ollama or Cloud AI models. Markdown, formulas, code, and direct PDF downloads are enabled.'}
                </EmptyState>
              </div>
            ) : (
              <>
                {messages.map((m) => (
                  <div
                    key={m.id}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: m.role === 'user' ? 'flex-end' : 'flex-start',
                      width: '100%',
                    }}
                  >
                    <div
                      style={{
                        maxWidth: m.role === 'user' ? '80%' : '100%',
                        background: m.role === 'user' ? 'var(--surface-2)' : 'var(--surface)',
                        border: '1px solid var(--hairline)',
                        borderRadius: m.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                        padding: m.role === 'user' ? '12px 18px' : '16px 20px',
                        boxShadow: 'var(--shadow-card)',
                      }}
                    >
                      {/* Assistant Header & Actions */}
                      {m.role === 'assistant' && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, borderBottom: '1px solid var(--hairline)', paddingBottom: 6 }}>
                          <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--accent)' }}>
                            ✦ Lumen AI {m.model ? `(${m.model})` : ''}
                          </span>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void downloadAsPdf(active?.title || 'Study Guide', m.content)}
                            disabled={exportingPdf}
                            title="Download formatted PDF Study Guide"
                            style={{ fontSize: 'var(--text-xs)', padding: '2px 8px', height: 26 }}
                          >
                            📄 Download PDF
                          </Button>
                        </div>
                      )}

                      <div style={{ fontSize: 'var(--text-base)', lineHeight: 1.65 }}>
                        {m.role === 'assistant' ? <Markdown text={m.content} /> : m.content}
                      </div>

                      {/* Citations */}
                      {m.role === 'assistant' && m.citations && m.citations.length > 0 && (
                        <div style={{ marginTop: 14 }}>
                          <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase' }}>Sources Cited:</div>
                          {m.citations.map(showCitations)}
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {/* Live Streaming Message */}
                {(turn.text || turn.streaming) && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', width: '100%' }}>
                    <div
                      style={{
                        width: '100%',
                        background: 'var(--surface)',
                        border: '1px solid var(--accent)',
                        borderRadius: '18px 18px 18px 4px',
                        padding: '16px 20px',
                        boxShadow: 'var(--shadow-card)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, borderBottom: '1px solid var(--hairline)', paddingBottom: 6 }}>
                        <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--accent)' }}>
                          ✦ Thinking & Generating… {turn.model ? `(${turn.model})` : ''}
                        </span>
                        <Button variant="danger" size="sm" onClick={cancel} style={{ height: 26, padding: '0 8px' }}>
                          ⏹ Stop
                        </Button>
                      </div>
                      <div style={{ fontSize: 'var(--text-base)', lineHeight: 1.65 }}>
                        {turn.text ? <Markdown text={turn.text} /> : <Spinner label="Formulating response…" />}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

          </div>
        </div>

        {/* Antigravity-Style Floating Capsule Prompt Bar */}
        <div style={{ padding: '0 20px 20px 20px', width: '100%', flexShrink: 0 }}>
          <div style={{ maxWidth: 860, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            
            {/* Quick Action Suggestion Pills */}
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2, scrollbarWidth: 'none' }}>
              <button
                type="button"
                onClick={() => void send('Generate a comprehensive, structured study guide on this topic with key concepts, bullet points, and mnemonics.')}
                style={{
                  padding: '4px 10px',
                  borderRadius: 16,
                  border: '1px solid var(--hairline)',
                  background: 'var(--surface)',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                📄 Generate PDF Study Guide
              </button>

              <button
                type="button"
                onClick={() => void send('Create a 5-question high-yield practice quiz on this material with answer explanations.')}
                style={{
                  padding: '4px 10px',
                  borderRadius: 16,
                  border: '1px solid var(--hairline)',
                  background: 'var(--surface)',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                ⚡ Create Practice Quiz
              </button>

              <button
                type="button"
                onClick={() => void send('Extract the 5 most important facts from this document as Anki Cloze deletions using {{c1::term}} format.')}
                style={{
                  padding: '4px 10px',
                  borderRadius: 16,
                  border: '1px solid var(--hairline)',
                  background: 'var(--surface)',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                🗂️ Extract Cloze Deletions
              </button>

              <button
                type="button"
                onClick={() => void send('Act as a strict Socratic professor: ask me a challenging clinical or legal scenario question and evaluate my answer step by step.')}
                style={{
                  padding: '4px 10px',
                  borderRadius: 16,
                  border: '1px solid var(--hairline)',
                  background: 'var(--surface)',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                🔍 Socratic Viva Drill
              </button>
            </div>

            {/* Antigravity Floating Pill Bar */}
            <div
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--hairline-strong)',
                borderRadius: 20,
                padding: '12px 16px',
                boxShadow: 'var(--shadow-pop)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder={turn.streaming ? 'AI is thinking… press Stop to cancel' : 'Ask anything, request a summary, or generate study notes… (Enter sends)'}
                rows={2}
                disabled={turn.streaming}
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  resize: 'none',
                  fontSize: 'var(--text-base)',
                  color: 'var(--text)',
                  fontFamily: 'var(--font-body)',
                  lineHeight: 1.5,
                }}
              />

              {/* Bottom Row Inside Pill */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--text-xs)', color: 'var(--text-faint)' }}>
                  <span>{scopeDocId ? '📄 Document Context' : '🌐 Whole Library'}</span>
                  <span>• Shift+Enter for newline</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {turn.streaming ? (
                    <Button variant="danger" size="sm" onClick={cancel} style={{ borderRadius: 16 }}>
                      ⏹ Stop
                    </Button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void send()}
                      disabled={draft.trim() === ''}
                      title="Send message (Enter)"
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: '50%',
                        border: 'none',
                        background: draft.trim() !== '' ? 'var(--accent)' : 'var(--hairline-strong)',
                        color: draft.trim() !== '' ? 'var(--accent-contrast)' : 'var(--text-faint)',
                        display: 'grid',
                        placeItems: 'center',
                        cursor: draft.trim() !== '' ? 'pointer' : 'default',
                        transition: 'all 0.15s ease',
                        fontSize: 16,
                        fontWeight: 'bold',
                      }}
                    >
                      ↑
                    </button>
                  )}
                </div>
              </div>
            </div>

            {turn.error && <div style={{ color: 'var(--danger)', fontSize: 'var(--text-xs)', textAlign: 'center' }}>{turn.error}</div>}
          </div>
        </div>

      </div>
    </div>
  );
}
