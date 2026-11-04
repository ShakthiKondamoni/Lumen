import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client.ts';
import { Badge, Button, Card, ConfirmDialog, Field, Input, Modal, PageHeader, Select, Spinner } from '../components/ui.tsx';
import { useAppearance, useAuth, useToast } from '../state/app.tsx';
import type { PublicProvider, PublicUser, RouteStep, RouteTask } from '@lumen/shared';

const PROVIDER_KINDS: { value: string; label: string; hint: string; baseUrl: string }[] = [
  { value: 'openai-compatible', label: 'OpenAI-compatible', hint: 'OpenAI, Groq, OpenRouter, Ollama, LM Studio, vLLM…', baseUrl: 'https://api.openai.com/v1' },
  { value: 'anthropic', label: 'Anthropic', hint: 'Claude models', baseUrl: 'https://api.anthropic.com' },
  { value: 'gemini', label: 'Google Gemini', hint: 'Gemini models', baseUrl: 'https://generativelanguage.googleapis.com' },
];

const TASKS: { value: RouteTask; label: string; hint: string }[] = [
  { value: 'chat', label: 'Chat', hint: 'General assistant turns' },
  { value: 'tutor', label: 'AI Tutor', hint: 'Grounded, citation-backed answers' },
  { value: 'quiz', label: 'Quiz generation', hint: 'Writing questions from documents' },
  { value: 'summarize', label: 'Summaries', hint: 'Document summaries (reserved)' },
];

