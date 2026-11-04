import { useCallback, useEffect, useState, type ReactNode } from 'react';

// Minimal hash router — no dependency, deep-linkable (#/library/doc-123).
// Routes are plain strings; ":name" segments capture params.

export interface RouteMatch {
  path: string;
  params: Record<string, string>;
}

function currentPath(): string {
  const hash = window.location.hash.replace(/^#/, '');
  return hash === '' ? '/' : hash;
}

export function parsePattern(pattern: string, path: string): RouteMatch | null {
  const pParts = pattern.split('/').filter(Boolean);
  const aParts = path.split('/').filter(Boolean);
  if (pParts.length !== aParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pParts.length; i++) {
    const p = pParts[i]!;
    const a = aParts[i]!;
    if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(a);
    else if (p !== a) return null;
  }
  return { path, params };
}

export function navigate(to: string): void {
  window.location.hash = to;
}

export function useRoute(): RouteMatch {
  const [path, setPath] = useState(currentPath);
  useEffect(() => {
    const listener = () => setPath(currentPath());
    window.addEventListener('hashchange', listener);
    return () => window.removeEventListener('hashchange', listener);
  }, []);
  return { path, params: {} };
}

export function Route({ pattern, path, render }: { pattern: string; path: string; render: (params: Record<string, string>) => ReactNode }) {
  const match = parsePattern(pattern, path);
  return match ? <>{render(match.params)}</> : null;
}

export function Link({ to, children, ...rest }: { to: string; children: ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const onClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      navigate(to);
    },
    [to],
  );
  return (
    <a href={`#${to}`} onClick={onClick} {...rest}>
      {children}
    </a>
  );
}
