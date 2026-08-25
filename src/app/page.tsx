import Link from 'next/link';
import { loadConfig } from '@/lib/config';
import { resolveParams } from '@/lib/params';
import {
  antiTop,
  lastRun,
  listRegions,
  shopStatuses,
  showcaseStats,
  summaryByCriterion,
  weakestCriteria,
} from '@/lib/queries';
import { isWritable } from '@/lib/snapshot';
import { shortDate } from '@/lib/time';
import { Filters } from '@/components/Filters';
import { Legend, StatusBadge, StatusBar } from '@/components/Status';
import { RefreshButton } from '@/components/RefreshButton';
import { CRITERION_ORDER } from '@/lib/types';
import { plural } from '@/lib/plural';

export const dynamic = 'force-dynamic';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const p = await resolveParams(sp);
  const config = loadConfig();
  const day = p.to;

  const [regions, summary, shops, top, weak, fill, runAttendance, runShowcase] =
    await Promise.all([
      listRegions(),
      summaryByCriterion(day, p.region),
      shopStatuses(day, p.region),
      antiTop(p.from, p.to, 12, p.region),
      weakestCriteria(p.from, p.to, p.region),
      showcaseStats(day, p.region),
      lastRun('attendance'),
      lastRun('showcase'),
    ]);
  const writable = isWritable();

  const shopTotals = { green: 0, yellow: 0, red: 0 };
  for (const s of shops.values()) {
    if (s === 'green') shopTotals.green++;
    else if (s === 'yellow') shopTotals.yellow++;
    else if (s === 'red') shopTotals.red++;
  }

  const unconfirmed = CRITERION_ORDER.filter((c) => config.criteria[c]?.confirmed === false);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Сводка по сети</h1>
          <p className="mt-1 text-sm muted">
            Статусы на {shortDate(day)}; тренды и анти-топ — за {shortDate(p.from)} — {shortDate(p.to)}
            {p.region ? ` · РМ ${p.region}` : ''}
          </p>
        </div>
        {writable && <RefreshButton />}
      </div>

      {unconfirmed.length > 0 && (
        <div
          className="surface flex flex-wrap items-center gap-2 p-3 text-sm"
          style={{ borderColor: 'var(--yellow)' }}
        >
          <span>⚠️</span>
          <span>
            Пороги требуют подтверждения по оригиналу листа:{' '}
            <b>{unconfirmed.map((c) => config.criteria[c]?.title).join(', ')}</b>. Цифры сняты с фото
            рукописного листа.
          </span>
          <Link href="/settings" className="underline">
            что именно спорно
          </Link>
        </div>
      )}

      <Filters base="/" state={p} regions={regions} dates={p.dates} config={config} showCriterion={false} showStatus={false} />

      {/* --- Плитки: лавки по агрегату и наполнение витрин --- */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile title="Лавок в 🔴" value={shopTotals.red} total={shops.size} tone="red" />
        <Tile title="Лавок в 🟡" value={shopTotals.yellow} total={shops.size} tone="yellow" />
        <Tile title="Лавок в 🟢" value={shopTotals.green} total={shops.size} tone="green" />
        <ShowcaseTile fill={fill} totalShops={shops.size} />
      </div>

      {/* --- По критериям --- */}
      <section className="surface p-4">
        <h2 className="text-sm font-semibold">Лавки по критериям · {shortDate(day)}</h2>
        <p className="mt-0.5 text-xs muted">
          Агрегат лавки = худший статус из критериев (правило в конфиге).
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {summary.map((s) => {
            const cfg = config.criteria[s.criterion];
            const counted = s.green + s.yellow + s.red;
            return (
              <Link
                key={s.criterion}
                href={`/radar?from=${p.from}&to=${p.to}&criterion=${s.criterion}${p.region ? `&region=${encodeURIComponent(p.region)}` : ''}`}
                className="rounded-lg border p-3 transition-colors hover:opacity-90"
                style={{ borderColor: 'var(--border)' }}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">
                    {cfg?.title ?? s.criterion}
                    {cfg?.confirmed === false && <span title="Пороги требуют подтверждения"> ⚠</span>}
                  </span>
                  <span className="text-xs muted tabular-nums">
                    {counted > 0 ? `${Math.round((s.red / counted) * 100)}% 🔴` : '—'}
                  </span>
                </div>
                <div className="mt-2">
                  <StatusBar green={s.green} yellow={s.yellow} red={s.red} missing={s.missing} />
                </div>
                <div className="mt-1.5 flex gap-3 text-xs tabular-nums muted">
                  <span>🟢 {s.green}</span>
                  <span>🟡 {s.yellow}</span>
                  <span>🔴 {s.red}</span>
                  {s.missing > 0 && <span>· нет данных: {s.missing}</span>}
                </div>
                {counted === 0 && (
                  <p className="mt-1.5 text-xs muted">
                    Ни одной отметки за день — должность не встречается в выгрузке.
                  </p>
                )}
              </Link>
            );
          })}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[1.15fr_1fr]">
        {/* --- Анти-топ --- */}
        <section className="surface p-4">
          <h2 className="text-sm font-semibold">Проблемные локации — анти-топ 🔴</h2>
          <p className="mt-0.5 text-xs muted">
            Число красных ячеек за {shortDate(p.from)} — {shortDate(p.to)} по всем критериям.
          </p>
          {top.length === 0 ? (
            <p className="mt-4 text-sm muted">За период красных статусов нет.</p>
          ) : (
            /* Список, а не таблица: колонка «Западает» — длинный текст, в четырёх
               колонках он на телефоне рассыпался по одному слову в строку. */
            <ul className="mt-3 flex flex-col">
              {top.map((r) => (
                <li
                  key={r.shop.code}
                  className="flex items-start justify-between gap-3 border-t py-2 first:border-0"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <div className="min-w-0">
                    <Link
                      href={`/shop/${encodeURIComponent(r.shop.code)}?from=${p.from}&to=${p.to}`}
                      className="text-sm hover:underline"
                    >
                      {r.shop.name}
                    </Link>
                    {r.shop.region && <span className="ml-1.5 text-xs muted">{r.shop.region}</span>}
                    <p className="mt-0.5 text-xs muted">
                      {r.criteria.map((c) => config.criteria[c]?.title ?? c).join(', ')}
                      {r.fill != null && ` · витрина ${Math.round(r.fill * 100)}%`}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums" title="Красных ячеек за период">
                    {r.redCount} 🔴
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* --- Где западает --- */}
        <section className="surface p-4">
          <h2 className="text-sm font-semibold">Где западает сильнее всего</h2>
          <p className="mt-0.5 text-xs muted">
            Доля 🔴 среди всех оценённых ячеек критерия за период.
          </p>
          <div className="mt-3 flex flex-col gap-2.5">
            {weak.map((w) => (
              <div key={w.criterion}>
                <div className="flex items-baseline justify-between text-sm">
                  <span>{config.criteria[w.criterion]?.title ?? w.criterion}</span>
                  <span className="tabular-nums muted">
                    {Math.round(w.share * 100)}% · {w.red} из {w.total}
                  </span>
                </div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full" style={{ background: 'var(--neutral-soft)' }}>
                  <div className="dot-red h-full" style={{ width: `${Math.round(w.share * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>

          {/* Блок про синк показываем только там, где синк вообще возможен:
              на read-only хостинге «не запускалось» — это шум, а не информация. */}
          {writable && (
            <>
              <h3 className="mt-5 text-sm font-semibold">Последние обновления данных</h3>
              <dl className="mt-2 flex flex-col gap-1.5 text-xs">
                <RunLine label="Отметки (Диск)" run={runAttendance} />
                <RunLine label="Витрины (Таблица)" run={runShowcase} />
              </dl>
            </>
          )}
        </section>
      </div>

      <Legend />
    </div>
  );
}

/**
 * Витрину заполняют руками в течение дня, поэтому покрытие бывает низким.
 * Среднее по трём лавкам — не среднее по сети, и подавать его так нельзя.
 */
function ShowcaseTile({
  fill,
  totalShops,
}: {
  fill: Awaited<ReturnType<typeof showcaseStats>>;
  totalShops: number;
}) {
  const coverage = totalShops > 0 ? fill.filled / totalShops : 0;
  const thin = coverage < 0.5;

  return (
    <div className="surface p-4">
      <div className="text-xs muted">Среднее наполнение витрины</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums">
          {fill.avg == null ? '—' : `${Math.round(fill.avg * 100)}%`}
        </span>
        {fill.filled > 0 && (
          <span className="text-xs tabular-nums muted">
            по {fill.filled} {plural(fill.filled, 'лавке', 'лавкам', 'лавкам')} из {totalShops}
          </span>
        )}
      </div>
      {fill.filled === 0 ? (
        <p className="mt-1 text-xs muted">За день таблицу ещё не заполняли.</p>
      ) : thin ? (
        <p className="mt-1 text-xs" style={{ color: 'var(--yellow)' }}>
          ⚠ Заполнено меньше половины лавок — это не среднее по сети.
        </p>
      ) : (
        <p className="mt-1 text-xs muted">
          минимум {Math.round((fill.min ?? 0) * 100)}% — {fill.minShop}
        </p>
      )}
    </div>
  );
}

function Tile({
  title,
  value,
  total,
  tone,
}: {
  title: string;
  value: number;
  total: number;
  tone: 'red' | 'yellow' | 'green';
}) {
  return (
    <div className="surface p-4">
      <div className="text-xs muted">{title}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className={`text-2xl font-semibold tabular-nums`} style={{ color: `var(--${tone})` }}>
          {value}
        </span>
        <span className="text-sm muted tabular-nums">из {total}</span>
      </div>
      <div className="mt-2">
        <StatusBar
          green={tone === 'green' ? value : 0}
          yellow={tone === 'yellow' ? value : 0}
          red={tone === 'red' ? value : 0}
          missing={Math.max(0, total - value)}
        />
      </div>
    </div>
  );
}

function RunLine({
  label,
  run,
}: {
  label: string;
  run: Awaited<ReturnType<typeof lastRun>>;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="muted">{label}</dt>
      <dd className="text-right">
        {run ? (
          <>
            <StatusBadge status={run.status === 'ok' ? 'green' : 'red'}>
              {run.status === 'ok' ? 'ок' : 'ошибка'}
            </StatusBadge>{' '}
            <span className="muted">
              {new Date(run.finishedAt ?? run.startedAt).toLocaleString('ru-RU')} · {run.rows} строк
            </span>
          </>
        ) : (
          <span className="muted">не запускалось</span>
        )}
      </dd>
    </div>
  );
}
