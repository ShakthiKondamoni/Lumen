import { useEffect, useState } from 'react';
import { api } from '../api/client.ts';
import { Badge, Button, Card, EmptyState, PageHeader, Progress, Spinner } from '../components/ui.tsx';
import { useToast } from '../state/app.tsx';
import type { JobDto } from '@lumen/shared';

export function JobsPage() {
  const { notify } = useToast();
  const [jobs, setJobs] = useState<JobDto[] | null>(null);

  const load = () => void api.get<{ jobs: JobDto[] }>('/api/jobs').then((d) => setJobs(d.jobs));
  useEffect(() => {
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, []);

  const cancel = async (id: string) => {
    try {
      await api.post(`/api/jobs/${id}/cancel`);
      notify('Cancellation requested');
      load();
    } catch {
      notify('Job already finished');
    }
  };

  if (jobs === null) return <Spinner label="Loading jobs…" />;

  return (
    <div>
      <PageHeader title="Jobs" subtitle="Document processing and OCR run in the background — progress is checkpointed here" />
      {jobs.length === 0 ? (
        <Card>
          <EmptyState title="No background jobs">Upload a document or run OCR and it will appear here with live progress.</EmptyState>
        </Card>
      ) : (
        <Card pad={false}>
          {jobs.map((j) => (
            <div key={j.id} style={{ padding: 'var(--space-4) 16px', borderBottom: '1px solid var(--hairline)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 'var(--text-sm)' }}>{j.label}</strong>
                <Badge tone={j.status === 'done' ? 'accent' : j.status === 'failed' ? 'danger' : j.status === 'cancelled' ? 'warning' : 'info'}>{j.status}</Badge>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-faint)', marginLeft: 'auto' }}>
                  {new Date(j.createdAt).toLocaleString()}
                </span>
                {(j.status === 'queued' || j.status === 'running') && (
                  <Button variant="ghost" size="sm" onClick={() => void cancel(j.id)}>
                    Cancel
                  </Button>
                )}
              </div>
              {(j.status === 'running' || j.status === 'queued') && (
                <div style={{ marginTop: 10 }}>
                  <Progress value={j.progress} />
                </div>
              )}
              {j.error && <div style={{ color: 'var(--danger)', fontSize: 'var(--text-sm)', marginTop: 8 }}>{j.error}</div>}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
