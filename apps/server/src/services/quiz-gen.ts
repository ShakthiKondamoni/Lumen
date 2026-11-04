import { z } from 'zod';
import type { Db } from '../db/db.ts';
import { errors, log } from '../core.ts';
import { LibraryRepo } from '../repos/library.ts';
import { QuizRepo } from '../repos/quiz.ts';
import { completeChat, type ChatMessage } from './ai.ts';
import type { AiResolver } from './tutor.ts';
import { toChunkDto } from './intel.ts';

const generatedSchema = z.object({
  questions: z
    .array(
      z.object({
        prompt: z.string().min(1),
        kind: z.enum(['mcq', 'short']),
        choices: z.array(z.string()).default([]),
        answerIndex: z.number().int().min(0).nullable().default(null),
        answer: z.string().default(''),
        explanation: z.string().default(''),
        sourceIndex: z.number().int().min(1).nullable().default(null),
      }),
    )
    .min(1),
});

/** Generates quiz questions from a document's chunks with the routed quiz model. */
export async function generateQuiz(
  db: Db,
  resolver: AiResolver,
  userId: string,
  documentId: string,
  count: number,
  kinds: ('mcq' | 'short')[],
  scopeChunkIds: string[] | undefined,
  examMode?: 'standard' | 'competitive' | 'case_vignette' | 'assertion_reason',
): Promise<{ quizId: string }> {
  const library = new LibraryRepo(db);
  const quizzes = new QuizRepo(db);
  const doc = library.document(userId, documentId);
  if (!doc) throw errors.notFound('Document not found');

  let chunkRows = library.chunksForDocument(userId, documentId);
  if (scopeChunkIds && scopeChunkIds.length > 0) {
    const wanted = new Set(scopeChunkIds);
    chunkRows = chunkRows.filter((c) => wanted.has(c.id));
  }
  if (chunkRows.length === 0) {
    throw errors.badRequest('This document has no processed text yet. Run processing or OCR first.');
  }
  const picked = pickSpread(chunkRows, count);
  const steps = resolver.resolve(userId, 'quiz');

  const sources = picked.map((row, i) => `[${i + 1}] (pages ${row.page_start}-${row.page_end})\n${row.content}`).join('\n\n---\n\n');
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You write study quizzes. Reply with ONLY minified JSON, no markdown fences, matching exactly: ' +
        '{"questions":[{"prompt":string,"kind":"mcq"|"short","choices":string[],"answerIndex":number|null,"answer":string,"explanation":string,"sourceIndex":number|null}]} ' +
        'For "mcq" provide exactly 4 choices and the 0-based answerIndex. For "short" leave choices empty, put the model answer in "answer". ' +
        'sourceIndex is the 1-based source excerpt the question came from. Ground every question in the excerpts; do not invent facts.',
    },
    {
      role: 'user',
      content: `Write ${count} questions (${kinds.join(' and ')}) from these excerpts of "${doc.title}":\n\n${sources}`,
    },
  ];

  let raw: string | null = null;
  let lastError: unknown = null;
  for (const step of steps) {
    try {
      const result = await completeChat(step, messages);
      raw = result.text;
      break;
    } catch (err) {
      lastError = err;
      log('warn', 'quiz-gen.fallback', { provider: step.label, error: String(err) });
    }
  }
  if (raw === null) throw lastError instanceof Error ? lastError : errors.upstream('Question generation failed');

  const parsed = safeParse(raw);
  if (!parsed || parsed.questions.length === 0) {
    throw errors.upstream('The model did not return usable questions — try again or pick another model.');
  }

  const quiz = quizzes.create(userId, `${doc.title} — quiz`, 'practice', documentId, null);
  quizzes.addQuestions(
    quiz.id,
    parsed.questions.slice(0, count).map((q, i) => {
      const src = q.sourceIndex !== null ? picked[q.sourceIndex - 1] : undefined;
      return {
        ordinal: i,
        prompt: q.prompt,
        choices: JSON.stringify(q.kind === 'mcq' ? q.choices.slice(0, 4) : []),
        answer_index: q.kind === 'mcq' ? q.answerIndex : null,
        answer_text: q.kind === 'short' ? q.answer || q.explanation : null,
        explanation: q.explanation,
        chunk_id: src?.id ?? null,
      };
    }),
  );
  return { quizId: quiz.id };
}

export function gradeAttempt(db: Db, userId: string, quizId: string, answers: { questionId: string; choiceIndex: number | null; text?: string }[]) {
  const quizzes = new QuizRepo(db);
  const quiz = quizzes.quiz(userId, quizId);
  if (!quiz) throw errors.notFound('Quiz not found');
  const questions = quizzes.questions(quizId);
  const byId = new Map(questions.map((q) => [q.id, q]));
  const perQuestion = answers.map((a) => {
    const q = byId.get(a.questionId);
    if (!q) return { questionId: a.questionId, correct: false, expected: '(removed question)' };
    if (q.answer_index !== null) {
      return { questionId: q.id, correct: a.choiceIndex === q.answer_index, expected: q.explanation || `Correct choice: ${(JSON.parse(q.choices) as string[])[q.answer_index] ?? '?'}` };
    }
    const expected = (q.answer_text ?? '').trim().toLowerCase();
    const given = (a.text ?? '').trim().toLowerCase();
    const correct = expected.length > 0 && (given === expected || (expected.length > 8 && given.includes(expected)) || (given.length > 8 && expected.includes(given)));
    return { questionId: q.id, correct, expected: q.answer_text ?? q.explanation };
  });
  const correctCount = perQuestion.filter((p) => p.correct).length;
  const scorePct = perQuestion.length > 0 ? Math.round((100 * correctCount) / perQuestion.length) : 0;
  const attempt = quizzes.addAttempt(userId, quizId, scorePct, perQuestion);
  return { attempt, perQuestion, scorePct };
}

/** Evenly sample chunks so questions cover the whole document, not just page 1. */
function pickSpread<T>(rows: T[], count: number): T[] {
  if (rows.length <= count) return rows;
  const out: T[] = [];
  const step = rows.length / count;
  for (let i = 0; i < count; i++) out.push(rows[Math.floor(i * step)]!);
  return out;
}

function safeParse(raw: string): z.infer<typeof generatedSchema> | null {
  const jsonText = raw.replace(/^```(?:json)?/m, '').replace(/```\s*$/m, '').trim();
  const start = jsonText.indexOf('{');
  const end = jsonText.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return generatedSchema.parse(JSON.parse(jsonText.slice(start, end + 1)));
  } catch (err) {
    log('warn', 'quiz-gen.parse-failed', { error: String(err) });
    return null;
  }
}

export function citationFor(db: Db, userId: string, chunkId: string | null) {
  if (!chunkId) return null;
  const library = new LibraryRepo(db);
  const row = library.chunk(userId, chunkId);
  if (!row) return null;
  const doc = library.document(userId, row.document_id);
  return toChunkDto(row, doc?.title ?? 'Document');
}
