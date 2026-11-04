import { z } from 'zod';

// ---------- auth ----------
export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z.string().min(10, 'Use at least 10 characters').max(200);
export const registerSchema = z.object({ email: emailSchema, name: z.string().trim().min(1).max(80), password: passwordSchema });
export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(200) });
export const publicUserSchema = z.object({ id: z.string(), email: z.string(), name: z.string(), createdAt: z.string() });
export type PublicUser = z.infer<typeof publicUserSchema>;

// ---------- settings ----------
export const themeSchema = z.enum(['paper', 'graphite', 'midnight', 'system']);
export const densitySchema = z.enum(['compact', 'comfortable']);
export const settingsSchema = z.object({
  theme: themeSchema,
  density: densitySchema,
  reducedMotion: z.boolean(),
  desiredRetention: z.number().min(0.7).max(0.98),
});
export type Settings = z.infer<typeof settingsSchema>;
export const defaultSettings: Settings = { theme: 'paper', density: 'comfortable', reducedMotion: false, desiredRetention: 0.9 };

// ---------- providers / routing ----------
export const providerKindSchema = z.enum(['openai-compatible', 'anthropic', 'gemini']);
export type ProviderKind = z.infer<typeof providerKindSchema>;
export const providerCreateSchema = z.object({
  kind: providerKindSchema,
  label: z.string().trim().min(1).max(60),
  baseUrl: z.string().trim().url().max(300),
  apiKey: z.string().max(400).optional(),
});
export const providerUpdateSchema = z.object({
  label: z.string().trim().min(1).max(60).optional(),
  baseUrl: z.string().trim().url().max(300).optional(),
  apiKey: z.string().max(400).optional(),
  enabled: z.boolean().optional(),
});
export const routeTaskSchema = z.enum(['chat', 'tutor', 'quiz', 'summarize']);
export type RouteTask = z.infer<typeof routeTaskSchema>;
export const routeStepSchema = z.object({ providerId: z.string(), model: z.string().min(1).max(120) });
export type RouteStep = z.infer<typeof routeStepSchema>;
export const routeSetSchema = z.object({ task: routeTaskSchema, steps: z.array(routeStepSchema).max(5) });
export const publicProviderSchema = z.object({
  id: z.string(),
  kind: providerKindSchema,
  label: z.string(),
  baseUrl: z.string(),
  enabled: z.boolean(),
  hasKey: z.boolean(),
});
export type PublicProvider = z.infer<typeof publicProviderSchema>;

// ---------- library ----------
export const subjectCreateSchema = z.object({ name: z.string().trim().min(1).max(80), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() });
export const subjectDtoSchema = z.object({ id: z.string(), name: z.string(), color: z.string(), documentCount: z.number().int() });
export type SubjectDto = z.infer<typeof subjectDtoSchema>;
export const documentStatusSchema = z.enum(['processing', 'ready', 'failed', 'ocr_required']);
export type DocumentStatus = z.infer<typeof documentStatusSchema>;
export const documentDtoSchema = z.object({
  id: z.string(),
  subjectId: z.string().nullable(),
  title: z.string(),
  filename: z.string(),
  mime: z.string(),
  sizeBytes: z.number().int(),
  pageCount: z.number().int().nullable(),
  status: documentStatusSchema,
  needsOcr: z.boolean(),
  createdAt: z.string(),
});
export type DocumentDto = z.infer<typeof documentDtoSchema>;
export const chunkDtoSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  documentTitle: z.string(),
  pageStart: z.number().int(),
  pageEnd: z.number().int(),
  headingPath: z.string(),
  content: z.string(),
  score: z.number().optional(),
});
export type ChunkDto = z.infer<typeof chunkDtoSchema>;
export const searchSchema = z.object({ q: z.string().trim().min(1).max(400), documentId: z.string().optional(), limit: z.number().int().min(1).max(40).optional() });

// ---------- jobs ----------
export const jobStatusSchema = z.enum(['queued', 'running', 'done', 'failed', 'cancelled']);
export type JobStatus = z.infer<typeof jobStatusSchema>;
export const jobDtoSchema = z.object({
  id: z.string(),
  kind: z.string(),
  label: z.string(),
  status: jobStatusSchema,
  progress: z.number().min(0).max(1),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type JobDto = z.infer<typeof jobDtoSchema>;

// ---------- chat / tutor ----------
export const conversationKindSchema = z.enum(['chat', 'tutor']);
export const conversationDtoSchema = z.object({
  id: z.string(),
  kind: conversationKindSchema,
  title: z.string(),
  documentId: z.string().nullable(),
  updatedAt: z.string(),
});
export type ConversationDto = z.infer<typeof conversationDtoSchema>;
export const messageDtoSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  citations: z.array(chunkDtoSchema),
  model: z.string().nullable(),
  createdAt: z.string(),
});
export type MessageDto = z.infer<typeof messageDtoSchema>;
export const sendTurnSchema = z.object({ content: z.string().trim().min(1).max(8000) });
export const conversationCreateSchema = z.object({ kind: conversationKindSchema, title: z.string().trim().max(120).optional(), documentId: z.string().optional() });
export const conversationPatchSchema = z.object({ title: z.string().trim().min(1).max(120) });