export function SettingsPage() {
  const { notify } = useToast();
  const { user } = useAuth();
  const { appearance, setAppearance } = useAppearance();
  const [providers, setProviders] = useState<PublicProvider[] | null>(null);
  const [routes, setRoutes] = useState<Record<string, RouteStep[]>>({});
  const [models, setModels] = useState<Record<string, string[]>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ kind: 'openai-compatible', label: '', baseUrl: 'https://api.openai.com/v1', apiKey: '' });
  const [routeEdit, setRouteEdit] = useState<RouteTask | null>(null);
  const [routeSteps, setRouteSteps] = useState<{ providerId: string; model: string }[]>([]);
  const [confirmReset, setConfirmReset] = useState(false);

  const load = () => {
    void api.get<{ providers: PublicProvider[] }>('/api/providers').then((d) => setProviders(d.providers));
    void api.get<{ routes: Record<string, RouteStep[]> }>('/api/routes').then((d) => setRoutes(d.routes));
  };
  useEffect(load, []);

  const fetchModels = async (id: string) => {
    try {
      const data = await api.get<{ models: string[] }>(`/api/providers/${id}/models`);
      setModels((m) => ({ ...m, [id]: data.models }));
    } catch (err) {
      notify(err instanceof ApiError ? err.message : 'Could not fetch models');
    }
  };

  const testProvider = async (id: string) => {
    const data = await api.post<{ ok: boolean; modelCount?: number; error?: string }>(`/api/providers/${id}/test`);
    notify(data.ok ? `Connection OK — ${data.modelCount} models visible` : `Failed: ${data.error}`);
  };

  const addProvider = async () => {
    try {
      await api.post('/api/providers', {
        kind: form.kind,
        label: form.label || PROVIDER_KINDS.find((k) => k.value === form.kind)!.label,
        baseUrl: form.baseUrl,
        apiKey: form.apiKey || undefined,
      });
      notify('Provider added — key stored encrypted');
      setAddOpen(false);
      setForm({ kind: 'openai-compatible', label: '', baseUrl: 'https://api.openai.com/v1', apiKey: '' });
      load();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : 'Could not add provider');
    }
  };

  const saveRoute = async () => {
    if (!routeEdit) return;
    await api.put('/api/routes', { task: routeEdit, steps: routeSteps.filter((s) => s.providerId && s.model) });
    notify('Route saved');
    setRouteEdit(null);
    load();
  };

  const exportBackup = async () => {
    const res = await fetch(`${window.lumen?.apiBase ?? ''}/api/backup/export`, { credentials: 'include' });
    if (!res.ok) {
      notify('Export failed');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lumen-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify('Backup exported');
  };

  if (providers === null) return <Spinner label="Loading settings…" />;

  return (
    <div style={{ display: 'grid', gap: 'var(--space-5)' }}>
      <PageHeader title="Settings" subtitle="Appearance, AI providers, model routing, account and data" />

      <Card>
        <h3>Appearance</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
          {(['paper', 'graphite', 'midnight', 'system'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setAppearance({ theme: t })}
              style={{
                border: appearance.theme === t ? '2px solid var(--accent)' : '1px solid var(--hairline)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-3)',
                cursor: 'pointer',
                background: 'var(--surface)',
                textAlign: 'left',
              }}
            >
              <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                <span style={{ width: 16, height: 16, borderRadius: 4, background: t === 'paper' ? '#faf9f6' : t === 'graphite' ? '#17181a' : t === 'midnight' ? '#0f1420' : 'linear-gradient(135deg, #faf9f6 50%, #17181a 50%)', border: '1px solid var(--hairline)' }} />
                <span style={{ width: 16, height: 16, borderRadius: 4, background: t === 'paper' ? '#4a7c59' : t === 'graphite' ? '#8ab593' : t === 'midnight' ? '#7fa6d9' : 'var(--accent)' }} />
              </div>
              <strong style={{ fontSize: 'var(--text-sm)', textTransform: 'capitalize' }}>{t}</strong>
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-5)', marginTop: 'var(--space-4)', flexWrap: 'wrap' }}>
          <Field label="Density">
            <Select value={appearance.density} onChange={(e) => setAppearance({ density: e.target.value as 'compact' | 'comfortable' })}>
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </Select>
          </Field>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--text-sm)', alignSelf: 'flex-end', paddingBottom: 9 }}>
            <input type="checkbox" checked={appearance.reducedMotion} onChange={(e) => setAppearance({ reducedMotion: e.target.checked })} />
            Reduce motion
          </label>
        </div>
      </Card>

      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3>AI providers</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', margin: '4px 0 0' }}>
              API keys are encrypted at rest (AES-256-GCM) and never sent back to the browser.
            </p>
          </div>
          <Button variant="primary" onClick={() => setAddOpen(true)}>
            Add provider
          </Button>
        </div>
        {providers.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', marginTop: 'var(--space-3)' }}>
            No providers yet. For a fully offline setup, install Ollama and add an OpenAI-compatible provider pointing at <code>http://localhost:11434/v1</code> with no key.
          </p>
        ) : (
          <div style={{ display: 'grid', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
            {providers.map((p) => (
              <div key={p.id} style={{ border: '1px solid var(--hairline)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 'var(--text-sm)' }}>{p.label}</strong>
                <Badge tone="info">{p.kind}</Badge>
                {p.hasKey ? <Badge tone="accent">key set</Badge> : <Badge>no key</Badge>}
                {!p.enabled && <Badge tone="warning">disabled</Badge>}
                <code style={{ fontSize: 'var(--text-xs)', color: 'var(--text-faint)' }}>{p.baseUrl}</code>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <Button size="sm" onClick={() => void testProvider(p.id)}>
                    Test
                  </Button>
                  <Button size="sm" onClick={() => void fetchModels(p.id)}>
                    Models
                  </Button>
                  <Button size="sm" onClick={() => void api.patch(`/api/providers/${p.id}`, { enabled: !p.enabled }).then(load)}>
                    {p.enabled ? 'Disable' : 'Enable'}
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => void api.delete(`/api/providers/${p.id}`).then(load)}>
                    Remove
                  </Button>
                </div>
                {models[p.id] !== undefined && (
                  <div style={{ width: '100%', fontSize: 'var(--text-xs)', color: 'var(--text-muted)', maxHeight: 100, overflowY: 'auto' }}>
                    {(models[p.id] ?? []).slice(0, 40).join(' · ') || 'No models reported'}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <h3>Model routing</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', margin: '4px 0 var(--space-4)' }}>
          Each task uses the first model in its list; the next step is tried automatically if a provider fails before answering.
        </p>
        <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
          {TASKS.map((t) => (
            <div key={t.value} style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid var(--hairline)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)' }}>
              <div style={{ flex: 1 }}>
                <strong style={{ fontSize: 'var(--text-sm)' }}>{t.label}</strong>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-faint)' }}>{t.hint}</div>
              </div>
              <code style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                {(routes[t.value] ?? []).map((s) => s.model).join(' → ') || 'not configured'}
              </code>
              <Button size="sm" onClick={() => { setRouteEdit(t.value); setRouteSteps(routes[t.value] ?? []); }}>
                Edit
              </Button>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h3>Account & data</h3>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 'var(--space-3)' }}>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
            Signed in as <strong>{user?.name}</strong> ({user?.email})
          </span>
          <Button size="sm" onClick={() => void api.post('/api/auth/logout-all').then(() => window.location.reload())}>
            Sign out everywhere
          </Button>
          <Button size="sm" onClick={() => void exportBackup()}>
            Export backup (JSON)
          </Button>
          <Button size="sm" variant="danger" onClick={() => setConfirmReset(true)}>
            Reset appearance
          </Button>
        </div>
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-faint)', marginTop: 'var(--space-3)' }}>
          Backups include your notes, cards, quizzes, tasks and metadata. Provider API keys are never exported.
        </p>
      </Card>

      <Modal open={addOpen} title="Add AI provider" onClose={() => setAddOpen(false)}>
        <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
          <Field label="Type">
            <Select
              value={form.kind}
              onChange={(e) => {
                const kind = e.target.value;
                setForm((f) => ({ ...f, kind, baseUrl: PROVIDER_KINDS.find((k) => k.value === kind)!.baseUrl }));
              }}
            >
              {PROVIDER_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label} — {k.hint}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Label">
            <Input value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder="My Ollama" />
          </Field>
          <Field label="Base URL">
            <Input value={form.baseUrl} onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))} />
          </Field>
          <Field label="API key" hint="Leave empty for local servers (Ollama, LM Studio).">
            <Input type="password" value={form.apiKey} onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))} placeholder="sk-…" />
          </Field>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => void addProvider()}>
              Add
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={routeEdit !== null} title={`Route: ${TASKS.find((t) => t.value === routeEdit)?.label ?? ''}`} onClose={() => setRouteEdit(null)} width={560}>
        <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
          {routeSteps.map((step, i) => (
            <div key={i} style={{ display: 'flex', gap: 8 }}>
              <Select
                value={step.providerId}
                onChange={(e) => {
                  const providerId = e.target.value;
                  void fetchModels(providerId);
                  setRouteSteps((s) => s.map((x, xi) => (xi === i ? { ...x, providerId, model: '' } : x)));
                }}
                style={{ flex: 1 }}
              >
                <option value="">Choose provider…</option>
                {(providers ?? []).filter((p) => p.enabled).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
              <Select value={step.model} onChange={(e) => setRouteSteps((s) => s.map((x, xi) => (xi === i ? { ...x, model: e.target.value } : x)))} style={{ flex: 1 }}>
                <option value="">Choose model…</option>
                {(models[step.providerId] ?? []).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
              <Button variant="ghost" onClick={() => setRouteSteps((s) => s.filter((_, xi) => xi !== i))}>
                ✕
              </Button>
            </div>
          ))}
          {routeSteps.length < 4 && (
            <Button onClick={() => setRouteSteps((s) => [...s, { providerId: '', model: '' }])}>+ Add fallback step</Button>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => setRouteEdit(null)}>Cancel</Button>
            <Button variant="primary" onClick={() => void saveRoute()}>
              Save route
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog open={confirmReset} title="Reset appearance" message="Theme, density and motion return to defaults on this device." confirmLabel="Reset" onConfirm={() => setAppearance({ theme: 'paper', density: 'comfortable', reducedMotion: false })} onClose={() => setConfirmReset(false)} />
    </div>
  );
}

export function AccountBadge({ user }: { user: PublicUser }) {
  return <Badge tone="accent">{user.name}</Badge>;
}
