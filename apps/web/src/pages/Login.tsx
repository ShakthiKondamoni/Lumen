import { useState } from 'react';
import { useAuth, useToast } from '../state/app.tsx';
import { Button, Card, Field, Input } from '../components/ui.tsx';
import { ApiError } from '../api/client.ts';

export function LoginPage() {
  const { signIn, register } = useAuth();
  const { notify } = useToast();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') await signIn(email, password);
      else await register(email, name, password);
      notify(mode === 'login' ? 'Welcome back' : 'Account created — welcome');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 'var(--space-5)' }}>
      <div style={{ width: 'min(420px, 100%)' }}>
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-6)' }}>
          <div style={{ width: 52, height: 52, borderRadius: 15, background: 'var(--accent)', color: 'var(--accent-contrast)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 26, margin: '0 auto var(--space-3)' }}>L</div>
          <h1 style={{ fontSize: 'var(--text-2xl)' }}>Lumen</h1>
          <p style={{ color: 'var(--text-muted)', margin: '6px 0 0' }}>Your calm, local-first study workspace.</p>
        </div>
        <Card>
          <div style={{ display: 'flex', gap: 6, marginBottom: 'var(--space-4)' }}>
            <Button variant={mode === 'login' ? 'primary' : 'ghost'} onClick={() => setMode('login')} style={{ flex: 1 }}>
              Sign in
            </Button>
            <Button variant={mode === 'register' ? 'primary' : 'ghost'} onClick={() => setMode('register')} style={{ flex: 1 }}>
              Create account
            </Button>
          </div>
          <form onSubmit={(e) => void submit(e)} style={{ display: 'grid', gap: 'var(--space-3)' }}>
            {mode === 'register' && (
              <Field label="Name">
                <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoComplete="name" placeholder="Maya" />
              </Field>
            )}
            <Field label="Email">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" placeholder="you@example.com" />
            </Field>
            <Field label="Password" hint={mode === 'register' ? 'At least 10 characters. Stored only on this machine.' : undefined}>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={mode === 'register' ? 10 : 1} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} />
            </Field>
            {error && (
              <div role="alert" style={{ background: 'var(--danger-soft)', color: 'var(--danger)', borderRadius: 'var(--radius-md)', padding: '10px 12px', fontSize: 'var(--text-sm)' }}>
                {error}
              </div>
            )}
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? 'One moment…' : mode === 'login' ? 'Sign in' : 'Create account'}
            </Button>
          </form>
        </Card>
        <p style={{ textAlign: 'center', fontSize: 'var(--text-xs)', color: 'var(--text-faint)', marginTop: 'var(--space-4)' }}>
          Everything is stored locally on this machine. The server binds to 127.0.0.1 only.
        </p>
      </div>
    </div>
  );
}
