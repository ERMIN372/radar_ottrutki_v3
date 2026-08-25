/**
 * Ручной запуск ETL по тестовым файлам из fixtures/.
 * Поднимает MVP с реальными данными за 19–25.08 одной командой: npm run seed
 *
 *   19–24.08 — легаси-статусы из Витрины.xlsx (раскрашены руками), origin='legacy'
 *   25.08    — посчитано из сырых выгрузок .xls, origin='computed'
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/lib/config';
import { getDb, dbPath, startImportRun } from '../src/lib/db';
import { parseLegacyVitriny } from '../src/lib/parsers/legacy-vitriny';
import { runAttendanceJob } from '../src/lib/etl/attendance-job';
import {
  upsertCriterionStatuses,
  upsertLegacyPeople,
  upsertShops,
  upsertShowcase,
} from '../src/lib/repository';

const FIXTURES = path.join(process.cwd(), 'fixtures');
const LEGACY = path.join(FIXTURES, 'vitriny.xlsx');
const VYHODY = path.join(FIXTURES, '2026-08-25_vyhody.xls');
const VODITELI = path.join(FIXTURES, '2026-08-25_voditeli.xls');

function main(): void {
  const config = loadConfig();
  const reset = process.argv.includes('--reset');

  const d = getDb();
  if (reset) {
    console.log('· Очищаю таблицы (--reset)');
    d.exec(`
      DELETE FROM attendance;
      DELETE FROM showcase_fill;
      DELETE FROM criterion_status;
      DELETE FROM legacy_person_status;
      DELETE FROM shops;
    `);
  }

  console.log(`· БД: ${dbPath()}`);

  /* --- 1. Легаси-книга: справочник лавок + история 19–24.08 --------------- */
  const run = startImportRun('seed:legacy', path.basename(LEGACY));
  try {
    const legacy = parseLegacyVitriny(fs.readFileSync(LEGACY), config);
    upsertShops(legacy.shops);
    upsertLegacyPeople(legacy.people);
    upsertShowcase(legacy.showcase);
    upsertCriterionStatuses(legacy.criteria);
    run.finish('ok', legacy.criteria.length, legacy.warnings);

    console.log(
      `· Витрины.xlsx: лавок ${legacy.shops.length}, статусов людей ${legacy.people.length}, ` +
        `витрин ${legacy.showcase.length}, свёрнутых критериев ${legacy.criteria.length}`,
    );
    console.log(`  даты: ${legacy.dates.join(', ')}`);
    if (legacy.warnings.length) {
      console.log(`  предупреждений: ${legacy.warnings.length}`);
      for (const w of legacy.warnings.slice(0, 5)) console.log(`    · ${w}`);
    }
  } catch (e) {
    run.finish('error', 0, [], e instanceof Error ? e.message : String(e));
    throw e;
  }

  /* --- 2. Сырые выгрузки за 25.08: реальный расчёт по алгоритму ----------- */
  const result = runAttendanceJob([
    { label: '2026-08-25_vyhody.xls', buffer: fs.readFileSync(VYHODY) },
    { label: '2026-08-25_voditeli.xls', buffer: fs.readFileSync(VODITELI) },
  ]);

  console.log(
    `· Выгрузки отметок: строк ${result.rows}, даты ${result.dates.join(', ')}, ` +
      `предупреждений ${result.warnings.length}`,
  );
  const byKind = new Map<string, number>();
  for (const w of result.warnings) byKind.set(w.kind, (byKind.get(w.kind) ?? 0) + 1);
  for (const [kind, n] of byKind) console.log(`    · ${kind}: ${n}`);

  /* --- 3. Итог ------------------------------------------------------------ */
  const stats = d
    .prepare(
      `SELECT date, COUNT(DISTINCT shop_code) AS shops, COUNT(*) AS cells,
              SUM(status='red') AS red, SUM(status='yellow') AS yellow, SUM(status='green') AS green
       FROM criterion_status GROUP BY date ORDER BY date`,
    )
    .all() as { date: string; shops: number; cells: number; red: number; yellow: number; green: number }[];

  console.log('\nИтог по дням:');
  console.log('  дата         лавок  ячеек   🔴    🟡    🟢');
  for (const s of stats) {
    console.log(
      `  ${s.date}   ${String(s.shops).padStart(4)}  ${String(s.cells).padStart(5)}  ` +
        `${String(s.red).padStart(4)}  ${String(s.yellow).padStart(4)}  ${String(s.green).padStart(4)}`,
    );
  }
  console.log('\nГотово. Запусти дашборд: npm run dev');
}

main();
