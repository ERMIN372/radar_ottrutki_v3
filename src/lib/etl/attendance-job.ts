import { loadConfig } from '../config';
import { startImportRun } from '../db';
import { parseAttendanceBuffer, type ParseWarning } from '../parsers/attendance';
import {
  replaceAttendance,
  rollUpAttendance,
  upsertCriterionStatuses,
  upsertShops,
} from '../repository';
import type { AttendanceRow } from '../types';

export interface AttendanceSource {
  /** Человекочитаемое имя источника для журнала (имя файла / ID на Диске). */
  label: string;
  buffer: Buffer;
}

export interface AttendanceJobResult {
  dates: string[];
  rows: number;
  warnings: ParseWarning[];
}

/**
 * Job #1: сырые выгрузки «выходы» + «водители» → статусы в БД.
 *
 * Оба файла кладутся в одну таблицу attendance: формат колонок одинаковый,
 * различает их только должность (роль → критерий через roleMap).
 */
export function runAttendanceJob(
  sources: readonly AttendanceSource[],
  fallbackDate?: string,
): AttendanceJobResult {
  const config = loadConfig();
  const run = startImportRun('attendance', sources.map((s) => s.label).join(', '));

  try {
    const all: AttendanceRow[] = [];
    const warnings: ParseWarning[] = [];

    for (const src of sources) {
      const parsed = parseAttendanceBuffer(src.buffer, config, fallbackDate);
      all.push(...parsed.rows);
      warnings.push(
        ...parsed.warnings.map((w) => ({ ...w, message: `[${src.label}] ${w.message}` })),
      );
    }

    const shops = new Map<string, { code: string; name: string; region: null }>();
    for (const r of all) {
      const prev = shops.get(r.shopCode);
      if (!prev || r.shopName.length > prev.name.length) {
        shops.set(r.shopCode, { code: r.shopCode, name: r.shopName, region: null });
      }
    }
    upsertShops([...shops.values()]);

    const dates = [...new Set(all.map((r) => r.date))].sort();
    for (const date of dates) {
      const forDate = all.filter((r) => r.date === date);
      replaceAttendance(date, forDate);
      upsertCriterionStatuses(rollUpAttendance(date, forDate, config));
    }

    run.finish('ok', all.length, warnings.map((w) => w.message));
    return { dates, rows: all.length, warnings };
  } catch (e) {
    run.finish('error', 0, [], e instanceof Error ? e.message : String(e));
    throw e;
  }
}
