'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useTransition } from 'react';
import { CRITERION_ORDER, type CriterionKey, type ThresholdConfig } from '@/lib/types';
import { shortDate } from '@/lib/time';

export interface FilterState {
  from: string;
  to: string;
  region?: string;
  criterion?: CriterionKey | 'all';
  status?: string;
}

/**
 * Фильтры выпадающими списками, а не чипами: РМ-ов десять, критериев шесть —
 * на телефоне чипы занимали пол-экрана и переносились на пять строк.
 * Нативный <select> на мобильных открывается системным пикером.
 */
export function Filters({
  base,
  state,
  regions,
  dates,
  config,
  showCriterion = true,
  showStatus = true,
}: {
  base: string;
  state: FilterState;
  regions: string[];
  dates: string[];
  config: ThresholdConfig;
  showCriterion?: boolean;
  showStatus?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  /**
   * Патч кладём поверх текущего URL, а не поверх пропа state: state приходит
   * с сервера и обновляется через рендер, поэтому два быстрых переключения
   * подряд затирали друг друга.
   */
  const apply = useCallback(
    (patch: Partial<FilterState>) => {
      const q = new URLSearchParams(searchParams.toString());

      for (const [key, value] of Object.entries(patch)) {
        setOrDelete(q, key, value === 'all' ? undefined : value);
      }

      const query = q.toString();
      startTransition(() =>
        router.push(query ? `${base}?${query}` : base, { scroll: false }),
      );
    },
    [base, router, searchParams],
  );

  const first = dates[0] ?? state.from;
  const last = dates[dates.length - 1] ?? state.to;

  // Пресеты периода описываются одним значением, чтобы уместиться в один список.
  const periods: { value: string; label: string; from: string; to: string }[] = [
    { value: 'all', label: `Весь период · ${shortDate(first)} — ${shortDate(last)}`, from: first, to: last },
  ];
  if (dates.length >= 3) {
    const from = dates[dates.length - 3];
    periods.push({ value: '3d', label: `Последние 3 дня · ${shortDate(from)} — ${shortDate(last)}`, from, to: last });
  }
  periods.push({ value: 'last', label: `Последний день · ${shortDate(last)}`, from: last, to: last });

  const activePeriod =
    periods.find((p) => p.from === state.from && p.to === state.to)?.value ?? 'custom';

  return (
    <div
      className="surface grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4"
      style={{ opacity: pending ? 0.6 : 1, transition: 'opacity 120ms' }}
    >
      <Field label="Период">
        <select
          value={activePeriod}
          onChange={(e) => {
            const p = periods.find((x) => x.value === e.target.value);
            if (p) apply({ from: p.from, to: p.to });
          }}
        >
          {activePeriod === 'custom' && (
            <option value="custom">
              {shortDate(state.from)} — {shortDate(state.to)}
            </option>
          )}
          {periods.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="РМ">
        <select
          value={state.region ?? ''}
          onChange={(e) => apply({ region: e.target.value || undefined })}
        >
          <option value="">Все</option>
          {regions.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </Field>

      {showCriterion && (
        <Field label="Критерий">
          <select
            value={state.criterion ?? 'all'}
            onChange={(e) => apply({ criterion: e.target.value as CriterionKey | 'all' })}
          >
            <option value="all">Все (агрегат лавки)</option>
            {CRITERION_ORDER.map((c) => (
              <option key={c} value={c}>
                {config.criteria[c]?.title ?? c}
              </option>
            ))}
          </select>
        </Field>
      )}

      {showStatus && (
        <Field label="Статус">
          <select
            value={state.status ?? 'all'}
            onChange={(e) => apply({ status: e.target.value })}
          >
            <option value="all">Любой</option>
            <option value="red">🔴 Только красные</option>
            <option value="yellow">🟡 Есть жёлтые</option>
            <option value="green">🟢 Есть зелёные</option>
          </select>
        </Field>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-xs muted">{label}</span>
      {children}
    </label>
  );
}

function setOrDelete(q: URLSearchParams, key: string, value: string | undefined): void {
  if (value) q.set(key, value);
  else q.delete(key);
}
