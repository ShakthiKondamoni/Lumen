import { Hono } from 'hono';
import { attemptSubmitSchema, quizGenerateSchema } from '@lumen/shared';
import { errors } from '../core.ts';
import { QuizRepo } from '../repos/quiz.ts';
import { LibraryRepo } from '../repos/library.ts';
import { generateQuiz, gradeAttempt, citationFor } from '../services/quiz-gen.ts';
import { AiResolver } from '../services/tutor.ts';
import type { Deps, Env } from '../middleware.ts';
import { requireUser } from '../middleware.ts';

export function quizRouter(deps: Deps): Hono<Env> {
  const r = new Hono<Env>();
  const quizzes = new QuizRepo(deps.db);
  const library = new LibraryRepo(deps.db);
  const resolver = new AiResolver(deps.db, deps.masterKey, deps.config);

  r.get('/quizzes', (c) => {
    const userId = requireUser(c);
    return c.json({
      quizzes: quizzes.list(userId).map((q) => ({ id: q.id, title: q.title, kind: q.kind, documentId: q.document_id, questionCount: q.question_count, bestScore: q.best_score, createdAt: q.created_at })),
    });
  });

  r.post('/quizzes/generate', async (c) => {
    const userId = requireUser(c);
    const input = quizGenerateSchema.parse(await c.req.json());
    const { quizId } = await generateQuiz(deps.db, resolver, userId, input.documentId, input.count, input.kinds, input.scopeChunkIds);
    return c.json({ quizId }, 201);
  });

  r.get('/quizzes/:id', (c) => {
    const userId = requireUser(c);
    const quiz = quizzes.quiz(userId, c.req.param('id'));
    if (!quiz) throw errors.notFound('Quiz not found');
    const questions = quizzes.questions(quiz.id).map((q) => ({
      id: q.id,
      prompt: q.prompt,
      choices: JSON.parse(q.choices) as string[],
      // Never send the answer key before submission.
      answerIndex: null as number | null,
      answerText: null as string | null,
      explanation: '',
      citation: null,
    }));
    return c.json({ quiz: { id: quiz.id, title: quiz.title, kind: quiz.kind, documentId: quiz.document_id, timeLimitMin: quiz.time_limit_min, createdAt: quiz.created_at }, questions });
  });

  r.post('/quizzes/:id/submit', async (c) => {
    const userId = requireUser(c);
    const quiz = quizzes.quiz(userId, c.req.param('id'));
    if (!quiz) throw errors.notFound('Quiz not found');
    const input = attemptSubmitSchema.parse(await c.req.json());
    const { attempt, perQuestion, scorePct } = gradeAttempt(deps.db, userId, quiz.id, input.answers);
    const withCitations = perQuestion.map((p) => {
      const q = quizzes.questions(quiz.id).find((qq) => qq.id === p.questionId);
      return { ...p, citation: q ? citationFor(deps.db, userId, q.chunk_id) : null };
    });
    return c.json({ attempt: { id: attempt.id, quizId: quiz.id, scorePct, perQuestion: withCitations, finishedAt: attempt.finished_at } });
  });

  r.delete('/quizzes/:id', (c) => {
    const userId = requireUser(c);
    if (!quizzes.quiz(userId, c.req.param('id'))) throw errors.notFound('Quiz not found');
    quizzes.delete(userId, c.req.param('id'));
    return c.json({ ok: true });
  });

  r.get('/documents/:id/summary-targets', (c) => {
    const userId = requireUser(c);
    const doc = library.document(userId, c.req.param('id'));
    if (!doc) throw errors.notFound('Document not found');
    return c.json({ chunks: library.chunksForDocument(userId, doc.id).length });
  });

  return r;
}
