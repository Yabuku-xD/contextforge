PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS memory_profiles (
  profile_id TEXT PRIMARY KEY,
  profile_type TEXT NOT NULL,
  name TEXT NOT NULL,
  summary TEXT NOT NULL,
  aaak TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS memory_entries (
  entry_id TEXT PRIMARY KEY,
  scope TEXT NOT NULL DEFAULT 'repo',
  repo_id TEXT,
  session_id TEXT,
  wing TEXT NOT NULL,
  hall TEXT NOT NULL,
  room TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  detail TEXT NOT NULL,
  aaak TEXT,
  semantic_json TEXT NOT NULL DEFAULT '{}',
  embedding_json TEXT NOT NULL DEFAULT '[]',
  tags_json TEXT NOT NULL DEFAULT '[]',
  importance REAL NOT NULL DEFAULT 0.5,
  source_type TEXT NOT NULL DEFAULT 'manual',
  source_ref TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_memory_entries_repo ON memory_entries(repo_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_entries_scope ON memory_entries(scope, wing, hall, room);

CREATE TABLE IF NOT EXISTS memory_entities (
  entity_id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT 'unknown',
  aliases_json TEXT NOT NULL DEFAULT '[]',
  properties_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_entities_canonical ON memory_entities(canonical_name);

CREATE TABLE IF NOT EXISTS memory_entry_entities (
  link_id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'mentioned',
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_memory_entry_entities_entry ON memory_entry_entities(entry_id);
CREATE INDEX IF NOT EXISTS idx_memory_entry_entities_entity ON memory_entry_entities(entity_id);

CREATE TABLE IF NOT EXISTS memory_triples (
  triple_id TEXT PRIMARY KEY,
  subject_entity_id TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object_entity_id TEXT NOT NULL,
  repo_id TEXT,
  session_id TEXT,
  source_entry_id TEXT,
  source_kind TEXT NOT NULL DEFAULT 'manual',
  valid_from TEXT,
  valid_to TEXT,
  confidence REAL NOT NULL DEFAULT 1.0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  embedding_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_memory_triples_subject ON memory_triples(subject_entity_id);
CREATE INDEX IF NOT EXISTS idx_memory_triples_object ON memory_triples(object_entity_id);
CREATE INDEX IF NOT EXISTS idx_memory_triples_validity ON memory_triples(valid_from, valid_to);

CREATE TABLE IF NOT EXISTS memory_diaries (
  diary_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  repo_id TEXT,
  session_id TEXT,
  title TEXT NOT NULL,
  entry_text TEXT NOT NULL,
  aaak TEXT,
  semantic_json TEXT NOT NULL DEFAULT '{}',
  embedding_json TEXT NOT NULL DEFAULT '[]',
  tags_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_memory_diaries_agent ON memory_diaries(agent_id, created_at DESC);

CREATE TABLE IF NOT EXISTS memory_checkpoints (
  checkpoint_id TEXT PRIMARY KEY,
  repo_id TEXT,
  session_id TEXT,
  kind TEXT NOT NULL DEFAULT 'autosave',
  last_event_id TEXT,
  last_event_at INTEGER,
  entry_id TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_memory_checkpoints_session ON memory_checkpoints(repo_id, session_id, kind, created_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_entry_fts USING fts5(
  entry_id UNINDEXED,
  title,
  summary,
  detail,
  aaak,
  tags
);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_diary_fts USING fts5(
  diary_id UNINDEXED,
  title,
  entry_text,
  aaak,
  tags
);
