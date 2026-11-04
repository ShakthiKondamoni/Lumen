import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api/client.ts';
import type { PublicUser, Settings } from '@lumen/shared';

// ---------- appearance (theme/density/motion) ----------
interface Appearance {
  theme: Settings['theme'];
  density: Settings['density'];
  reducedMotion: boolean;
}

const AppearanceContext = createContext<{ appearance: Appearance; setAppearance: (a: Partial<Appearance>) => void }>({
  appearance: { theme: 'paper', density: 'comfortable', reducedMotion: false },
  setAppearance: () => undefined,
});

function systemTheme(): 'paper' | 'graphite' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'graphite' : 'paper';
}

function applyAppearance(a: Appearance): void {
  const root = document.documentElement;
  root.setAttribute('data-theme', a.theme === 'system' ? systemTheme() : a.theme);
  root.setAttribute('data-density', a.density);
  root.setAttribute('data-reduced-motion', a.reducedMotion ? '1' : '0');
  localStorage.setItem('lumen.appearance', JSON.stringify(a));
}

export function AppearanceProvider({ children, initial }: { children: ReactNode; initial?: Appearance }) {
  const [appearance, setState] = useState<Appearance>(initial ?? { theme: 'paper', density: 'comfortable', reducedMotion: false });
  useEffect(() => {
    applyAppearance(appearance);
  }, [appearance]);
  useEffect(() => {
    if (appearance.theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = () => applyAppearance(appearance);
    mq.addEventListener('change', listener);
    return () => mq.removeEventListener('change', listener);
  }, [appearance]);
  const setAppearance = useCallback((patch: Partial<Appearance>) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      void api.put('/api/settings', next).catch(() => undefined);
      return next;
    });
  }, []);
  const value = useMemo(() => ({ appearance, setAppearance }), [appearance, setAppearance]);
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export const useAppearance = () => useContext(AppearanceContext);

// ---------- auth session ----------
const AuthContext = createContext<{
  user: PublicUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  register: (email: string, name: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}>({ user: null, loading: true, refresh: async () => undefined, signIn: async () => undefined, register: async () => undefined, signOut: async () => undefined });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      const data = await api.get<{ user: PublicUser }>('/api/auth/me');
      setUser(data.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const signIn = useCallback(async (email: string, password: string) => {
    const data = await api.post<{ user: PublicUser }>('/api/auth/login', { email, password });
    setUser(data.user);
    await syncServerAppearance(data.user);
  }, []);
  const register = useCallback(async (email: string, name: string, password: string) => {
    const data = await api.post<{ user: PublicUser }>('/api/auth/register', { email, name, password });
    setUser(data.user);
    await syncServerAppearance(data.user);
  }, []);
  const signOut = useCallback(async () => {
    await api.post('/api/auth/logout');
    setUser(null);
  }, []);
  const value = useMemo(() => ({ user, loading, refresh, signIn, register, signOut }), [user, loading, refresh, signIn, register, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

async function syncServerAppearance(user: PublicUser): Promise<void> {
  try {
    const data = await api.get<{ settings: Settings }>('/api/settings');
    const root = document.documentElement;
    root.setAttribute('data-theme', data.settings.theme === 'system' ? systemTheme() : data.settings.theme);
    root.setAttribute('data-density', data.settings.density);
    root.setAttribute('data-reduced-motion', data.settings.reducedMotion ? '1' : '0');
    localStorage.setItem('lumen.appearance', JSON.stringify({ theme: data.settings.theme, density: data.settings.density, reducedMotion: data.settings.reducedMotion }));
  } catch {
    void user;
  }
}

export const useAuth = () => useContext(AuthContext);

// ---------- toast ----------
const ToastContext = createContext<{ notify: (message: string) => void }>({ notify: () => undefined });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; id: number } | null>(null);
  const notify = useCallback((message: string) => {
    setToast({ message, id: Date.now() });
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3600);
    return () => clearTimeout(t);
  }, [toast]);
  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      {toast && (
        <div className="toast" role="status">
          {toast.message}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
