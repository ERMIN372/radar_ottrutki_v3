import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const DB_PATH = process.env.RADAR_DB_PATH ?? path.join(process.cwd(), 'data', 'radar.db');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

export function dbPath(): string {
  return DB_PATH;
}

/**
 * Схема MVP на SQLite. Миграция на Postgres — TODO (см. README):
 * весь доступ идёт через этот модуль, менять придётся только его.
 */
function migrate(d: Database.Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS shops (
      code   TEXT PRIMARY KEY,
      name   TEXT NOT NULL,
      -- В легаси-книге колонка называется «Регион», но хранит фамилию РМ —
      -- в интерфейсе это поле подписано «РМ».
      region TEXT
    );

    -- Одна строка = одна отметка сотрудника в лавке за день.
    CREATE TABLE IF NOT EXISTS attendance (
      date            TEXT NOT NULL,
      shop_code       TEXT NOT NULL,
      employee_name   TEXT NOT NULL,
      role            TEXT NOT NULL,
      criterion       TEXT,
      trainee         INTEGER NOT NULL DEFAULT 0,
      home_shop_code  TEXT,
      arrival_minutes INTEGER,
      arrival_source  TEXT NOT NULL,
      raw_arrival     TEXT,
      raw_departure   TEXT,
      status          TEXT NOT NULL,
      note            TEXT,
      PRIMARY KEY (date, shop_code, employee_name, role)
    );
    CREATE INDEX IF NOT EXISTS attendance_by_date ON attendance(date);
    CREATE INDEX IF NOT EXISTS attendance_by_shop ON attendance(shop_code, date);

    -- Наполнение витрины из Google-таблицы (или из легаси-книги при сиде).
    CREATE TABLE IF NOT EXISTS showcase_fill (
      date      TEXT NOT NULL,
      shop_code TEXT NOT NULL,
      fill      REAL NOT NULL,
      status    TEXT NOT NULL,
      PRIMARY KEY (date, shop_code)
    );

    -- Свёрнутый статус критерия у лавки за день — то, что рисует радар.
    CREATE TABLE IF NOT EXISTS criterion_status (
      date      TEXT NOT NULL,
      shop_code TEXT NOT NULL,
      criterion TEXT NOT NULL,
      status    TEXT NOT NULL,
      origin    TEXT NOT NULL,
      PRIMARY KEY (date, shop_code, criterion)
    );
    CREATE INDEX IF NOT EXISTS criterion_by_date ON criterion_status(date);

    -- Легаси-статусы людей из Витрины.xlsx: нужны для drill-down по 19–24.08,
    -- где сырых выгрузок у нас нет.
    CREATE TABLE IF NOT EXISTS legacy_person_status (
      date          TEXT NOT NULL,
      shop_code     TEXT NOT NULL,
      criterion     TEXT NOT NULL,
      employee_name TEXT NOT NULL,
      status        TEXT NOT NULL,
      PRIMARY KEY (date, shop_code, criterion, employee_name)
    );

    -- Журнал запусков ETL: видно, когда последний раз обновлялись данные.
    CREATE TABLE IF NOT EXISTS import_runs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      job         TEXT NOT NULL,
      source      TEXT NOT NULL,
      started_at  TEXT NOT NULL,
      finished_at TEXT,
      status      TEXT NOT NULL,
      rows        INTEGER NOT NULL DEFAULT 0,
      warnings    TEXT,
      error       TEXT
    );
    CREATE INDEX IF NOT EXISTS import_runs_by_job ON import_runs(job, started_at DESC);
  `);
}

export interface ImportRunHandle {
  id: number;
  finish(status: 'ok' | 'error', rows: number, warnings?: string[], error?: string): void;
}

export function startImportRun(job: string, source: string): ImportRunHandle {
  const d = getDb();
  const info = d
    .prepare(
      `INSERT INTO import_runs (job, source, started_at, status) VALUES (?, ?, ?, 'running')`,
    )
    .run(job, source, new Date().toISOString());
  const id = Number(info.lastInsertRowid);

  return {
    id,
    finish(status, rows, warnings, error) {
      d.prepare(
        `UPDATE import_runs SET finished_at = ?, status = ?, rows = ?, warnings = ?, error = ?
         WHERE id = ?`,
      ).run(
        new Date().toISOString(),
        status,
        rows,
        warnings?.length ? JSON.stringify(warnings.slice(0, 200)) : null,
        error ?? null,
        id,
      );
    },
  };
}

export function lastRun(job: string): {
  job: string;
  source: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  rows: number;
  warnings: string | null;
  error: string | null;
} | null {
  return (
    (getDb()
      .prepare(
        `SELECT job, source, started_at, finished_at, status, rows, warnings, error
         FROM import_runs WHERE job = ? ORDER BY started_at DESC LIMIT 1`,
      )
      .get(job) as never) ?? null
  );
}
