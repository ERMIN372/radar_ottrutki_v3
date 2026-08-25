/**
 * Ключ лавки — код «М12», а не название.
 *
 * Названия расходятся между источниками: в выгрузке за 25.08 есть
 * «М32 Кржижановского» и «М63 Стремянная», а в Витрины.xlsx те же лавки
 * называются «М32 Профсоюзная» и «М63 Серпуховская» (переименование).
 * Плюс расхождения в пробелах: «М17 Б.Сухаревский» / «М17 Б. Сухаревский»,
 * «М22 Проспект мира» / «М22 Проспект Мира », хвостовые пробелы.
 * Код — единственное, что стабильно.
 */

const CODE_RE = /^\s*([А-ЯA-Zа-яa-z]{1,3}\s*\d{1,4})\b/;

/** Строки-итоги и служебные значения, которые не являются лавками. */
const NOT_A_SHOP = new Set(['итого', 'всего', 'total', '']);

export interface ShopRef {
  code: string;
  name: string;
}

/** «М12 Даниловская мануфактура » → { code: 'М12', name: 'М12 Даниловская мануфактура' } */
export function parseShop(value: unknown): ShopRef | null {
  const raw = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (NOT_A_SHOP.has(raw.toLowerCase())) return null;

  const m = CODE_RE.exec(raw);
  if (!m) return null;

  return { code: normalizeCode(m[1]), name: raw };
}

/** «м 12» → «М12». Латинская M из раскладки приводится к кириллической. */
export function normalizeCode(code: string): string {
  return code
    .replace(/\s+/g, '')
    .toUpperCase()
    .replace(/^M/, 'М');
}

/**
 * Из нескольких написаний названия выбираем каноничное: самое длинное
 * («М17 Б. Сухаревский» информативнее, чем «М17 Б.Сухаревский»), при равной
 * длине — первое встреченное. Легаси-лист имеет приоритет как справочник.
 */
export function pickCanonicalName(candidates: readonly string[]): string {
  return candidates.reduce((best, cur) =>
    cur.length > best.length ? cur : best,
  );
}
