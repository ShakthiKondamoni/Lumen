import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

export function Button({ variant = 'secondary', size, className = '', children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' }) {
  return (
    <button className={`btn btn-${variant}${size === 'sm' ? ' btn-sm' : ''} ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function Card({ children, className = '', pad = true, style }: { children: ReactNode; className?: string; pad?: boolean; style?: React.CSSProperties }) {
  return <div className={`card${pad ? ' card-pad' : ''} ${className}`} style={style}>{children}</div>;
}

export function Input(props: React.ComponentPropsWithRef<'input'>) {
  return <input className={`input ${props.className ?? ''}`} {...props} />;
}

export function Textarea(props: React.ComponentPropsWithRef<'textarea'>) {
  return <textarea className={`input ${props.className ?? ''}`} {...props} />;
}

export function Select(props: React.ComponentPropsWithRef<'select'>) {
  return <select className={`input ${props.className ?? ''}`} {...props} />;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-faint)', marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

export function Badge({ tone = 'default', children }: { tone?: 'default' | 'accent' | 'danger' | 'warning' | 'info'; children: ReactNode }) {
  return <span className={`badge${tone !== 'default' ? ` badge-${tone}` : ''}`}>{children}</span>;
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      {children && <p style={{ maxWidth: 420, margin: '0 auto' }}>{children}</p>}
      {action && <div style={{ marginTop: 'var(--space-4)' }}>{action}</div>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', color: 'var(--text-muted)', padding: 'var(--space-5)', justifyContent: 'center' }}>
      <div className="spinner" />
      {label && <span style={{ fontSize: 'var(--text-sm)' }}>{label}</span>}
    </div>
  );
}

export function Modal({ open, title, onClose, children, width }: { open: boolean; title: string; onClose: () => void; children: ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={width ? { maxWidth: width } : undefined} ref={ref} role="dialog" aria-modal="true" aria-label={title}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
          <h3>{title}</h3>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            ✕
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Delete', onConfirm, onClose }: { open: boolean; title: string; message: string; confirmLabel?: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <Modal open={open} title={title} onClose={onClose}>
      <p style={{ marginTop: 0, color: 'var(--text-muted)' }}>{message}</p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="danger"
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

export function Progress({ value }: { value: number }) {
  return (
    <div className="progress-track">
      <div className="progress-fill" style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }} />
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-4)', marginBottom: 'var(--space-5)' }}>
      <div>
        <h1>{title}</h1>
        {subtitle && <p style={{ color: 'var(--text-muted)', margin: '6px 0 0' }}>{subtitle}</p>}
      </div>
      {actions && <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: 'accent' }) {
  return (
    <Card>
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-3xl)', fontWeight: 600, marginTop: 4, ...(tone === 'accent' ? { color: 'var(--accent)' } : {}) }}>{value}</div>
      {hint && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-faint)', marginTop: 2 }}>{hint}</div>}
    </Card>
  );
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
