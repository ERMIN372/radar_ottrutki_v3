import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config';
import type {
  AttendanceRow,
  CriterionStatusRow,
  Shop,
  ShowcaseRow,
} from './types';
import type { LegacyPersonStatus } from './parsers/legacy-vitriny';
import bundledSnapshot from '../generated/snapshot.json';

/**
 * Снимок всех данных дашборда в памяти.
 *
 * Зачем он есть: на Vercel (и любом serverless-хостинге) файловая система
 * только для чтения, а нативный `better-sqlite3` не собирается — свежий npm
 * блокирует install-скрипты, поэтому `prebuild-install` не отрабатывает.
 * SQLite там не запустится ни при каких настройках.
 *
 * Поэтому чтение дашборда идёт не из БД напрямую, а из снимка, который
 * собирается одним из двух способов:
 *   · из SQLite — локально и на VPS, где работает ETL с записью;
 *   · из `src/generated/snapshot.json` — на Vercel, файл печётся при сборке.
 *
 * Данных мало (тысячи строк), поэтому снимок целиком живёт в памяти процесса.
 */
export interface Snapshot {
  generatedAt: string;
  source: 'sqlite' | 'json';
  /** Отпечаток конфига порогов, на котором посчитан снимок (см. configFingerprint). */
  configFingerprint: string;
  shops: Shop[];
  attendance: AttendanceRow[];
  showcase: ShowcaseRow[];
  criteria: CriterionStatusRow[];
  legacyPeople: LegacyPersonStatus[];
  runs: ImportRunSummary[];
}

export interface ImportRunSummary {
  job: string;
  source: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  rows: number;
}

export type StorageMode = 'sqlite' | 'snapshot';

/**
 * Короткий отпечаток действующих порогов. Снимок считается на конкретном
 * конфиге; если конфиг потом правили, а снимок не пересобирали, цифры на
 * дашборде уже не соответствуют порогам — это видно на странице «Пороги».
 */
export function configFingerprint(): string {
  const c = loadConfig();
  return crypto
    .createHash('sha1')
    .update(JSON.stringify({ criteria: c.criteria, rules: c.rules, roleMap: c.roleMap }))
    .digest('hex')
    .slice(0, 12);
}

/** Совпадает ли снимок с текущими порогами. */
export async function isSnapshotStale(): Promise<boolean> {
  const s = await loadSnapshot();
  return s.source === 'json' && s.configFingerprint !== configFingerprint();
}

const GENERATED_PATH =
  process.env.RADAR_SNAPSHOT_PATH ??
  path.join(process.cwd(), 'src', 'generated', 'snapshot.json');

let cached: Snapshot | null = null;

/**
 * Что используем как источник:
 *   RADAR_STORAGE=sqlite|snapshot — явное указание;
 *   иначе на Vercel всегда снимок;
 *   иначе SQLite, если файл БД существует (после `npm run seed`);
 *   иначе снимок — чтобы дашборд работал сразу после клона репозитория.
 */
export function storageMode(): StorageMode {
  const explicit = process.env.RADAR_STORAGE;
  if (explicit === 'sqlite' || explicit === 'snapshot') return explicit;
  if (process.env.VERCEL) return 'snapshot';

  const dbFile =
    process.env.RADAR_DB_PATH ?? path.join(process.cwd(), 'data', 'radar.db');
  return fs.existsSync(/* turbopackIgnore: true */ dbFile) ? 'sqlite' : 'snapshot';
}

/** Доступна ли запись: ETL и кнопка «Обновить» работают только поверх SQLite. */
export function isWritable(): boolean {
  return storageMode() === 'sqlite';
}

export async function loadSnapshot(): Promise<Snapshot> {
  if (cached) return cached;

  cached =
    storageMode() === 'sqlite' ? await readFromSqlite() : readFromJson();
  return cached;
}

/** Сбрасывает кеш после записи в БД, чтобы UI увидел свежие данные. */
export function invalidateSnapshot(): void {
  cached = null;
}

