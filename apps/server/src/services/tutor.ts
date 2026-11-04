import type { RouteTask } from '@lumen/shared';
import type { Config } from '../config.ts';
import type { Db } from '../db/db.ts';
import { errors } from '../core.ts';
import { LibraryRepo, type DocumentRow } from '../repos/library.ts';
import { ProviderRepo, type ProviderRow } from '../repos/providers.ts';
import { decryptSecret } from '../security.ts';
import type { ResolvedStep } from './ai.ts';

/**
 * Resolves a task's route (ordered provider+model steps) into concrete,
 * key-decrypted steps ready to call. Throws NO_PROVIDER when the user has
 * configured nothing for the task — the route API requires explicit setup.
 */
export class AiResolver {
  constructor(
    private readonly db: Db,
    private readonly masterKey: Buffer,
    private readonly config: Config,
  ) {}

  resolve(userId: string, task: RouteTask): ResolvedStep[] {
    const providers = new ProviderRepo(this.db);
    const route = providers.getRoute(userId, task);
    const byId = new Map(providers.list(userId).map((p) => [p.id, p]));
    const steps: ResolvedStep[] = [];
    for (const step of route) {
      const row: ProviderRow | undefined = byId.get(step.providerId);
      if (!row || row.enabled !== 1) continue;
      const apiKey = row.key_ct ? decryptSecret(row.key_ct, this.masterKey) : null;
      if (row.key_ct && apiKey === null) continue; // undecryptable — skip silently, next step
      steps.push({
        providerId: row.id,
        label: row.label,
        kind: row.kind,
        baseUrl: row.base_url,
        apiKey,
        model: step.model,
      });
    }
    if (steps.length === 0) {
      throw errors.noProvider(
        `No enabled provider/model is routed for "${task}". Configure one in Settings → AI providers.`,
      );
    }
    return steps;
  }

  /** Resolves one provider directly (used by the connection tester). */
  resolveSingle(userId: string, providerId: string): ResolvedStep {
    const providers = new ProviderRepo(this.db);
    const row = providers.get(userId, providerId);
    if (!row) throw errors.notFound('Provider not found');
    const apiKey = row.key_ct ? decryptSecret(row.key_ct, this.masterKey) : null;
    return {
      providerId: row.id,
      label: row.label,
      kind: row.kind,
      baseUrl: row.base_url,
      apiKey,
      model: '',
    };
  }

  retention(): number {
    void this.config;
    return 0.9;
  }
}

export function documentScopedFilter(document: DocumentRow | null): string | null {
  return document ? document.id : null;
}

export function buildTutorSystemPrompt(chunks: { documentTitle: string; pageStart: number; pageEnd: number; content: string }[], document: DocumentRow | null): string {
  const scope = document ? `The learner is reading "${document.title}".` : 'The learner has a personal document library.';
  const context = chunks
    .map((c, i) => `[${i + 1}] ${c.documentTitle}, pages ${c.pageStart}-${c.pageEnd}\n${c.content}`)
    .join('\n\n---\n\n');
  return [
    'You are Lumen, a patient study tutor.',
    scope,
    'Answer using the provided source excerpts when they are relevant, and cite them inline like [1].',
    'If the excerpts do not contain the answer, say so plainly and answer from general knowledge, marking that part as not from their library.',
    'Prefer short paragraphs, concrete examples, and one check-question at the end to test understanding.',
    '',
    'SOURCE EXCERPTS:',
    context || '(no excerpts found)',
  ].join('\n');
}

export async function retrieveContext(db: Db, userId: string, document: DocumentRow | null, query: string, limit = 8) {
  const { hybridSearch, toChunkDto } = await import('./intel.ts');
  const library = new LibraryRepo(db);
  const keyword = library.keywordSearch(userId, ftsQuery(query), limit, document?.id);
  const embedded = library.allEmbeddedChunks(userId).filter((c) => !document || c.document_id === document.id);
  const fused = hybridSearch(query, keyword, embedded, limit);
  return fused.map((row) => ({
    dto: toChunkDto(row, row.document_id === document?.id ? document.title : (library.document(userId, row.document_id)?.title ?? 'Document'), row.fused),
  }));
}

/** FTS5 query: quote words, AND them; tolerates punctuation-only input. */
export function ftsQuery(input: string): string {
  const words = input.toLowerCase().match(/[a-z0-9']{2,}/g) ?? [];
  if (words.length === 0) return '""';
  return words.map((w) => `"${w}"`).join(' AND ');
}
