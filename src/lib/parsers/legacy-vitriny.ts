import * as XLSX from 'xlsx';
import type { CriterionKey, CriterionStatusRow, ShowcaseRow, Status } from '../types';
import type { ThresholdConfig } from '../types';
import { parseShop } from '../shops';
import { normalizeFill, statusForFill, statusFromEmoji } from '../status';
import { isoDate } from '../time';

/**
 * Парсер легаси-книги «Витрины.xlsx», лист «Все данные».
 *
 * Формат: строки — Регион | Лавка | Параметр, колонки E..T — даты.
 * Внутри блока одной лавки идут:
 *   «Прибытие водителя»  — строка со статусами
 *   «Выход сотрудника»   — заголовок секции (пустая)
 *     «Кассир» / «Повар» / «Бариста» — заголовки подсекций (пустые)
 *       строки с ФИО     — статусы конкретных людей
 *   «Наполнение витрины» — доли 0–1
 *
 * Статусы тут раскрашены руками — импортируем как есть (origin='legacy'),
 * чтобы в радаре была история до появления автоматического расчёта.
 * Наполнение витрины — число, его пересчитываем по текущим порогам.
 */

const SECTION_HEADERS: Record<string, CriterionKey> = {
  'кассир': 'cashier',
  'повар': 'cook',
  'бариста': 'barista',
  'зд по залу': 'hallDeputy',
};

const DRIVER_ROW = 'прибытие водителя';
const SHOWCASE_ROW = 'наполнение витрины';
const EMPLOYEE_SECTION_ROW = 'выход сотрудника';

export interface LegacyParseResult {
  shops: { code: string; name: string; region: string | null }[];
  /** Статусы людей: (дата, лавка, критерий, ФИО) → статус. */
  people: LegacyPersonStatus[];
  showcase: ShowcaseRow[];
  criteria: CriterionStatusRow[];
  dates: string[];
  warnings: string[];
}

export interface LegacyPersonStatus {
  date: string;
  shopCode: string;
  criterion: CriterionKey;
  employeeName: string;
  status: Status;
}