/**
 * Снимок вкомпилирован в сборку и параллельно лежит на диске. Импорт гарантирует,
 * что данные доедут до serverless-функции; чтение с диска даёт возможность
 * подложить свежий снимок без пересборки.
 */
function readFromJson(): Snapshot {
  try {
    const raw = JSON.parse(
      fs.readFileSync(/* turbopackIgnore: true */ GENERATED_PATH, 'utf8'),
    ) as Snapshot;
    return { ...raw, source: 'json' };
  } catch {
    return { ...(bundledSnapshot as unknown as Snapshot), source: 'json' };
  }
}

/**
 * `better-sqlite3` импортируется только здесь и только динамически —
 * на Vercel этот код не выполняется, поэтому нативный модуль не грузится.
 */
async function readFromSqlite(): Promise<Snapshot> {
  const { getDb } = await import('./db');
  const d = getDb();

  const shops = d
    .prepare(`SELECT code, name, region FROM shops`)
    .all() as Shop[];

  const attendance = (
    d
      .prepare(
        `SELECT date, shop_code, employee_name, role, criterion, trainee,
                home_shop_code, arrival_minutes, arrival_source, raw_arrival,
                raw_departure, status, note
         FROM attendance`,
      )
      .all() as Record<string, unknown>[]
  ).map(
    (r): AttendanceRow => ({
      date: r.date as string,
      shopCode: r.shop_code as string,
      shopName: '',
      employeeName: r.employee_name as string,
      role: r.role as string,
      criterion: r.criterion as AttendanceRow['criterion'],
      trainee: r.trainee === 1,
      homeShopCode: r.home_shop_code as string | null,
      arrivalMinutes: r.arrival_minutes as number | null,
      arrivalSource: r.arrival_source as AttendanceRow['arrivalSource'],
      rawArrival: r.raw_arrival as string | null,
      rawDeparture: r.raw_departure as string | null,
      status: r.status as AttendanceRow['status'],
      note: r.note as string | null,
    }),
  );

  const showcase = (
    d
      .prepare(`SELECT date, shop_code, fill, status FROM showcase_fill`)
      .all() as Record<string, unknown>[]
  ).map(
    (r): ShowcaseRow => ({
      date: r.date as string,
      shopCode: r.shop_code as string,
      fill: r.fill as number,
      status: r.status as ShowcaseRow['status'],
    }),
  );

  const criteria = (
    d
      .prepare(`SELECT date, shop_code, criterion, status, origin FROM criterion_status`)
      .all() as Record<string, unknown>[]
  ).map(
    (r): CriterionStatusRow => ({
      date: r.date as string,
      shopCode: r.shop_code as string,
      criterion: r.criterion as CriterionStatusRow['criterion'],
      status: r.status as CriterionStatusRow['status'],
      origin: r.origin as CriterionStatusRow['origin'],
    }),
  );

  const legacyPeople = (
    d
      .prepare(
        `SELECT date, shop_code, criterion, employee_name, status FROM legacy_person_status`,
      )
      .all() as Record<string, unknown>[]
  ).map(
    (r): LegacyPersonStatus => ({
      date: r.date as string,
      shopCode: r.shop_code as string,
      criterion: r.criterion as LegacyPersonStatus['criterion'],
      employeeName: r.employee_name as string,
      status: r.status as LegacyPersonStatus['status'],
    }),
  );

  const runs = (
    d
      .prepare(
        `SELECT job, source, started_at, finished_at, status, rows FROM import_runs
         ORDER BY started_at DESC LIMIT 50`,
      )
      .all() as Record<string, unknown>[]
  ).map(
    (r): ImportRunSummary => ({
      job: r.job as string,
      source: r.source as string,
      startedAt: r.started_at as string,
      finishedAt: r.finished_at as string | null,
      status: r.status as string,
      rows: r.rows as number,
    }),
  );

  return {
    generatedAt: new Date().toISOString(),
    source: 'sqlite',
    configFingerprint: configFingerprint(),
    shops,
    attendance,
    showcase,
    criteria,
    legacyPeople,
    runs,
  };
}
