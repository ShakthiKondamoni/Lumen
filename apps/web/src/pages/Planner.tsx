import { useEffect, useState } from 'react';
import { api } from '../api/client.ts';
import { Badge, Button, Card, EmptyState, Input, PageHeader, Spinner } from '../components/ui.tsx';
import { useToast } from '../state/app.tsx';
import type { TaskDto } from '@lumen/shared';

export function PlannerPage() {
  const { notify } = useToast();
  const [tasks, setTasks] = useState<TaskDto[] | null>(null);
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [estimate, setEstimate] = useState('');

  const load = () => void api.get<{ tasks: TaskDto[] }>('/api/tasks').then((d) => setTasks(d.tasks));
  useEffect(load, []);

  const add = async () => {
    if (!title.trim()) return;
    await api.post('/api/tasks', {
      title: title.trim(),
      dueDate: dueDate || undefined,
      estimateMin: estimate ? Number(estimate) : undefined,
    });
    setTitle('');
    setDueDate('');
    setEstimate('');
    load();
  };

  const toggle = async (t: TaskDto) => {
    await api.post(`/api/tasks/${t.id}/toggle`);
    load();
  };

  const remove = async (t: TaskDto) => {
    await api.delete(`/api/tasks/${t.id}`);
    notify('Task removed');
    load();
  };

  if (tasks === null) return <Spinner />;

  const open = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <PageHeader title="Planner" subtitle="Small, dated commitments beat vague intentions" />
      <Card>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Input placeholder="What will you study?" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} style={{ flex: 2, minWidth: 220 }} />
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} style={{ width: 160 }} />
          <Input type="number" placeholder="min" min={5} max={480} value={estimate} onChange={(e) => setEstimate(e.target.value)} style={{ width: 90 }} />
          <Button variant="primary" onClick={() => void add()}>
            Add task
          </Button>
        </div>
      </Card>

      {tasks.length === 0 ? (
        <Card style={{ marginTop: 'var(--space-4)' }}>
          <EmptyState title="No tasks yet">Add your first study task above — give it a date to see it on the dashboard.</EmptyState>
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--space-4)', marginTop: 'var(--space-4)' }}>
          <Card pad={false}>
            {open.map((t) => {
              const overdue = t.dueDate !== null && t.dueDate < today;
              return (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--hairline)' }}>
                  <input type="checkbox" checked={false} onChange={() => void toggle(t)} aria-label={`Complete ${t.title}`} />
                  <span style={{ flex: 1 }}>{t.title}</span>
                  {t.estimateMin && <Badge>{t.estimateMin}m</Badge>}
                  {t.dueDate && <Badge tone={overdue ? 'danger' : 'info'}>{overdue ? 'Overdue · ' : ''}{t.dueDate}</Badge>}
                  <Button variant="ghost" size="sm" onClick={() => void remove(t)}>
                    ✕
                  </Button>
                </div>
              );
            })}
          </Card>
          {done.length > 0 && (
            <Card pad={false}>
              {done.map((t) => (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', borderBottom: '1px solid var(--hairline)', color: 'var(--text-faint)' }}>
                  <input type="checkbox" checked onChange={() => void toggle(t)} aria-label={`Reopen ${t.title}`} />
                  <span style={{ flex: 1, textDecoration: 'line-through' }}>{t.title}</span>
                  <Button variant="ghost" size="sm" onClick={() => void remove(t)}>
                    ✕
                  </Button>
                </div>
              ))}
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
