import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.ts';
import { navigate, useRoute } from './router.tsx';
import { useAuth } from '../state/app.tsx';
import { Button, Input } from './ui.tsx';

interface SearchResults {
  notes: { id: string; title: string }[];
  documents: { id: string; title: string }[];
}

const COMMANDS: { label: string; route: string; keywords: string }[] = [
  { label: 'Dashboard', route: '/', keywords: 'home overview' },
  { label: 'Library', route: '/library', keywords: 'documents pdf upload' },
  { label: 'AI Tutor', route: '/tutor', keywords: 'tutor ask learn citations' },
  { label: 'Chat', route: '/chat', keywords: 'chat assistant' },
  { label: 'Notes', route: '/notes', keywords: 'notes write wiki' },
  { label: 'Review', route: '/review', keywords: 'flashcards spaced repetition fsrs' },
  { label: 'Quizzes', route: '/quizzes', keywords: 'quiz exam test practice' },
  { label: 'Planner', route: '/planner', keywords: 'tasks plan schedule' },
  { label: 'Focus timer', route: '/focus', keywords: 'pomodoro timer' },
  { label: 'Stats', route: '/stats', keywords: 'progress analytics' },
  { label: 'Jobs', route: '/jobs', keywords: 'background processing ocr' },
  { label: 'Settings', route: '/settings', keywords: 'preferences providers api keys' },
];

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [results, setResults] = useState<SearchResults>({ notes: [], documents: [] });
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelected(0);
      setResults({ notes: [], documents: [] });
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setResults({ notes: [], documents: [] });
      return;
    }
    const t = setTimeout(() => {
      void api
        .get<SearchResults>(`/api/search/global?q=${encodeURIComponent(query.trim())}`)
        .then(setResults)
        .catch(() => setResults({ notes: [], documents: [] }));
    }, 180);
    return () => clearTimeout(t);
  }, [query, open]);

  if (!open) return null;

  const q = query.trim().toLowerCase();
  const commands = COMMANDS.filter((c) => q === '' || c.label.toLowerCase().includes(q) || c.keywords.includes(q));
  const items: { key: string; label: string; hint: string; go: () => void }[] = [
    ...commands.map((c) => ({ key: `cmd-${c.route}`, label: c.label, hint: 'Page', go: () => navigate(c.route) })),
    ...results.documents.map((d) => ({ key: `doc-${d.id}`, label: d.title, hint: 'Document', go: () => navigate(`/library/${d.id}`) })),
    ...results.notes.map((n) => ({ key: `note-${n.id}`, label: n.title, hint: 'Note', go: () => navigate(`/notes/${n.id}`) })),
  ];

  const move = (delta: number) => setSelected((s) => Math.max(0, Math.min(items.length - 1, s + delta)));
  const choose = (i: number) => {
    items[i]?.go();
    onClose();
  };

  return (
    <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label="Command palette">
        <div style={{ padding: 12, borderBottom: '1px solid var(--hairline)' }}>
          <Input
            ref={inputRef}
            placeholder="Search pages, documents, notes…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                move(1);
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                move(-1);
              } else if (e.key === 'Enter') {
                choose(selected);
              } else if (e.key === 'Escape') {
                onClose();
              }
            }}
            style={{ height: 44 }}
          />
        </div>
        <div style={{ maxHeight: 320, overflowY: 'auto', padding: 6 }}>
          {items.length === 0 && <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>No matches. Type to search your library.</div>}
          {items.map((item, i) => (
            <button key={item.key} className={`palette-item${i === selected ? ' selected' : ''}`} onMouseEnter={() => setSelected(i)} onClick={() => choose(i)}>
              <span style={{ flex: 1 }}>{item.label}</span>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-faint)' }}>{item.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const NAV: { label: string; route: string; icon: string }[] = [
  { label: 'Dashboard', route: '/', icon: '⌂' },
  { label: 'Library', route: '/library', icon: '▤' },
  { label: 'AI Tutor', route: '/tutor', icon: '✦' },
  { label: 'Chat', route: '/chat', icon: '❝' },
  { label: 'Notes', route: '/notes', icon: '✎' },
  { label: 'Review', route: '/review', icon: '⇄' },
  { label: 'Quizzes', route: '/quizzes', icon: '✓' },
  { label: 'Planner', route: '/planner', icon: '☰' },
  { label: 'Focus', route: '/focus', icon: '◔' },
  { label: 'Stats', route: '/stats', icon: '▲' },
  { label: 'Jobs', route: '/jobs', icon: '⚙' },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const { path } = useRoute();
  const { user, signOut } = useAuth();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const activeBase = '/' + path.split('/')[1];
  const active = path === '/' ? '/' : activeBase;
  const isChat = active === '/chat' || active === '/tutor';

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>
      {/* Collapsible Sidebar */}
      <aside
        style={{
          width: collapsed ? 68 : 232,
          transition: 'width 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
          flexShrink: 0,
          borderRight: '1px solid var(--hairline)',
          background: 'var(--surface)',
          display: 'flex',
          flexDirection: 'column',
          padding: collapsed ? 'var(--space-4) 8px' : 'var(--space-4) var(--space-3)',
          position: 'sticky',
          top: 0,
          height: '100vh',
          overflowY: 'auto',
          overflowX: 'hidden',
          zIndex: 10,
        }}
      >
        {/* Brand & Collapse Toggle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: collapsed ? '0 0 var(--space-4)' : '0 var(--space-2) var(--space-4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, overflow: 'hidden' }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 9,
                background: 'var(--accent)',
                color: 'var(--accent-contrast)',
                display: 'grid',
                placeItems: 'center',
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              L
            </div>
            {!collapsed && (
              <div style={{ whiteSpace: 'nowrap' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'var(--text-lg)', lineHeight: 1.1 }}>Lumen</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-faint)' }}>Study workspace</div>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-faint)',
              fontSize: 14,
              padding: 4,
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {collapsed ? '▶' : '◀'}
          </button>
        </div>

        {/* Search Bar / Icon */}
        {collapsed ? (
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            title="Search (Ctrl K)"
            className="nav-item"
            style={{ justifyContent: 'center', marginBottom: 'var(--space-3)', padding: 10 }}
          >
            <span>🔍</span>
          </button>
        ) : (
          <Button
            variant="secondary"
            onClick={() => setPaletteOpen(true)}
            style={{ justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}
          >
            <span style={{ color: 'var(--text-muted)' }}>Search…</span>
            <kbd style={{ fontSize: 'var(--text-xs)', color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>Ctrl K</kbd>
          </Button>
        )}

        {/* Navigation Items */}
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
          {NAV.map((item) => (
            <button
              key={item.route}
              className={`nav-item${active === item.route ? ' active' : ''}`}
              onClick={() => navigate(item.route)}
              title={collapsed ? item.label : undefined}
              style={{
                justifyContent: collapsed ? 'center' : 'flex-start',
                padding: collapsed ? '10px 0' : undefined,
              }}
            >
              <span aria-hidden style={{ width: 18, textAlign: 'center', opacity: 0.8, fontSize: 16 }}>{item.icon}</span>
              {!collapsed && <span>{item.label}</span>}
            </button>
          ))}
        </nav>

        {/* Footer: Settings & User Profile */}
        <div style={{ borderTop: '1px solid var(--hairline)', paddingTop: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <button
            className={`nav-item${active === '/settings' ? ' active' : ''}`}
            onClick={() => navigate('/settings')}
            title={collapsed ? 'Settings' : undefined}
            style={{ justifyContent: collapsed ? 'center' : 'flex-start', padding: collapsed ? '10px 0' : undefined }}
          >
            <span aria-hidden style={{ width: 18, textAlign: 'center', fontSize: 16 }}>⚙</span>
            {!collapsed && <span>Settings</span>}
          </button>

          {!collapsed ? (
            <div style={{ padding: '6px var(--space-3) 0', fontSize: 'var(--text-xs)', color: 'var(--text-faint)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.name}</span>
              <Button variant="ghost" size="sm" onClick={() => void signOut()}>
                Sign out
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void signOut()}
              title="Sign out"
              className="nav-item"
              style={{ justifyContent: 'center', padding: '10px 0', color: 'var(--text-faint)' }}
            >
              <span>↪</span>
            </button>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <main
        style={{
          flex: 1,
          padding: isChat ? 0 : 'var(--space-6) var(--space-6)',
          maxWidth: isChat ? '100%' : 1180,
          margin: isChat ? 0 : '0 auto',
          width: '100%',
          minWidth: 0,
          height: isChat ? '100vh' : 'auto',
          overflow: isChat ? 'hidden' : 'visible',
          display: isChat ? 'flex' : 'block',
          flexDirection: isChat ? 'column' : 'initial',
        }}
      >
        {children}
      </main>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
