PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS repositories (
  repo_id TEXT PRIMARY KEY,
  root_path TEXT NOT NULL,
  default_branch TEXT,
  content_fingerprint TEXT,
  quick_repo_stamp TEXT,
  file_count INTEGER,
  indexed_file_count INTEGER NOT NULL DEFAULT 0,
  index_status TEXT NOT NULL DEFAULT 'idle',
  pending_derived_state INTEGER NOT NULL DEFAULT 0,
  last_index_error TEXT,
  batch_size INTEGER,
  indexed_text_file_count INTEGER NOT NULL DEFAULT 0,
  indexed_binary_file_count INTEGER NOT NULL DEFAULT 0,
  indexed_line_count INTEGER NOT NULL DEFAULT 0,
  indexed_byte_count INTEGER NOT NULL DEFAULT 0,
  indexed_at INTEGER,
  last_index_started_at INTEGER,
  last_index_completed_at INTEGER,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS files (
  file_id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  content TEXT,
  content_kind TEXT NOT NULL DEFAULT 'text',
  content_loaded INTEGER NOT NULL DEFAULT 0,
  byte_count INTEGER NOT NULL DEFAULT 0,
  line_count INTEGER NOT NULL DEFAULT 0,
  language TEXT,
  parse_status TEXT NOT NULL DEFAULT 'unparsed',
  parse_error TEXT,
  updated_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS symbols (
  symbol_id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  language TEXT,
  span_start INTEGER NOT NULL,
  span_end INTEGER NOT NULL,
  parent_symbol_id TEXT,
  symbol_hash TEXT NOT NULL,
  body TEXT
);

CREATE TABLE IF NOT EXISTS symbol_edges (
  edge_id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  from_symbol_id TEXT NOT NULL,
  to_symbol_id TEXT NOT NULL,
  edge_type TEXT NOT NULL,
  confidence REAL NOT NULL,
  provenance_source TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chunks (
  chunk_id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  chunk_type TEXT NOT NULL,
  label TEXT NOT NULL,
  text TEXT NOT NULL,
  summary TEXT,
  span_start INTEGER NOT NULL,
  span_end INTEGER NOT NULL,
  chunk_hash TEXT NOT NULL,
  invalidation_state TEXT NOT NULL DEFAULT 'fresh'
);

CREATE TABLE IF NOT EXISTS vectors (
  vector_id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  item_type TEXT NOT NULL,
  item_id TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  embedding_dim INTEGER NOT NULL,
  embedding_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS raptor_nodes (
  node_id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  parent_node_id TEXT,
  node_type TEXT NOT NULL,
  label TEXT NOT NULL,
  summary TEXT,
  token_budget INTEGER NOT NULL DEFAULT 256,
  source_item_type TEXT NOT NULL,
  source_item_id TEXT NOT NULL,
  cache_state TEXT NOT NULL DEFAULT 'cold'
);

CREATE TABLE IF NOT EXISTS session_events (
  event_id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS session_edges (
  edge_id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  from_event_id TEXT NOT NULL,
  to_event_id TEXT NOT NULL,
  edge_type TEXT NOT NULL,
  confidence REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS pages (
  page_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  page_type TEXT NOT NULL,
  source_item_type TEXT NOT NULL,
  source_item_id TEXT NOT NULL,
  size_estimate INTEGER NOT NULL,
  pin_state TEXT NOT NULL DEFAULT 'none',
  fault_count INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER DEFAULT (unixepoch()),
  eviction_score REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS compression_events (
  event_id TEXT PRIMARY KEY,
  repo_id TEXT,
  session_id TEXT,
  route_class TEXT NOT NULL,
  content_type TEXT NOT NULL,
  compressor TEXT NOT NULL,
  raw_size INTEGER NOT NULL,
  compressed_size INTEGER NOT NULL,
  invariant_status TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(
  chunk_id UNINDEXED,
  label,
  text
);
