import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { readText, ensureDir } from "../utils/fs.js";
import { isDatabaseLockError } from "../storage/db.js";

export function defaultMemoryRoot(): string {
  return path.join(os.homedir(), ".contextforge", "memory");
}

export function openMemoryDatabase(options: { memoryRoot?: string | null } = {}): any {
  const dataDir = path.resolve(options.memoryRoot ?? defaultMemoryRoot());
  ensureDir(dataDir);
  const dbPath = path.join(dataDir, "contextforge-memory.db");
  const schemaPath = new URL("./schema.sql", import.meta.url);

  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA busy_timeout = 5000");
  try {
    db.exec("PRAGMA journal_mode = WAL");
  } catch (error) {
    if (!isDatabaseLockError(error)) {
      throw error;
    }
  }

  const prepare = db.prepare.bind(db);
  db.prepare = (sql: string) => {
    const statement = prepare(sql);
    statement.setAllowBareNamedParameters?.(true);
    statement.setAllowUnknownNamedParameters?.(true);
    return statement;
  };

  db.exec(readText(schemaPath));
  ensureColumn(db, "memory_profiles", "aaak", "TEXT");
  ensureColumn(db, "memory_profiles", "metadata_json", "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(db, "memory_entries", "scope", "TEXT NOT NULL DEFAULT 'repo'");
  ensureColumn(db, "memory_entries", "repo_id", "TEXT");
  ensureColumn(db, "memory_entries", "session_id", "TEXT");
  ensureColumn(db, "memory_entries", "aaak", "TEXT");
  ensureColumn(db, "memory_entries", "semantic_json", "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(db, "memory_entries", "embedding_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "memory_entries", "tags_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "memory_entries", "importance", "REAL NOT NULL DEFAULT 0.5");
  ensureColumn(db, "memory_entries", "source_type", "TEXT NOT NULL DEFAULT 'manual'");
  ensureColumn(db, "memory_entries", "source_ref", "TEXT");
  ensureColumn(db, "memory_diaries", "aaak", "TEXT");
  ensureColumn(db, "memory_diaries", "semantic_json", "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(db, "memory_diaries", "embedding_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "memory_diaries", "tags_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "memory_triples", "repo_id", "TEXT");
  ensureColumn(db, "memory_triples", "session_id", "TEXT");
  ensureColumn(db, "memory_triples", "source_entry_id", "TEXT");
  ensureColumn(db, "memory_triples", "source_kind", "TEXT NOT NULL DEFAULT 'manual'");
  ensureColumn(db, "memory_triples", "metadata_json", "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(db, "memory_triples", "embedding_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "memory_checkpoints", "last_event_at", "INTEGER");
  return db;
}

function ensureColumn(db: any, tableName: string, columnName: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all().map((column: any) => column.name);
  if (!columns.includes(columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}
