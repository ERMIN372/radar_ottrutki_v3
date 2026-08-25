import { getDb } from './db';
import type {
  AttendanceRow,
  CriterionStatusRow,
  Shop,
  ShowcaseRow,
} from './types';
import type { LegacyPersonStatus } from './parsers/legacy-vitriny';
import { pickCanonicalName } from './shops';

/* ------------------------------- запись ---------------------------------- */

export function upsertShops(shops: readonly Shop[]): void {
  const d = getDb();
  // Имя перезаписывается последней записью: лавки переименовывают, и свежая
  // выгрузка отметок актуальнее легаси-книги (М32 Профсоюзная → Кржижановского).
  // Поэтому в seed сначала грузится легаси (даёт регион), потом выгрузки.
  // Регион в сырых выгрузках отсутствует — сохраняем ранее известный.
  const stmt = d.prepare(`
    INSERT INTO shops (code, name, region) VALUES (@code, @name, @region)
    ON CONFLICT(code) DO UPDATE SET
      name   = excluded.name,
      region = COALESCE(excluded.region, shops.region)
  `);
  d.transaction((rows: readonly Shop[]) => {
    for (const s of rows) stmt.run(s);
  })(shops);
}

export function replaceAttendance(date: string, rows: readonly AttendanceRow[]): void {
  const d = getDb();
  const del = d.prepare(`DELETE FROM attendance WHERE date = ?`);
  const ins = d.prepare(`
    INSERT INTO attendance (
      date, shop_code, employee_name, role, criterion, trainee, home_shop_code,
      arrival_minutes, arrival_source, raw_arrival, raw_departure, status, note
    ) VALUES (
      @date, @shopCode, @employeeName, @role, @criterion, @trainee, @homeShopCode,
      @arrivalMinutes, @arrivalSource, @rawArrival, @rawDeparture, @status, @note
    )
    ON CONFLICT(date, shop_code, employee_name, role) DO UPDATE SET
      criterion = excluded.criterion, trainee = excluded.trainee,
      home_shop_code = excluded.home_shop_code, arrival_minutes = excluded.arrival_minutes,
      arrival_source = excluded.arrival_source, raw_arrival = excluded.raw_arrival,
      raw_departure = excluded.raw_departure, status = excluded.status, note = excluded.note
  `);

  d.transaction(() => {
    del.run(date);
    for (const r of rows) {
      if (r.date !== date) continue;
      ins.run({ ...r, trainee: r.trainee ? 1 : 0 });
    }
  })();
}

export function upsertShowcase(rows: readonly ShowcaseRow[]): void {
  const d = getDb();
  const stmt = d.prepare(`
    INSERT INTO showcase_fill (date, shop_code, fill, status)
    VALUES (@date, @shopCode, @fill, @status)
    ON CONFLICT(date, shop_code) DO UPDATE SET fill = excluded.fill, status = excluded.status
  `);
  d.transaction((list: readonly ShowcaseRow[]) => {
    for (const r of list) stmt.run(r);
  })(rows);
}

export function upsertCriterionStatuses(rows: readonly CriterionStatusRow[]): void {
  const d = getDb();
  const stmt = d.prepare(`
    INSERT INTO criterion_status (date, shop_code, criterion, status, origin)
    VALUES (@date, @shopCode, @criterion, @status, @origin)
    ON CONFLICT(date, shop_code, criterion) DO UPDATE SET
      status = excluded.status, origin = excluded.origin
  `);
  d.transaction((list: readonly CriterionStatusRow[]) => {
    for (const r of list) stmt.run(r);
  })(rows);
}

export function upsertLegacyPeople(rows: readonly LegacyPersonStatus[]): void {
  const d = getDb();
  const stmt = d.prepare(`
    INSERT INTO legacy_person_status (date, shop_code, criterion, employee_name, status)
    VALUES (@date, @shopCode, @criterion, @employeeName, @status)
    ON CONFLICT(date, shop_code, criterion, employee_name) DO UPDATE SET status = excluded.status
  `);
  d.transaction((list: readonly LegacyPersonStatus[]) => {
    for (const r of list) stmt.run(r);
  })(rows);
}

export { rollUpAttendance } from './rollup';

export function canonicalShopName(candidates: readonly string[]): string {
  return pickCanonicalName(candidates);
}
