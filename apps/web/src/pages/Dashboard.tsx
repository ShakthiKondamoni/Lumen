import { useEffect, useState } from 'react';
import { api } from '../api/client.ts';
import { navigate } from '../components/router.tsx';
import { Button, Card, PageHeader, Progress, Spinner, Stat, formatDate } from '../components/ui.tsx';
import type { DocumentDto, StatsDto, TaskDto } from '@lumen/shared';

export function DashboardPage() {
  const [stats, setStats] = useState<StatsDto | null>(null);
  const [tasks, setTasks] = useState<TaskDto[]>([]);
  const [docs, setDocs] = useState<DocumentDto[]>([]);

  useEffect(() => {
    void api.get<{ stats: StatsDto }>('/api/stats').then((d) => setStats(d.stats));
    void api.get<{ tasks: TaskDto[] }>('/api/tasks').then((d) => setTasks(d.tasks.filter((t) => !t.done).slice(0, 5)));
    void api.get<{ documents: DocumentDto[] }>('/api/documents').then((d) => setDocs(d.documents.slice(0, 5)));
  }, []);

  if (!stats) return <Spinner label="Loading your workspace…" />;

  const maxForecast = Math.max(1, ...stats.forecast.map((f) => f.due));

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Today at a glance" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--space-3)' }}>
        <Stat label="Due for review" value={stats.dueToday} tone="accent" hint={stats.dueToday > 0 ? 'A short session keeps the streak' : 'All caught up'} />
        <Stat label="Streak" value={`${stats.streakDays}d`} hint="Reviews + focus sessions" />
        <Stat label="Reviews last 7d" value={stats.reviewedLast7} />
        <Stat label="Focus last 7d" value={`${stats.focusMinutesLast7}m`} />
        <Stat label="Quiz average" value={stats.quizAvgPct !== null ? `${Math.round(stats.quizAvgPct)}%` : '—'} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 'var(--space-4)', marginTop: 'var(--space-5)', alignItems: 'start' }}>
        <Card>
          <h3>Review forecast — next 14 days</h3>
          <div className="bar-chart" style={{ marginTop: 'var(--space-4)' }} title="Cards due per day">
            {stats.forecast.map((f) => (
              <div key={f.day} className="bar" style={{ height: `${Math.max(2, (f.due / maxForecast) * 100)}%` }} title={`${f.day}: ${f.due} due`} />
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)', color: 'var(--text-faint)', marginTop: 6 }}>
            <span>today</span>
            <span>+14d</span>
          </div>
          {stats.dueToday > 0 && (
            <Button variant="primary" style={{ marginTop: 'var(--space-4)' }} onClick={() => navigate('/review')}>
              Start reviewing ({stats.dueToday})
            </Button>
          )}
        </Card>

        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>Open tasks</h3>
              <Button variant="ghost" size="sm" onClick={() => navigate('/planner')}>
                Planner →
              </Button>
            </div>
            {tasks.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', marginBottom: 0 }}>No open tasks — plan something below.</p>
            ) : (
              <ul style={{ margin: 'var(--space-3) 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
                {tasks.map((t) => (
                  <li key={t.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 'var(--text-sm)' }}>
                    <span>{t.title}</span>
                    {t.dueDate && <span style={{ color: 'var(--text-faint)' }}>{t.dueDate}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>Recent documents</h3>
              <Button variant="ghost" size="sm" onClick={() => navigate('/library')}>
                Library →
              </Button>
            </div>
            {docs.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', marginBottom: 0 }}>Nothing uploaded yet.</p>
            ) : (
              <ul style={{ margin: 'var(--space-3) 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
                {docs.map((d) => (
                  <li key={d.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 'var(--text-sm)', alignItems: 'center' }}>
                    <button style={{ all: 'unset', cursor: 'pointer', color: 'var(--accent)' }} onClick={() => navigate(`/library/${d.id}`)}>
                      {d.title}
                    </button>
                    <span style={{ color: 'var(--text-faint)', fontSize: 'var(--text-xs)' }}>{formatDate(d.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Card style={{ marginTop: 'var(--space-4)' }}>
        <h3>Workspace size</h3>
        <div style={{ display: 'flex', gap: 'var(--space-5)', marginTop: 'var(--space-3)', fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
          <span>{stats.documents} documents</span>
          <span>{stats.notes} notes</span>
        </div>
        <div style={{ marginTop: 'var(--space-3)' }}>
          <Progress value={Math.min(1, stats.documents / 50)} />
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-faint)', marginTop: 4 }}>Library capacity indicator (50 docs shown) — purely informational.</div>
        </div>
      </Card>
    </div>
  );
}
