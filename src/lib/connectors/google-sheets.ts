import { google } from 'googleapis';
import { getJwt } from './google-auth';
import type { RawFill } from '../etl/showcase-job';
import { isoDate } from '../time';

/**
 * Таблица наполненности заполняется руками в течение дня.
 * Ожидаемая раскладка (как в легаси-книге):
 *   строка 1 — даты, начиная с некоторой колонки
 *   колонка A — название лавки
 * Всё, что не распознано как дата или лавка, игнорируется.
 */
export async function readShowcaseSheet(
  spreadsheetId: string,
  sheetName: string,
  range: string,
): Promise<RawFill[]> {
  const sheets = google.sheets({ version: 'v4', auth: getJwt() });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!${range}`,
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });

  const grid = (res.data.values ?? []) as unknown[][];
  return gridToFills(grid);
}

/** Выделено отдельно, чтобы тестировать без сети. */
export function gridToFills(grid: readonly (readonly unknown[])[]): RawFill[] {
  if (grid.length === 0) return [];

  const header = grid[0];
  const dateCols: { col: number; date: string }[] = [];
  header.forEach((cell, col) => {
    const d = parseHeaderDate(cell);
    if (d) dateCols.push({ col, date: d });
  });
  if (dateCols.length === 0) return [];

  const out: RawFill[] = [];
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    const shop = String(row[0] ?? '').trim();
    if (!shop) continue;

    for (const { col, date } of dateCols) {
      const value = row[col];
      if (value == null || value === '') continue;
      out.push({ shop, date, value });
    }
  }
  return out;
}

/** Заголовок колонки: «25.08.2026», «2026-08-25» или Date. */
function parseHeaderDate(cell: unknown): string | null {
  if (cell instanceof Date && !Number.isNaN(cell.getTime())) return isoDate(cell);

  const s = String(cell ?? '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  m = /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/.exec(s);
  if (m) {
    return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
}