// ---------- notes ----------
export const noteDtoSchema = z.object({ id: z.string(), title: z.string(), body: z.string(), links: z.array(z.string()), updatedAt: z.string() });
export type NoteDto = z.infer<typeof noteDtoSchema>;
export const noteUpsertSchema = z.object({ id: z.string().optional(), title: z.string().trim().min(1).max(160), body: z.string().max(100_000) });

// ---------- review (FSRS) ----------
export const gradeSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
export const cardDtoSchema = z.object({
  id: z.string(),
  deckId: z.string(),
  deckName: z.string(),
  front: z.string(),
  back: z.string(),
  state: z.enum(['new', 'learning', 'review', 'relearning']),
  due: z.string(),
  sourceDocumentId: z.string().nullable(),
});
export type CardDto = z.infer<typeof cardDtoSchema>;
export const deckDtoSchema = z.object({ id: z.string(), name: z.string(), subjectId: z.string().nullable(), newCount: z.number().int(), dueCount: z.number().int() });
export type DeckDto = z.infer<typeof deckDtoSchema>;
export const deckCreateSchema = z.object({ name: z.string().trim().min(1).max(80), subjectId: z.string().optional() });
export const cardCreateSchema = z.object({ deckId: z.string().optional(), front: z.string().trim().min(1).max(2000), back: z.string().trim().min(1).max(4000), count: z.number().int().min(1).max(50).optional() });
export const reviewResultSchema = z.object({ card: cardDtoSchema, remaining: z.number().int() });

// ---------- quiz ----------
export const quizKindSchema = z.enum(['practice', 'mock']);
export const quizDtoSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: quizKindSchema,
  documentId: z.string().nullable(),
  questionCount: z.number().int(),
  bestScore: z.number().nullable(),
  createdAt: z.string(),
});
export type QuizDto = z.infer<typeof quizDtoSchema>;
export const quizQuestionDtoSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  choices: z.array(z.string()),
  answerIndex: z.number().int().nullable(),
  answerText: z.string().nullable(),
  explanation: z.string(),
  citation: chunkDtoSchema.nullable(),
});
export type QuizQuestionDto = z.infer<typeof quizQuestionDtoSchema>;
export const quizGenerateSchema = z.object({
  documentId: z.string(),
  count: z.number().int().min(3).max(30),
  kinds: z.array(z.enum(['mcq', 'short'])).min(1),
  scopeChunkIds: z.array(z.string()).max(50).optional(),
  timeLimitMin: z.number().int().min(5).max(240).optional(),
  examMode: z.enum(['standard', 'competitive', 'case_vignette', 'assertion_reason']).optional(),
});
export const attemptSubmitSchema = z.object({
  answers: z.array(z.object({ questionId: z.string(), choiceIndex: z.number().int().nullable(), text: z.string().optional() })).min(1),
});
export const attemptDtoSchema = z.object({
  id: z.string(),
  quizId: z.string(),
  scorePct: z.number(),
  perQuestion: z.array(z.object({ questionId: z.string(), correct: z.boolean(), expected: z.string() })),
  finishedAt: z.string(),
});
export type AttemptDto = z.infer<typeof attemptDtoSchema>;

// ---------- planner / focus ----------
export const taskDtoSchema = z.object({ id: z.string(), title: z.string(), subjectId: z.string().nullable(), dueDate: z.string().nullable(), estimateMin: z.number().int().nullable(), done: z.boolean() });
export type TaskDto = z.infer<typeof taskDtoSchema>;
export const taskCreateSchema = z.object({ title: z.string().trim().min(1).max(160), subjectId: z.string().optional(), dueDate: z.string().date().optional(), estimateMin: z.number().int().min(5).max(480).optional() });
export const focusSessionDtoSchema = z.object({ id: z.string(), label: z.string(), minutes: z.number().int(), startedAt: z.string(), completed: z.boolean() });
export type FocusSessionDto = z.infer<typeof focusSessionDtoSchema>;

// ---------- concepts ----------
export const conceptDtoSchema = z.object({ id: z.string(), label: z.string(), summary: z.string(), edges: z.array(z.object({ toId: z.string(), toLabel: z.string(), label: z.string() })) });
export type ConceptDto = z.infer<typeof conceptDtoSchema>;
export const conceptCreateSchema = z.object({ label: z.string().trim().min(1).max(80), summary: z.string().max(2000).optional(), subjectId: z.string().optional() });
export const conceptEdgeSchema = z.object({ fromId: z.string(), toId: z.string(), label: z.string().trim().max(80) });

// ---------- stats / misc ----------
export const statsDtoSchema = z.object({
  dueToday: z.number().int(),
  reviewedLast7: z.number().int(),
  focusMinutesLast7: z.number().int(),
  quizAvgPct: z.number().nullable(),
  documents: z.number().int(),
  notes: z.number().int(),
  streakDays: z.number().int(),
  forecast: z.array(z.object({ day: z.string(), due: z.number().int() })),
});
export type StatsDto = z.infer<typeof statsDtoSchema>;

// ---------- API envelope ----------
export const apiErrorSchema = z.object({ error: z.object({ code: z.string(), message: z.string(), requestId: z.string().optional() }) });
