import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readText, ensureDir } from "../utils/fs.js";

export function openDatabase(rootDir) {
  const dataDir = path.join(rootDir, ".contextforge");
  ensureDir(dataDir);
  const dbPath = path.join(dataDir, "contextforge.db");
  const schemaPath = new URL("./schema.sql", import.meta.url);

  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  const prepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    const statement = prepare(sql);
    statement.setAllowBareNamedParameters?.(true);
    statement.setAllowUnknownNamedParameters?.(true);
    return statement;
  };
  db.exec(readText(schemaPath));
  ensureColumn(db, "repositories", "content_fingerprint", "TEXT");
  ensureColumn(db, "repositories", "file_count", "INTEGER");
  ensureColumn(db, "repositories", "indexed_at", "INTEGER");
  ensureColumn(db, "compression_events", "repo_id", "TEXT");
  ensureColumn(db, "compression_events", "session_id", "TEXT");
  return db;
}

function ensureColumn(db, tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name);
  if (!columns.includes(columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}
