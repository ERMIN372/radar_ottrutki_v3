import { loadConfig } from '../config';
import { startImportRun } from '../db';
import { upsertCriterionStatuses, upsertShowcase } from '../repository';
import { normalizeFill, statusForFill } from '../status';
import type { CriterionStatusRow, ShowcaseRow } from '../types';
import { parseShop } from '../shops';

/** Сырая ячейка из Google-таблицы: лавка + дата + значение. */
export interface RawFill {
  shop: string;
  date: string;
  /** Число (0–1 или 0–100) либо строка «95%», «0,95». */
  value: unknown;
}

export interface ShowcaseJobResult {
  rows: number;
  skipped: number;
  warnings: string[];
}

/**
 * Job #2: наполненность витрины → статусы в БД.
 *
 * Значения вводят руками, поэтому терпим и «0,95», и «95%», и «95».
 */
export function runShowcaseJob(raw: readonly RawFill[], source: string): ShowcaseJobResult {
  const config = loadConfig();
  const run = startImportRun('showcase', source);

  try {
    const rows: ShowcaseRow[] = [];
    const criteria: CriterionStatusRow[] = [];
    const warnings: string[] = [];
    let skipped = 0;

    for (const r of raw) {
      const shop = parseShop(r.shop);
      if (!shop) {
        skipped++;
        warnings.push(`Не удалось определить лавку: «${r.shop}»`);
        continue;
      }

      const num = toNumber(r.value);
      if (num == null) {
        skipped++;
        continue;
      }

      const fill = normalizeFill(num);
      if (fill < 0 || fill > 1.5) {
        skipped++;
        warnings.push(`${shop.code} ${r.date}: значение «${String(r.value)}» вне диапазона`);
        continue;
      }

      const status = statusForFill(fill, config);
      rows.push({ date: r.date, shopCode: shop.code, fill, status });
      criteria.push({
        date: r.date,
        shopCode: shop.code,
        criterion: 'showcase',
        status,
        origin: 'computed',
      });
    }

    upsertShowcase(rows);
    upsertCriterionStatuses(criteria);

    run.finish('ok', rows.length, warnings);
    return { rows: rows.length, skipped, warnings };
  } catch (e) {
    run.finish('error', 0, [], e instanceof Error ? e.message : String(e));
    throw e;
  }
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isNaN(value) ? null : value;
  const s = String(value ?? '').trim().replace('%', '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}
