import type {
  ArrivalSource,
  CriterionConfig,
  CriterionKey,
  RoleMapEntry,
  Status,
  ThresholdConfig,
} from './types';
import { parseClock, parseStamp } from './time';

export const STATUS_LABEL: Record<Status, string> = {
  green: '🟢 Зелёная',
  yellow: '🟡 Жёлтая',
  red: '🔴 Красная',
  other_schedule: '⚪ Другой график',
  no_data: '⬜ Нет данных',
};

export const STATUS_EMOJI: Record<Status, string> = {
  green: '🟢',
  yellow: '🟡',
  red: '🔴',
  other_schedule: '⚪',
  no_data: '⬜',
};

/** Легаси-лист «Все данные» хранит статусы эмодзи — читаем их как есть. */
export function statusFromEmoji(value: unknown): Status | null {
  const s = String(value ?? '').trim();
  if (s.startsWith('🟢')) return 'green';
  if (s.startsWith('🟡')) return 'yellow';
  if (s.startsWith('🔴')) return 'red';
  return null;
}

/** Порядок «плохости» для агрегации: чем больше, тем хуже. */
const SEVERITY: Record<Status, number> = {
  no_data: -1,
  other_schedule: -1,
  green: 0,
  yellow: 1,
  red: 2,
};

/**
 * Худший статус побеждает. Нейтральные статусы (другой график, нет данных)
 * в агрегат не входят — если кроме них ничего нет, вернётся no_data.
 */
export function worstStatus(statuses: readonly Status[]): Status {
  let best: Status = 'no_data';
  for (const s of statuses) {
    if (SEVERITY[s] < 0) continue;
    if (SEVERITY[s] > SEVERITY[best] || SEVERITY[best] < 0) best = s;
  }
  return best;
}

/** Входит ли статус в агрегаты 🔴/🟡/🟢. */
export function countsInAggregate(status: Status): boolean {
  return SEVERITY[status] >= 0;
}

/** Должность из выгрузки → критерий + признак стажёра. */
export function mapRole(
  role: string | null | undefined,
  config: ThresholdConfig,
): RoleMapEntry | null {
  if (!role) return null;
  const normalized = String(role).trim();
  const direct = config.roleMap[normalized];
  if (direct) return direct;

  // Должности в 1С пишут по-разному: «Кассир - стажер» / «Кассир-стажер» / «кассир стажёр».
  const key = normalizeRoleKey(normalized);
  for (const [candidate, entry] of Object.entries(config.roleMap)) {
    if (normalizeRoleKey(candidate) === key) return entry;
  }
  return null;
}

function normalizeRoleKey(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/[\s\-–—]+/g, '');
}

export interface ArrivalResolution {
  /** Минуты от полуночи; null — отметки нет. */
  minutes: number | null;
  source: ArrivalSource;
  note: string | null;
}

/**
 * Алгоритм п.5 ТЗ: как получить время прихода, когда отметки неполные.
 *
 * 1. Есть «Приход» → используем его.
 * 2. Нет «Прихода», есть «Уход» → приход = Уход − 30 мин (время приёмки),
 *    но только если результат попадает в окно правдоподобия. Ночные уходы
 *    (в тестовой выгрузке 0:19, 1:51 — это конец вчерашней смены) через это
 *    окно не проходят и остаются «нет отметки».
 * 3. Нет ничего → «нет отметки».
 */
export function resolveArrival(
  rawArrival: unknown,
  rawDeparture: unknown,
  config: ThresholdConfig,
): ArrivalResolution {
  const arrival = parseStamp(rawArrival);
  if (arrival) return { minutes: arrival.minutes, source: 'mark', note: null };

  const rule = config.rules.derivedArrival;
  const departure = parseStamp(rawDeparture);
  if (!rule.enabled || !departure) {
    return { minutes: null, source: 'none', note: null };
  }

  const derived = departure.minutes - rule.minutesBeforeDeparture;
  const from = parseClock(rule.plausibleWindow.from);
  const to = parseClock(rule.plausibleWindow.to);
  if (derived < from || derived > to) {
    return {
      minutes: null,
      source: 'none',
      note:
        `Есть «Уход», но расчётный приход вне окна правдоподобия ` +
        `(${rule.plausibleWindow.from}–${rule.plausibleWindow.to}) — вероятно, конец ночной смены.`,
    };
  }

  return {
    minutes: derived,
    source: 'derived_minus30',
    note: `Прихода нет, время досчитано: уход − ${rule.minutesBeforeDeparture} мин (приёмка).`,
  };
}

/** Статус по времени прихода для конкретного критерия. */
export function statusForTime(
  minutes: number | null,
  criterion: CriterionKey,
  config: ThresholdConfig,
): Status {
  if (minutes == null) return 'red'; // п.5.1 ТЗ: нет отметки → красный, без исключений

  // п.5.0: правило «другой график» выполняется раньше всех остальных.
  const other = config.rules.otherSchedule;
  if (other.enabled && minutes > parseClock(other.after)) return 'other_schedule';

  const cfg = config.criteria[criterion];
  if (!cfg || cfg.kind !== 'time') return 'no_data';

  if (minutes <= parseClock(cfg.greenUntil)) return 'green';
  if (minutes <= parseClock(cfg.yellowUntil)) return 'yellow';
  return 'red';
}

/** Статус наполнения витрины. Принимает и 0–1, и 0–100. */
export function statusForFill(fill: number | null, config: ThresholdConfig): Status {
  if (fill == null || Number.isNaN(fill)) return 'no_data';
  const cfg = config.criteria.showcase;
  if (cfg.kind !== 'percent') return 'no_data';

  const share = normalizeFill(fill);
  if (share >= cfg.greenFrom) return 'green';
  if (share >= cfg.yellowFrom) return 'yellow';
  return 'red';
}

/** Google-таблицу заполняют руками: где-то «95», где-то «0.95». */
export function normalizeFill(value: number): number {
  return value > 1.0000001 ? value / 100 : value;
}

export function criterionTitle(key: CriterionKey, config: ThresholdConfig): string {
  return config.criteria[key]?.title ?? key;
}

export function isConfirmed(key: CriterionKey, config: ThresholdConfig): boolean {
  return config.criteria[key]?.confirmed ?? false;
}

export function criterionConfig(
  key: CriterionKey,
  config: ThresholdConfig,
): CriterionConfig | undefined {
  return config.criteria[key];
}
