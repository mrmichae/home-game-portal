import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type PortalDatabase = DatabaseSync;

export function openDatabase(dataDir: string, migrationsDir: string): PortalDatabase {
  fs.mkdirSync(dataDir, { recursive: true });
  const database = new DatabaseSync(path.join(dataDir, "home-game-portal.sqlite"));
  database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  runMigrations(database, migrationsDir);
  return database;
}

export function openMemoryDatabase(migrationsDir: string): PortalDatabase {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON;");
  runMigrations(database, migrationsDir);
  return database;
}

function runMigrations(database: PortalDatabase, migrationsDir: string): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedStatement = database.prepare(
    "SELECT 1 FROM schema_migrations WHERE filename = ?",
  );
  const recordStatement = database.prepare(
    "INSERT INTO schema_migrations(filename, applied_at) VALUES (?, ?)",
  );

  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const filename of files) {
    if (appliedStatement.get(filename)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, filename), "utf8");
    const migrateWithForeignKeysOff = sql.startsWith("-- migrate-with-foreign-keys-off");
    if (migrateWithForeignKeysOff) database.exec("PRAGMA foreign_keys = OFF;");
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(sql);
      if (migrateWithForeignKeysOff) {
        const violations = database.prepare("PRAGMA foreign_key_check").all();
        if (violations.length) throw new Error(`Migration ${filename} left invalid foreign-key references.`);
      }
      recordStatement.run(filename, new Date().toISOString());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    } finally {
      if (migrateWithForeignKeysOff) database.exec("PRAGMA foreign_keys = ON;");
    }
  }
}
