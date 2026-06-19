import Database from "better-sqlite3";

/** Returns an open DB connection with schema applied, WAL mode and foreign keys enabled. */
export function openDb(filePath: string = "./data/split.db"): Database.Database {
  const db = new Database(filePath);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS "group" (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      name  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS member (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id  INTEGER NOT NULL REFERENCES "group"(id),
      name      TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS expense (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id         INTEGER NOT NULL REFERENCES "group"(id),
      payer_member_id  INTEGER NOT NULL REFERENCES member(id),
      amount_cents     INTEGER NOT NULL,
      split_type       TEXT NOT NULL CHECK(split_type IN ('equal', 'exact')),
      description      TEXT
    );

    CREATE TABLE IF NOT EXISTS expense_split (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      expense_id   INTEGER NOT NULL REFERENCES expense(id),
      member_id    INTEGER NOT NULL REFERENCES member(id),
      amount_cents INTEGER NOT NULL
    );
  `);

  return db;
}