export function parseLegacyVitriny(
  buffer: Buffer,
  config: ThresholdConfig,
  sheetName = 'Все данные',
): LegacyParseResult {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheet = wb.Sheets[sheetName];
  if (!sheet) throw new Error(`В книге нет листа «${sheetName}»`);

  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    raw: true,
  });
  if (grid.length === 0) throw new Error(`Лист «${sheetName}» пуст`);

  // Колонки с датами ищем по заголовку — позиции могут сдвинуться.
  const header = grid[0];
  const dateCols: { col: number; date: string }[] = [];
  header.forEach((cell, col) => {
    const d = asDate(cell);
    if (d) dateCols.push({ col, date: isoDate(d) });
  });
  if (dateCols.length === 0) throw new Error('В заголовке листа не найдено ни одной колонки-даты');

  const shops = new Map<string, { code: string; name: string; region: string | null }>();
  const showcase: ShowcaseRow[] = [];
  const warnings: string[] = [];

  // Книга ведётся руками: один и тот же блок лавки встречается дважды (М23
  // Добрынинский), а внутри блока дублируются строки сотрудников (М2 Покровка).
  // Побеждает первое встреченное значение, конфликтующий повтор — в warnings.
  const people = new Map<string, LegacyPersonStatus>();
  const showcaseSeen = new Map<string, number>();

  const putPerson = (row: LegacyPersonStatus, at: number): void => {
    const key = `${row.date}|${row.shopCode}|${row.criterion}|${row.employeeName}`;
    const prev = people.get(key);
    if (!prev) {
      people.set(key, row);
      return;
    }
    if (prev.status !== row.status) {
      warnings.push(
        `Строка ${at}: у «${row.employeeName}» (${row.shopCode}, ${row.date}) два разных ` +
          `статуса — ${prev.status} и ${row.status}; оставлен первый`,
      );
    }
  };

  let currentSection: CriterionKey | null = null;

  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    const region = str(row[0]) || null;
    const shopRef = parseShop(row[1]);
    const param = str(row[2]);
    if (!shopRef || !param) continue;

    if (!shops.has(shopRef.code)) {
      shops.set(shopRef.code, { code: shopRef.code, name: shopRef.name, region });
    }

    const key = param.toLowerCase().replace(/ё/g, 'е');

    if (key === DRIVER_ROW) {
      currentSection = null;
      for (const { col, date } of dateCols) {
        const st = statusFromEmoji(row[col]);
        if (!st) continue;
        putPerson(
          {
            date,
            shopCode: shopRef.code,
            criterion: 'driver',
            employeeName: 'Водитель',
            status: st,
          },
          r + 1,
        );
      }
      continue;
    }

    if (key === SHOWCASE_ROW) {
      currentSection = null;
      for (const { col, date } of dateCols) {
        const v = row[col];
        if (typeof v !== 'number' || Number.isNaN(v)) continue;
        const fill = normalizeFill(v);

        const key = `${date}|${shopRef.code}`;
        const prev = showcaseSeen.get(key);
        if (prev != null) {
          if (prev !== fill) {
            warnings.push(
              `Строка ${r + 1}: у ${shopRef.code} за ${date} два разных значения наполнения — ` +
                `${prev} и ${fill}; оставлено первое`,
            );
          }
          continue;
        }
        showcaseSeen.set(key, fill);

        showcase.push({
          date,
          shopCode: shopRef.code,
          fill,
          status: statusForFill(fill, config),
        });
      }
      continue;
    }

    if (key === EMPLOYEE_SECTION_ROW) {
      currentSection = null;
      continue;
    }

    if (SECTION_HEADERS[key]) {
      currentSection = SECTION_HEADERS[key];
      continue;
    }

    // Всё остальное — строка конкретного сотрудника внутри текущей секции.
    if (!currentSection) {
      warnings.push(`Строка ${r + 1}: «${param}» (${shopRef.code}) вне секции роли — пропущена`);
      continue;
    }

    for (const { col, date } of dateCols) {
      const st = statusFromEmoji(row[col]);
      if (!st) continue;
      putPerson(
        {
          date,
          shopCode: shopRef.code,
          criterion: currentSection,
          employeeName: param,
          status: st,
        },
        r + 1,
      );
    }
  }

  const peopleList = [...people.values()];
  const criteria = rollUpCriteria(peopleList, showcase);
  const dates = [
    ...new Set([...peopleList.map((p) => p.date), ...showcase.map((s) => s.date)]),
  ].sort();

  return { shops: [...shops.values()], people: peopleList, showcase, criteria, dates, warnings };
}

/** Статусы людей → статус критерия у лавки за день (худший побеждает). */
function rollUpCriteria(
  people: readonly LegacyPersonStatus[],
  showcase: readonly ShowcaseRow[],
): CriterionStatusRow[] {
  const buckets = new Map<string, Status[]>();
  for (const p of people) {
    const k = `${p.date}|${p.shopCode}|${p.criterion}`;
    const list = buckets.get(k);
    if (list) list.push(p.status);
    else buckets.set(k, [p.status]);
  }

  const out: CriterionStatusRow[] = [];
  for (const [k, statuses] of buckets) {
    const [date, shopCode, criterion] = k.split('|');
    out.push({
      date,
      shopCode,
      criterion: criterion as CriterionKey,
      status: worst(statuses),
      origin: 'legacy',
    });
  }
  for (const s of showcase) {
    out.push({
      date: s.date,
      shopCode: s.shopCode,
      criterion: 'showcase',
      status: s.status,
      origin: 'legacy',
    });
  }
  return out;
}

function worst(statuses: readonly Status[]): Status {
  if (statuses.includes('red')) return 'red';
  if (statuses.includes('yellow')) return 'yellow';
  if (statuses.includes('green')) return 'green';
  return 'no_data';
}

function str(v: unknown): string {
  return v == null ? '' : String(v).replace(/\s+/g, ' ').trim();
}

function asDate(v: unknown): Date | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  return null;
}
