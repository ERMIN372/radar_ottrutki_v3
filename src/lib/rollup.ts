import type {
  AttendanceRow,
  CriterionKey,
  CriterionStatusRow,
  Status,
  ThresholdConfig,
} from './types';
import { worstStatus } from './status';

/**
 * Свёртка отметок в статусы критериев за день.
 *
 * Живёт отдельно от repository.ts, потому что нужна и при сборке снимка,
 * где БД не поднимается вовсе (см. snapshot.ts).
 *
 * Сотрудники без распознанной роли в свёртку не идут; статус «другой график»
 * не учитывается внутри worstStatus.
 */
export function rollUpAttendance(
  date: string,
  rows: readonly AttendanceRow[],
  config: ThresholdConfig,
): CriterionStatusRow[] {
  void config; // стратегия агрегации пока одна — worst; параметр оставлен для 'weighted'
  const buckets = new Map<string, Status[]>();

  for (const r of rows) {
    if (r.date !== date || !r.criterion) continue;
    const key = `${r.shopCode}|${r.criterion}`;
    const list = buckets.get(key);
    if (list) list.push(r.status);
    else buckets.set(key, [r.status]);
  }

  const out: CriterionStatusRow[] = [];
  for (const [key, statuses] of buckets) {
    const [shopCode, criterion] = key.split('|');
    out.push({
      date,
      shopCode,
      criterion: criterion as CriterionKey,
      status: worstStatus(statuses),
      origin: 'computed',
    });
  }
  return out;
}
