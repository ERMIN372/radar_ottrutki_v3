import { latestDate, listDates } from './queries';
import type { CriterionKey, Status } from './types';
import { CRITERION_ORDER } from './types';

export interface ResolvedParams {
  from: string;
  to: string;
  region?: string;
  criterion?: CriterionKey | 'all';
  status?: Status | 'all';
  dates: string[];
}

const STATUSES: Status[] = ['green', 'yellow', 'red', 'other_schedule', 'no_data'];

/**
 * Параметры из URL с безопасными значениями по умолчанию:
 * по умолчанию показываем весь загруженный период.
 */
export async function resolveParams(
  sp: Record<string, string | string[] | undefined>,
): Promise<ResolvedParams> {
  const dates = await listDates();
  const fallbackTo = (await latestDate()) ?? new Date().toISOString().slice(0, 10);
  const fallbackFrom = dates[0] ?? fallbackTo;

  const one = (k: string): string | undefined => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };

  const isDate = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

  let from = isDate(one('from')) ? (one('from') as string) : fallbackFrom;
  let to = isDate(one('to')) ? (one('to') as string) : fallbackTo;
  if (from > to) [from, to] = [to, from];

  const criterionRaw = one('criterion');
  const criterion = CRITERION_ORDER.includes(criterionRaw as CriterionKey)
    ? (criterionRaw as CriterionKey)
    : 'all';

  const statusRaw = one('status');
  const status = STATUSES.includes(statusRaw as Status) ? (statusRaw as Status) : 'all';

  return { from, to, region: one('region') || undefined, criterion, status, dates };
}
