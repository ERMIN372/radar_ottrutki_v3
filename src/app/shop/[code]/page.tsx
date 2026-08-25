import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadConfig } from '@/lib/config';
import { resolveParams } from '@/lib/params';
import { getShop, shopHistory, type ShopDayPerson } from '@/lib/queries';
import { formatClock, shortDate } from '@/lib/time';
import { StatusBadge, STATUS_TEXT } from '@/components/Status';
import { CRITERION_ORDER, type CriterionKey } from '@/lib/types';

/** Ролевые критерии — те, что приходят из выгрузок отметок. */
const ROLE_CRITERIA: CriterionKey[] = ['driver', 'cook', 'cashier', 'barista', 'hallDeputy'];

export const dynamic = 'force-dynamic';

const SOURCE_LABEL: Record<ShopDayPerson['arrivalSource'], string> = {
  mark: 'реальная отметка',
  derived_minus30: 'досчитано: уход − 30 мин',
  none: 'отметки нет',
};

export default async function ShopPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { code } = await params;
  const sp = await searchParams;
  const p = await resolveParams(sp);
  const config = loadConfig();

  const shop = await getShop(decodeURIComponent(code));
  if (!shop) notFound();

  const history = await shopHistory(shop.code, p.from, p.to);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href={`/radar?from=${p.from}&to=${p.to}`} className="text-sm muted hover:underline">
          ← к радару
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{shop.name}</h1>
        <p className="mt-1 text-sm muted">
          РМ: {shop.region ?? '—'} · код {shop.code} · период {shortDate(p.from)} —{' '}
          {shortDate(p.to)}
        </p>
      </div>

      {history.length === 0 ? (
        <div className="surface p-8 text-center text-sm muted">За выбранный период данных нет.</div>
      ) : (
        history.map((day) => (
          <section key={day.date} className="surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold">
                {new Date(`${day.date}T00:00:00`).toLocaleDateString('ru-RU', {
                  day: '2-digit',
                  month: 'long',
                  weekday: 'short',
                })}
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs muted">Статус лавки:</span>
                <StatusBadge status={day.shopStatus} />
              </div>
            </div>

            {/* Критерии дня */}
            <div className="mt-3 flex flex-wrap gap-2">
              {CRITERION_ORDER.filter((c) => day.criteria.some((x) => x.criterion === c)).map((c) => {
                const item = day.criteria.find((x) => x.criterion === c)!;
                return (
                  <div
                    key={c}
                    className="rounded-lg border px-3 py-2"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <div className="text-xs muted">
                      {config.criteria[c]?.title ?? c}
                      {config.criteria[c]?.confirmed === false && (
                        <span title="Пороги требуют подтверждения"> ⚠</span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <StatusBadge status={item.status} />
                      {c === 'showcase' && day.fill != null && (
                        <span className="text-xs tabular-nums muted">
                          {Math.round(day.fill * 100)}%
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Роли, по которым за день нет ни одной строки в выгрузке. 1С отдаёт
                только тех, кто отметился, поэтому «не вышел» и «выходной» выглядят
                одинаково — отличить их можно только по графику из HR. */}
            {day.people.length > 0 &&
              (() => {
                const present = new Set(day.people.map((x) => x.criterion));
                const absent = ROLE_CRITERIA.filter((c) => !present.has(c));
                if (absent.length === 0) return null;
                return (
                  <p className="mt-3 text-xs muted">
                    Нет ни одной отметки:{' '}
                    <b>{absent.map((c) => config.criteria[c]?.title ?? c).join(', ')}</b>. В выгрузку
                    попадают только сотрудники с отметкой, поэтому «не вышел» и «выходной» здесь
                    неразличимы — нужен график из HR.
                  </p>
                );
              })()}

            {/* Отметки людей — то, ради чего нужен drill-down */}
            {day.people.length > 0 ? (
              /* Не таблица: на телефоне пять колонок обрезали самое важное —
                 статус. На широком экране строки раскладываются в те же колонки
                 через sm:contents, разметка одна. */
              <div className="mt-4 flex flex-col text-sm">
                <div
                  className="hidden border-b pb-1.5 text-xs muted sm:grid sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto_minmax(0,1.3fr)_auto] sm:gap-x-3"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <span>Сотрудник</span>
                  <span>Должность</span>
                  <span>Приход</span>
                  <span>Откуда время</span>
                  <span>Статус</span>
                </div>

                {sortPeople(day.people).map((person, i) => (
                  <div
                    key={`${person.employeeName}-${person.role}-${i}`}
                    className="grid gap-x-3 gap-y-1 border-b py-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto_minmax(0,1.3fr)_auto] sm:items-baseline"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span>
                        {person.employeeName}
                        {person.homeShopCode && person.homeShopCode !== shop.code && (
                          <span
                            className="ml-1.5 text-xs muted"
                            title="Числится в другой лавке — «Подразделение сотрудника» не совпадает с местом отметки"
                          >
                            ↔ {person.homeShopCode}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 sm:hidden">
                        <StatusBadge status={person.status} />
                      </span>
                    </div>

                    <div className="flex flex-wrap items-baseline gap-x-1.5 text-xs muted sm:contents">
                      <span>
                        {person.role}
                        {person.trainee && <span title="Стажёр"> · стажёр</span>}
                      </span>
                      <span aria-hidden className="sm:hidden">·</span>
                      <span className="tabular-nums sm:text-sm" style={{ color: 'var(--text)' }}>
                        {formatClock(person.arrivalMinutes)}
                      </span>
                      <span aria-hidden className="sm:hidden">·</span>
                      <span>
                        {SOURCE_LABEL[person.arrivalSource]}
                        {person.arrivalSource === 'derived_minus30' && person.rawDeparture && (
                          <span className="ml-1">(уход {timeOnly(person.rawDeparture)})</span>
                        )}
                      </span>
                    </div>

                    <span className="hidden sm:block">
                      <StatusBadge status={person.status} />
                    </span>

                    {person.note && (
                      <p className="text-xs muted sm:col-span-full">{person.note}</p>
                    )}
                  </div>
                ))}
              </div>
            ) : day.legacyPeople.length > 0 ? (
              <div className="mt-4">
                <p className="text-xs muted">
                  Времена отметок за этот день недоступны — показаны только статусы.
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {day.legacyPeople.map((person, i) => (
                    <span
                      key={`${person.employeeName}-${i}`}
                      className="rounded-md border px-2 py-1 text-xs"
                      style={{ borderColor: 'var(--border)' }}
                      title={`${criterionTitleOf(person.criterion, config)} · ${STATUS_TEXT[person.status]}`}
                    >
                      <StatusBadge status={person.status}>{person.employeeName}</StatusBadge>
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <p className="mt-4 text-xs muted">Отметок за день нет.</p>
            )}
          </section>
        ))
      )}
    </div>
  );
}

/** Сначала по критерию (как на радаре), внутри — по времени прихода. */
function sortPeople(people: readonly ShopDayPerson[]): ShopDayPerson[] {
  return [...people].sort((a, b) => {
    const ai = a.criterion ? CRITERION_ORDER.indexOf(a.criterion) : 99;
    const bi = b.criterion ? CRITERION_ORDER.indexOf(b.criterion) : 99;
    if (ai !== bi) return ai - bi;
    return (a.arrivalMinutes ?? 9999) - (b.arrivalMinutes ?? 9999);
  });
}

function criterionTitleOf(c: CriterionKey, config: ReturnType<typeof loadConfig>): string {
  return config.criteria[c]?.title ?? c;
}

/** «25.08.2026 7:40:55» → «7:40». */
function timeOnly(stamp: string): string {
  const m = /(\d{1,2}:\d{2})/.exec(stamp);
  return m ? m[1] : stamp;
}
