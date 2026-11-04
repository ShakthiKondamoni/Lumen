// Append-only migration list. Never edit an applied migration — add a new one.
// The runner records a sha256 checksum per migration and refuses to start if
// an applied migration's SQL changes.

export interface Migration {
  id: string;
  sql: string;
}

const identity = `
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  event TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);
`;

const settings = `
CREATE TABLE user_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme TEXT NOT NULL DEFAULT 'paper',
  density TEXT NOT NULL DEFAULT 'comfortable',
  reduced_motion INTEGER NOT NULL DEFAULT 0,
  desired_retention REAL NOT NULL DEFAULT 0.9
);
`;

const providers = `
CREATE TABLE providers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  base_url TEXT NOT NULL,
  key_ct TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_providers_user ON providers(user_id);
CREATE TABLE model_routes (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task TEXT NOT NULL,
  steps_json TEXT NOT NULL,
  PRIMARY KEY (user_id, task)
);
`;

const library = `
CREATE TABLE subjects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#4A7C59',
  created_at TEXT NOT NULL,
  UNIQUE (user_id, name)
);
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id TEXT REFERENCES subjects(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  checksum TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  page_count INTEGER,
  status TEXT NOT NULL DEFAULT 'processing',
  needs_ocr INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_documents_user ON documents(user_id);
CREATE INDEX idx_documents_subject ON documents(subject_id);
`;

const intelligence = `
CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_start INTEGER NOT NULL,
  page_end INTEGER NOT NULL,
  heading_path TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  embedding BLOB,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_chunks_doc ON chunks(document_id);
CREATE INDEX idx_chunks_user ON chunks(user_id);
CREATE VIRTUAL TABLE chunks_fts USING fts5(content, content='chunks', content_rowid='rowid');
CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
END;
CREATE TRIGGER chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
  INSERT INTO chunks_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued',
  progress REAL NOT NULL DEFAULT 0,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_jobs_user ON jobs(user_id, created_at);
`;

const conversations = `
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'New conversation',
  document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_conversations_user ON conversations(user_id, updated_at);
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  citations TEXT NOT NULL DEFAULT '[]',
  model TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_messages_conv ON messages(conversation_id, created_at);
`;

const notes = `
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_notes_user ON notes(user_id, updated_at);
CREATE VIRTUAL TABLE notes_fts USING fts5(title, body, content='notes', content_rowid='rowid');
CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;
CREATE TRIGGER notes_ad AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, body) VALUES ('delete', old.rowid, old.title, old.body);
END;
CREATE TRIGGER notes_au AFTER UPDATE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, body) VALUES ('delete', old.rowid, old.title, old.body);
  INSERT INTO notes_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;
CREATE TABLE note_links (
  src_note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  dst_note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  PRIMARY KEY (src_note_id, dst_note_id)
);
`;

const review = `
CREATE TABLE decks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  subject_id TEXT REFERENCES subjects(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, name)
);
CREATE TABLE cards (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  source_document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  state TEXT NOT NULL DEFAULT 'new',
  stability REAL NOT NULL DEFAULT 0,
  difficulty REAL NOT NULL DEFAULT 0,
  due TEXT NOT NULL,
  last_review TEXT,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  suspended INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_cards_deck ON cards(deck_id);
CREATE INDEX idx_cards_due ON cards(user_id, due);
CREATE TABLE review_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  grade INTEGER NOT NULL,
  reviewed_at TEXT NOT NULL
);
CREATE INDEX idx_review_log_user ON review_log(user_id, reviewed_at);
`;

const quiz = `
CREATE TABLE quizzes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'practice',
  document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  time_limit_min INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_quizzes_user ON quizzes(user_id, created_at);
CREATE TABLE quiz_questions (
  id TEXT PRIMARY KEY,
  quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  choices TEXT NOT NULL DEFAULT '[]',
  answer_index INTEGER,
  answer_text TEXT,
  explanation TEXT NOT NULL DEFAULT '',
  chunk_id TEXT REFERENCES chunks(id) ON DELETE SET NULL
);
CREATE INDEX idx_quiz_questions_quiz ON quiz_questions(quiz_id, ordinal);
CREATE TABLE quiz_attempts (
  id TEXT PRIMARY KEY,
  quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score_pct REAL NOT NULL,
  detail TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL
);
CREATE INDEX idx_attempts_quiz ON quiz_attempts(quiz_id, finished_at);
`;

const plan = `
CREATE TABLE plan_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id TEXT REFERENCES subjects(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  due_date TEXT,
  estimate_min INTEGER,
  done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_tasks_user ON plan_tasks(user_id, done);
CREATE TABLE focus_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  minutes INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_focus_user ON focus_sessions(user_id, started_at);
`;

const concepts = `
CREATE TABLE concepts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id TEXT REFERENCES subjects(id) ON DELETE SET NULL,
  label TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_concepts_user ON concepts(user_id);
CREATE TABLE concept_edges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  to_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT 'relates to'
);
`;

export const sticky = `
CREATE TABLE sticky_notes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id TEXT REFERENCES subjects(id) ON DELETE SET NULL,
  document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  page_number INTEGER,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_sticky_user ON sticky_notes(user_id, updated_at);
CREATE INDEX idx_sticky_doc ON sticky_notes(document_id);
`;

export const MIGRATIONS: Migration[] = [
  { id: '001_identity',      sql: identity },
  { id: '002_settings',      sql: settings },
  { id: '003_providers',     sql: providers },
  { id: '004_library',       sql: library },
  { id: '005_intelligence',  sql: intelligence },
  { id: '006_conversations', sql: conversations },
  { id: '007_notes',         sql: notes },
  { id: '008_review',        sql: review },
  { id: '009_quiz',          sql: quiz },
  { id: '010_plan',          sql: plan },
  { id: '011_concepts',      sql: concepts },
  { id: '012_sticky_notes',  sql: sticky },   // <-- newly added
];
  
