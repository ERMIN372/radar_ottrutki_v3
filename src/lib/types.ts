/** Доменные типы радара открытий. */

export type Status = 'green' | 'yellow' | 'red' | 'other_schedule' | 'no_data';

/** Критерии, по которым считается статус лавки за день. */
export type CriterionKey =
  | 'driver'
  | 'cook'
  | 'cashier'
  | 'barista'
  | 'hallDeputy'
  | 'showcase';

export const CRITERION_ORDER: CriterionKey[] = [
  'driver',
  'cook',
  'cashier',
  'barista',
  'hallDeputy',
  'showcase',
];

/** Как получено время прихода — видно в drill-down, чтобы отличить опоздание от досчёта. */
export type ArrivalSource =
  /** Реальная отметка «Приход». */
  | 'mark'
  /** Расчёт: «Уход» − 30 минут (приёмка). */
  | 'derived_minus30'
  /** Отметок нет вообще, либо «Уход» вне окна правдоподобия. */
  | 'none';

export interface TimeCriterionConfig {
  title: string;
  kind: 'time';
  /** Включительно: t <= greenUntil → 🟢 */
  greenUntil: string;
  /** Включительно: greenUntil < t <= yellowUntil → 🟡 */
  yellowUntil: string;
  confirmed: boolean;
  note: string;
}

export interface PercentCriterionConfig {
  title: string;
  kind: 'percent';
  /** Включительно: v >= greenFrom → 🟢 */
  greenFrom: number;
  /** Включительно: v >= yellowFrom → 🟡 */
  yellowFrom: number;
  confirmed: boolean;
  note: string;
}

export type CriterionConfig = TimeCriterionConfig | PercentCriterionConfig;

export interface RoleMapEntry {
  criterion: CriterionKey;
  trainee: boolean;
}

export interface ThresholdConfig {
  version: number;
  updatedAt: string;
  criteria: Record<CriterionKey, CriterionConfig>;
  roleMap: Record<string, RoleMapEntry>;
  rules: {
    otherSchedule: {
      enabled: boolean;
      after: string;
      confirmed: boolean;
      note: string;
    };
    derivedArrival: {
      enabled: boolean;
      minutesBeforeDeparture: number;
      plausibleWindow: { from: string; to: string };
      note: string;
    };
    shopField: {
      use: 'Подразделение' | 'Подразделение сотрудника';
      confirmed: boolean;
      note: string;
    };
    shopAggregation: { strategy: 'worst' | 'worstOfConfirmed'; note: string };
    criterionAggregation: { strategy: 'worst'; note: string };
  };
}

/** Строка отметки, как она легла в БД. */
export interface AttendanceRow {
  date: string;
  shopCode: string;
  shopName: string;
  employeeName: string;
  role: string;
  criterion: CriterionKey | null;
  trainee: boolean;
  homeShopCode: string | null;
  /** Минуты от полуночи; null — если отметки нет. */
  arrivalMinutes: number | null;
  arrivalSource: ArrivalSource;
  rawArrival: string | null;
  rawDeparture: string | null;
  status: Status;
  note: string | null;
}

export interface ShowcaseRow {
  date: string;
  shopCode: string;
  /** Доля 0–1. */
  fill: number;
  status: Status;
}

/** Статус критерия у лавки за день. */
export interface CriterionStatusRow {
  date: string;
  shopCode: string;
  criterion: CriterionKey;
  status: Status;
  /** 'computed' — посчитано из сырых выгрузок; 'legacy' — импортировано из Витрины.xlsx как есть. */
  origin: 'computed' | 'legacy';
}

export interface Shop {
  code: string;
  name: string;
  region: string | null;
}
