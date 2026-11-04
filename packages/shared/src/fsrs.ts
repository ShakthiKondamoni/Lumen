// FSRS-4.5 spaced-repetition scheduler — pure functions, no I/O.
// Reference: open-spaced-repetition/fsrs4anki (weights & formulas).
// Default weights were trained by the FSRS project on large review logs;
// they are constants here (optimizer out of scope for a local app).

const W = [
  0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474,
  0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755,
] as const;

const DECAY = -0.5;
const FACTOR = 19 / 81;
const CLAMP = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export type Grade = 1 | 2 | 3 | 4; // again, hard, good, easy
export type CardState = 'new' | 'learning' | 'review' | 'relearning';

export interface FSRSMemory {
  stability: number;
  difficulty: number;
  state: CardState;
  due: string; // ISO timestamp
  lastReview: string | null;
  reps: number;
  lapses: number;
}

export function initMemory(now: Date): FSRSMemory {
  return {
    stability: 0,
    difficulty: 0,
    state: 'new',
    due: now.toISOString(),
    lastReview: null,
    reps: 0,
    lapses: 0,
  };
}

/** Probability the material is still retrievable at time `now`. */
export function retrievability(m: FSRSMemory, now: Date): number {
  if (m.state === 'new' || !m.lastReview || m.stability <= 0) return 0;
  const days = Math.max(0, (now.getTime() - new Date(m.lastReview).getTime()) / 86_400_000);
  return Math.pow(1 + FACTOR * (days / m.stability), DECAY);
}

function initialStability(grade: Grade): number {
  return W[grade - 1] ?? W[2]!;
}
function initialDifficulty(grade: Grade): number {
  // FSRS-4.5: linear in grade, clamped to [1, 10].
  return CLAMP(W[4]! - (grade - 3) * W[5]!, 1, 10);
}

function nextStabilityRecall(m: FSRSMemory, grade: Grade, r: number): number {
  const hardPenalty = grade === 2 ? W[15]! : 1;
  const easyBonus = grade === 4 ? W[16]! : 1;
  return (
    m.stability *
    (1 +
      Math.exp(W[8]!) *
        (11 - m.difficulty) *
        Math.pow(m.stability, -W[9]!) *
        (Math.exp(W[10]! * (1 - r)) - 1) *
        hardPenalty *
        easyBonus)
  );
}

function nextStabilityForget(m: FSRSMemory, r: number): number {
  return (
    W[11]! *
    Math.pow(m.difficulty, -W[12]!) *
    (Math.pow(m.stability + 1, W[13]!) - 1) *
    Math.exp(W[14]! * (1 - r))
  );
}

function intervalFor(stability: number, desiredRetention: number): number {
  // Inverse of the power forgetting curve, in days.
  const r = CLAMP(desiredRetention, 0.7, 0.98);
  return (stability / FACTOR) * (Math.pow(r, 1 / DECAY) - 1);
}

/**
 * Apply one review. `now` must be >= last review time.
 * 'again' schedules a short same-session step; other grades schedule days.
 */
export function reviewMemory(
  m: FSRSMemory,
  grade: Grade,
  now: Date,
  desiredRetention = 0.9,
): FSRSMemory {
  const r = m.state === 'new' ? 0 : retrievability(m, now);
  let stability: number;
  let difficulty: number;
  let state: CardState;

  if (m.state === 'new') {
    stability = initialStability(grade);
    difficulty = initialDifficulty(grade);
    state = grade === 1 ? 'learning' : 'review';
  } else {
    difficulty = CLAMP(W[7]! * initialDifficulty(grade) + (1 - W[7]!) * m.difficulty, 1, 10);
    stability = grade === 1 ? nextStabilityForget(m, r) : nextStabilityRecall(m, grade, r);
    state = grade === 1 ? 'relearning' : 'review';
  }

  stability = CLAMP(stability, 0.1, 36_500);

  let due: Date;
  if (grade === 1) {
    // Same-session relearning step; grows slightly with each lapse.
    due = new Date(now.getTime() + 10 * 60_000);
  } else {
    const days = Math.max(intervalFor(stability, desiredRetention), grade === 2 ? 0.4 : 0.9);
    due = new Date(now.getTime() + Math.round(days * 86_400_000));
  }

  return {
    stability,
    difficulty,
    state,
    due: due.toISOString(),
    lastReview: now.toISOString(),
    reps: m.reps + 1,
    lapses: m.lapses + (grade === 1 ? 1 : 0),
  };
}

/** Days until due (negative when overdue), 0 for due-now. */
export function daysUntil(m: FSRSMemory, now: Date): number {
  return (new Date(m.due).getTime() - now.getTime()) / 86_400_000;
}
