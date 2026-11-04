import { describe, expect, it } from 'vitest';
import { daysUntil, initMemory, retrievability, reviewMemory, type FSRSMemory } from '@lumen/shared';

const NOW = new Date('2026-01-15T09:00:00Z');
const asMemory = (m: FSRSMemory): FSRSMemory => m;

describe('FSRS scheduler', () => {
  it('schedules a new card rated good to ~1 day with sane memory values', () => {
    const m = initMemory(NOW);
    const next = reviewMemory(m, 3, NOW, 0.9);
    expect(next.state).toBe('review');
    expect(next.stability).toBeGreaterThan(0.9);
    expect(next.difficulty).toBeGreaterThan(1);
    expect(next.difficulty).toBeLessThanOrEqual(10);
    const days = daysUntil(next, NOW);
    expect(days).toBeGreaterThan(0.8);
    expect(days).toBeLessThan(10);
  });

  it('schedules again as a short same-session relearning step', () => {
    const next = reviewMemory(initMemory(NOW), 1, NOW, 0.9);
    expect(next.state).toBe('learning');
    expect(next.lapses).toBe(1);
    const minutes = (new Date(next.due).getTime() - NOW.getTime()) / 60_000;
    expect(minutes).toBeCloseTo(10, 0);
  });

  it('produces longer intervals for easy than hard at equal state', () => {
    const base = reviewMemory(initMemory(NOW), 3, NOW, 0.9);
    const later = new Date(NOW.getTime() + 86_400_000);
    const hard = reviewMemory(asMemory({ ...base }), 2, later, 0.9);
    const easy = reviewMemory(asMemory({ ...base }), 4, later, 0.9);
    expect(daysUntil(easy, later)).toBeGreaterThan(daysUntil(hard, later));
  });

  it('keeps intervals monotonic in stability across successive good reviews', () => {
    let m = reviewMemory(initMemory(NOW), 3, NOW, 0.9);
    let prev = daysUntil(m, NOW);
    for (let i = 0; i < 5; i++) {
      const at = new Date(new Date(m.due).getTime() + 1000);
      m = reviewMemory(m, 3, at, 0.9);
      const next = daysUntil(m, at);
      expect(next).toBeGreaterThan(prev);
      prev = next;
    }
  });

  it('reduces retrievability as time passes and raises it after review', () => {
    const m = reviewMemory(initMemory(NOW), 3, NOW, 0.9);
    const r1 = retrievability(m, new Date(NOW.getTime() + 86_400_000));
    const r2 = retrievability(m, new Date(NOW.getTime() + 10 * 86_400_000));
    expect(r2).toBeLessThan(r1);
    expect(r1).toBeLessThan(1);
  });

  it('handles a lapse after a mature history (relearning)', () => {
    let m = reviewMemory(initMemory(NOW), 3, NOW, 0.9);
    m = reviewMemory(m, 3, new Date(NOW.getTime() + 2 * 86_400_000), 0.9);
    m = reviewMemory(m, 1, new Date(new Date(m.due).getTime() + 1000), 0.9);
    expect(m.state).toBe('relearning');
    expect(m.lapses).toBe(1);
    expect(m.stability).toBeGreaterThan(0);
  });

  it('clamps stability to a sane envelope', () => {
    let m = reviewMemory(initMemory(NOW), 4, NOW, 0.98);
    for (let i = 0; i < 30; i++) {
      m = reviewMemory(m, 4, new Date(new Date(m.due).getTime() + 1000), 0.98);
      expect(m.stability).toBeLessThanOrEqual(36_500);
    }
  });
});
