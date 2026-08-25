/** Разбор времени и дат из выгрузок 1С. */

/** "06:17" | "6:17" → минуты от полуночи. */
export function parseClock(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) throw new Error(`Некорректное время в конфиге: ${hhmm}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Минуты от полуночи → "06:17". Пустое значение → "—". */
export function formatClock(minutes: number | null | undefined): string {
  if (minutes == null) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export interface ParsedStamp {
  /** ISO-дата отметки, YYYY-MM-DD. */
  date: string;
  /** Минуты от полуночи. */
  minutes: number;
}

/**
 * Отметка из выгрузки: "25.08.2026 6:25:29".
 * Excel иногда отдаёт то же значение уже как Date — поддерживаем оба варианта.
 */
export function parseStamp(value: unknown): ParsedStamp | null {
  if (value == null || value === '') return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return {
      date: toIsoDate(value.getFullYear(), value.getMonth() + 1, value.getDate()),
      minutes: value.getHours() * 60 + value.getMinutes(),
    };
  }

  const s = String(value).trim();
  const m = /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m) return null;

  return {
    date: toIsoDate(Number(m[3]), Number(m[2]), Number(m[1])),
    minutes: Number(m[4]) * 60 + Number(m[5]),
  };
}

function toIsoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Date → YYYY-MM-DD в локальной зоне (даты в выгрузках без времени). */
export function isoDate(d: Date): string {
  return toIsoDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** "2026-08-25" → "25.08" для заголовков колонок радара. */
export function shortDate(iso: string): string {
  const [, mm, dd] = iso.split('-');
  return `${dd}.${mm}`;
}

/** Все даты от from до to включительно. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  const cur = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  while (cur <= end) {
    out.push(isoDate(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}
