import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readText, ensureDir } from "../utils/fs.js";

export function openDatabase(rootDir) {
  const dataDir = path.join(rootDir, ".contextforge");
  ensureDir(dataDir);
  const dbPath = path.join(dataDir, "contextforge.db");
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
  db.prepare = (sql) => {
    const statement = prepare(sql);
    statement.setAllowBareNamedParameters?.(true);
    statement.setAllowUnknownNamedParameters?.(true);
    return statement;
  };
  db.exec(readText(schemaPath));
  ensureColumn(db, "repositories", "content_fingerprint", "TEXT");
  ensureColumn(db, "repositories", "quick_repo_stamp", "TEXT");
  ensureColumn(db, "repositories", "file_count", "INTEGER");
  ensureColumn(db, "repositories", "indexed_file_count", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "repositories", "index_status", "TEXT NOT NULL DEFAULT 'idle'");
  ensureColumn(db, "repositories", "pending_derived_state", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "repositories", "last_index_error", "TEXT");
  ensureColumn(db, "repositories", "batch_size", "INTEGER");
  ensureColumn(db, "repositories", "indexed_text_file_count", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "repositories", "indexed_binary_file_count", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "repositories", "indexed_line_count", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "repositories", "indexed_byte_count", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "repositories", "indexed_at", "INTEGER");
  ensureColumn(db, "repositories", "last_index_started_at", "INTEGER");
  ensureColumn(db, "repositories", "last_index_completed_at", "INTEGER");
  ensureColumn(db, "files", "content", "TEXT");
  ensureColumn(db, "files", "content_kind", "TEXT NOT NULL DEFAULT 'text'");
  ensureColumn(db, "files", "content_loaded", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "files", "byte_count", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "files", "line_count", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "compression_events", "repo_id", "TEXT");
  ensureColumn(db, "compression_events", "session_id", "TEXT");
  return db;
}

function isDatabaseLockError(error) {
  return error?.errcode === 5 ||
    error?.errcode === 261 ||
    (error?.code === "ERR_SQLITE_ERROR" && /database is locked/i.test(String(error?.message ?? "")));
}

function ensureColumn(db, tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name);
  if (!columns.includes(columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}
