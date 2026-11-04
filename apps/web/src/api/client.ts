// In the desktop shell the bundle is served from lumen://, so API calls go
// to the absolute loopback base injected by the preload bridge. In the
// browser (dev server / preview) calls are same-origin and the base is ''.
declare global {
  interface Window {
    lumen?: { desktop: boolean; apiBase: string };
  }
}

const BASE: string = typeof window !== 'undefined' && window.lumen ? window.lumen.apiBase : '';

let cachedCsrf: string | null = null;

function csrfToken(): string {
  if (cachedCsrf) return cachedCsrf;
  const match = document.cookie.match(/(?:^|;\s*)lumen_csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]!) : '';
}

async function refreshCsrf(): Promise<void> {
  try {
    const res = await fetch(`${BASE}/api/auth/csrf`, { credentials: 'include' });
    if (res.ok) {
      const data = (await res.json()) as { token: string };
      cachedCsrf = data.token;
    }
  } catch {
    cachedCsrf = null;
  }
}

function invalidateCsrf(): void {
  cachedCsrf = null;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (method !== 'GET' && cachedCsrf === null && typeof window !== 'undefined' && window.lumen) {
    await refreshCsrf();
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(method !== 'GET' ? { 'x-csrf-token': csrfToken() } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'include',
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : {};
  if (path.startsWith('/api/auth/')) {
    if (res.ok && (path.endsWith('/login') || path.endsWith('/register'))) void refreshCsrf();
    if (path.endsWith('/logout') || path.endsWith('/logout-all')) invalidateCsrf();
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } }).error;
    throw new ApiError(res.status, err?.code ?? 'UNKNOWN', err?.message ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
  upload: async <T>(path: string, form: FormData): Promise<T> => {
    const res = await fetch(`${BASE}${path}`, { method: 'POST', body: form, credentials: 'include', headers: { 'x-csrf-token': csrfToken() } });
    const data = (await res.json()) as unknown;
    if (!res.ok) {
      const err = (data as { error?: { code?: string; message?: string } }).error;
      throw new ApiError(res.status, err?.code ?? 'UNKNOWN', err?.message ?? `Upload failed (${res.status})`);
    }
    return data as T;
  },
};

/** Reads a chat turn SSE stream. Returns a cancel function. */
export function streamTurn(
  conversationId: string,
  content: string,
  handlers: {
    onMeta?: (meta: { model: string; provider: string }) => void;
    onDelta?: (text: string) => void;
    onDone?: (message: { id: string; content: string; citations: unknown[]; model: string | null }) => void;
    onError?: (message: string) => void;
  },
): { cancel: () => void; promise: Promise<void> } {
  const controller = new AbortController();
  const promise = (async () => {
    try {
      const res = await fetch(`${BASE}/api/conversations/${conversationId}/turn`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken() },
        body: JSON.stringify({ content }),
        credentials: 'include',
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        handlers.onError?.(data.error?.message ?? `Request failed (${res.status})`);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          let event = 'message';
          const dataLines: string[] = [];
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
          }
          if (dataLines.length === 0) continue;
          const payload = JSON.parse(dataLines.join('\n')) as Record<string, unknown>;
          if (event === 'meta') handlers.onMeta?.(payload as { model: string; provider: string });
          else if (event === 'delta') handlers.onDelta?.(payload.text as string);
          else if (event === 'done') {
            handlers.onDone?.(payload.message as { id: string; content: string; citations: unknown[]; model: string | null });
            break outer;
          } else if (event === 'error') {
            handlers.onError?.(payload.message as string);
            break outer;
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') handlers.onError?.((err as Error).message);
    }
  })();
  return { cancel: () => controller.abort(), promise };
}

export function qs(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '');
  if (entries.length === 0) return '';
  return `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()}`;
}
