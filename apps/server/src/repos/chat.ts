import { randomUUID } from 'node:crypto';
import type { Db } from '../db/db.ts';
import type { ChunkDto } from '@lumen/shared';

export interface ConversationRow {
  id: string;
  user_id: string;
  kind: 'chat' | 'tutor';
  title: string;
  document_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  citations: string;
  model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  created_at: string;
}

export class ChatRepo {
  constructor(private readonly db: Db) {}

  create(userId: string, kind: 'chat' | 'tutor', title: string, documentId: string | null): ConversationRow {
    const now = new Date().toISOString();
    const row: ConversationRow = {
      id: randomUUID(),
      user_id: userId,
      kind,
      title,
      document_id: documentId,
      created_at: now,
      updated_at: now,
    };
    this.db.run(
      'INSERT INTO conversations (id, user_id, kind, title, document_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      row.id,
      userId,
      kind,
      title,
      documentId,
      now,
      now,
    );
    return row;
  }

  conversation(userId: string, id: string): ConversationRow | undefined {
    return this.db.get<ConversationRow>('SELECT * FROM conversations WHERE user_id = ? AND id = ?', userId, id);
  }

  list(userId: string, kind?: 'chat' | 'tutor'): ConversationRow[] {
    if (kind) {
      return this.db.all<ConversationRow>(
        'SELECT * FROM conversations WHERE user_id = ? AND kind = ? ORDER BY updated_at DESC',
        userId,
        kind,
      );
    }
    return this.db.all<ConversationRow>(
      'SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC',
      userId,
    );
  }

  rename(userId: string, id: string, title: string): void {
    this.db.run(
      'UPDATE conversations SET title = ?, updated_at = ? WHERE user_id = ? AND id = ?',
      title,
      new Date().toISOString(),
      userId,
      id,
    );
  }

  delete(userId: string, id: string): void {
    this.db.run('DELETE FROM conversations WHERE user_id = ? AND id = ?', userId, id);
  }

  touch(conversationId: string): void {
    this.db.run('UPDATE conversations SET updated_at = ? WHERE id = ?', new Date().toISOString(), conversationId);
  }

  append(
    conversationId: string,
    role: 'user' | 'assistant',
    content: string,
    citations: ChunkDto[],
    model: string | null,
    tokensIn?: number,
    tokensOut?: number,
  ): MessageRow {
    const row: MessageRow = {
      id: randomUUID(),
      conversation_id: conversationId,
      role,
      content,
      citations: JSON.stringify(citations),
      model,
      tokens_in: tokensIn ?? null,
      tokens_out: tokensOut ?? null,
      created_at: new Date().toISOString(),
    };
    this.db.run(
      'INSERT INTO messages (id, conversation_id, role, content, citations, model, tokens_in, tokens_out, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      row.id,
      conversationId,
      role,
      content,
      row.citations,
      model,
      row.tokens_in,
      row.tokens_out,
      row.created_at,
    );
    this.touch(conversationId);
    return row;
  }

  messages(conversationId: string, limit = 400): MessageRow[] {
    return this.db.all<MessageRow>(
      'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at, rowid LIMIT ?',
      conversationId,
      limit,
    );
  }

  recentMessages(conversationId: string, count: number): MessageRow[] {
    const rows = this.db.all<MessageRow>(
      'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?',
      conversationId,
      count,
    );
    return rows.reverse();
  }
}

export function messageDto(row: MessageRow) {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    citations: JSON.parse(row.citations) as ChunkDto[],
    model: row.model,
    createdAt: row.created_at,
  };
}
