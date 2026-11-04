import type { Db } from '../db/db.ts';
import { LibraryRepo } from '../repos/library.ts';
import { NotesRepo } from '../repos/notes.ts';
import { QuizRepo } from '../repos/quiz.ts';
import { ReviewRepo } from '../repos/review.ts';
import { PlanRepo } from '../repos/plan.ts';

/** Aggregates the dashboard numbers and the 14-day review forecast. */
export function collectStats(db: Db, userId: string) {
  const review = new ReviewRepo(db);
  const quizzes = new QuizRepo(db);
  const plan = new PlanRepo(db);
  const library = new LibraryRepo(db);
  const notes = new NotesRepo(db);
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const dayMs = 86_400_000;

  // Streak: consecutive days (ending today, allowing "not yet active today")
  // with any review or completed focus session.
  const activity = new Set<string>([
    ...db.all<{ d: string }>('SELECT DISTINCT substr(reviewed_at, 1, 10) AS d FROM review_log WHERE user_id = ?', userId).map((r) => r.d),
    ...db.all<{ d: string }>('SELECT DISTINCT substr(started_at, 1, 10) AS d FROM focus_sessions WHERE user_id = ? AND completed = 1', userId).map((r) => r.d),
  ]);
  let streakDays = 0;
  for (let i = 1; i <= 365; i++) {
    const day = new Date(now.getTime() - i * dayMs).toISOString().slice(0, 10);
    if (activity.has(day)) streakDays++;
    else break;
  }

  const dueTodayRow = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM cards WHERE user_id = ? AND suspended = 0 AND (state = 'new' OR due <= ?)`,
    userId,
    now.toISOString(),
  );

  return {
    dueToday: dueTodayRow?.n ?? 0,
    reviewedLast7: review.reviewedCount(userId, weekAgo),
    focusMinutesLast7: plan.focusMinutes(userId, weekAgo),
    quizAvgPct: quizzes.averageScore(userId),
    documents: library.listDocuments(userId).length,
    notes: notes.list(userId).length,
    streakDays,
    forecast: review.forecast(userId, 14, now),
  };
}
