import Link from 'next/link';
import { loadConfig } from '@/lib/config';
import { resolveParams } from '@/lib/params';
import { listRegions, radar } from '@/lib/queries';
import { shortDate } from '@/lib/time';
import { Filters } from '@/components/Filters';
import { Legend, StatusCell, STATUS_TEXT } from '@/components/Status';

export const dynamic = 'force-dynamic';

export default async function RadarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const p = await resolveParams(sp);
  const config = loadConfig();
  const regions = await listRegions();

  const { dates, rows } = await radar({
    from: p.from,
    to: p.to,
    region: p.region,
    criterion: p.criterion,
    status: p.status,
  });

  const criterionTitle =
    p.criterion && p.criterion !== 'all'
      ? (config.criteria[p.criterion]?.title ?? p.criterion)
      : null;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Радар по всем лавкам</h1>
        <p className="mt-1 text-sm muted">
          {criterionTitle
            ? `Критерий: ${criterionTitle}`
            : 'Ячейка — агрегированный статус лавки за день (худший из критериев)'}
          {' · '}
          {rows.length} лавок
        </p>
      </div>

      <Filters base="/radar" state={p} regions={regions} dates={p.dates} config={config} />

      {dates.length === 0 || rows.length === 0 ? (
        <div className="surface p-8 text-center text-sm muted">
          Под фильтры ничего не попало. Попробуй расширить период или снять фильтр по статусу.
        </div>
      ) : (
        <div className="surface radar-scroll">
          <table className="radar-table w-full text-sm">
            <thead>
              <tr>
                <th className="radar-sticky px-3 py-2 text-left text-xs font-medium muted">Лавка</th>
                <th className="hidden px-2 py-2 text-left text-xs font-medium muted sm:table-cell">РМ</th>
                {dates.map((d) => (
                  <th key={d} className="px-0.5 py-2 text-center text-xs font-medium muted">
                    {shortDate(d)}
                  </th>
                ))}
                <th className="px-2 py-2 text-right text-xs font-medium muted">🔴</th>
                <th className="w-full" aria-hidden />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.shop.code}>
                  <td className="radar-sticky px-3 py-1 whitespace-nowrap">
                    <Link
                      href={`/shop/${encodeURIComponent(r.shop.code)}?from=${p.from}&to=${p.to}`}
                      className="hover:underline"
                      title={r.shop.region ? `${r.shop.name} · РМ ${r.shop.region}` : r.shop.name}
                    >
                      {r.shop.name}
                    </Link>
                  </td>
                  <td className="hidden px-2 py-1 text-xs whitespace-nowrap muted sm:table-cell">
                    {r.shop.region ?? '—'}
                  </td>
                  {dates.map((d) => {
                    const cell = r.cells[d];
                    if (!cell) return <td key={d} className="px-0.5 py-0.5" />;
                    return (
                      <StatusCell
                        key={d}
                        status={cell.status}
                        href={`/shop/${encodeURIComponent(r.shop.code)}?from=${d}&to=${d}`}
                        title={`${r.shop.name} · ${shortDate(d)} · ${STATUS_TEXT[cell.status]}`}
                      />
                    );
                  })}
                  <td className="px-2 py-1 text-right text-xs font-semibold tabular-nums">
                    {r.redCount || ''}
                  </td>
                  <td aria-hidden />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Legend />
    </div>
  );
}
