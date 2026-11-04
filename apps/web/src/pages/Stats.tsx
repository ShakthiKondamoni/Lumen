import { useEffect, useState } from 'react';
import { api } from '../api/client.ts';
import { Card, PageHeader, Spinner, Stat } from '../components/ui.tsx';
import type { FocusSessionDto, StatsDto } from '@lumen/shared';

export function StatsPage() {
  const [stats, setStats] = useState<StatsDto | null>(null);
  const [focus, setFocus] = useState<FocusSessionDto[]>([]);

  useEffect(() => {
    void api.get<{ stats: StatsDto }>('/api/stats').then((d) => setStats(d.stats));
    void api.get<{ sessions: FocusSessionDto[] }>('/api/focus').then((d) => setFocus(d.sessions));
  }, []);

  if (!stats) return <Spinner label="Crunching your numbers…" />;

  const maxForecast = Math.max(1, ...stats.forecast.map((f) => f.due));
  const focusByDay = new Map<string, number>();
  for (const s of focus) {
    if (!s.completed) continue;
    const day = s.startedAt.slice(0, 10);
    focusByDay.set(day, (focusByDay.get(day) ?? 0) + s.minutes);
  }
  const focusDays = [...focusByDay.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-14);
  const maxFocus = Math.max(30, ...focusDays.map(([, m]) => m));

  return (
    <div>
      <PageHeader title="Stats" subtitle="Real numbers from your own activity — no filler" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--space-3)' }}>
        <Stat label="Streak" value={`${stats.streakDays}d`} tone="accent" />
        <Stat label="Due today" value={stats.dueToday} />
        <Stat label="Reviews (7d)" value={stats.reviewedLast7} />
        <Stat label="Focus minutes (7d)" value={stats.focusMinutesLast7} />
        <Stat label="Quiz average" value={stats.quizAvgPct !== null ? `${Math.round(stats.quizAvgPct)}%` : '—'} />
        <Stat label="Documents" value={stats.documents} />
        <Stat label="Notes" value={stats.notes} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', marginTop: 'var(--space-5)', alignItems: 'start' }}>
        <Card>
          <h3>Review workload — next 14 days</h3>
          <div className="bar-chart" style={{ marginTop: 'var(--space-4)' }}>
            {stats.forecast.map((f) => (
              <div key={f.day} className="bar" style={{ height: `${Math.max(2, (f.due / maxForecast) * 100)}%` }} title={`${f.day}: ${f.due}`} />
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)', color: 'var(--text-faint)', marginTop: 6 }}>
            <span>today</span>
            <span>+14d</span>
          </div>
        </Card>
        <Card>
          <h3>Focus minutes — last 14 active days</h3>
          {focusDays.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>No focus sessions yet — time a session from the Focus page.</p>
          ) : (
            <>
              <div className="bar-chart" style={{ marginTop: 'var(--space-4)' }}>
                {focusDays.map(([day, m]) => (
                  <div key={day} className="bar" style={{ height: `${Math.max(2, (m / maxFocus) * 100)}%` }} title={`${day}: ${m} min`} />
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)', color: 'var(--text-faint)', marginTop: 6 }}>
                <span>{focusDays[0]![0]}</span>
                <span>{focusDays[focusDays.length - 1]![0]}</span>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
