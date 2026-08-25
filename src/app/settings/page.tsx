import { loadConfig, configPath } from '@/lib/config';
import { isSnapshotStale, isWritable } from '@/lib/snapshot';
import { CRITERION_ORDER } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Пороги только для чтения: правятся в config/thresholds.json.
 * Редактор из UI — задача «до конца недели» (см. README).
 */
export default async function SettingsPage() {
  const config = loadConfig();
  const [stale, writable] = [await isSnapshotStale(), isWritable()];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Пороги и правила</h1>
        <p className="mt-1 text-sm muted">
          Значения читаются из <code>{configPath().replace(process.cwd() + '/', '')}</code>
          {writable
            ? ' — правка не требует деплоя.'
            : ' — на этом хостинге конфиг вкомпилирован в сборку, правка требует пересборки.'}{' '}
          Версия конфига {config.version}, обновлён {config.updatedAt}.
        </p>
      </div>

      {stale && (
        <div
          className="surface p-3 text-sm"
          style={{ borderColor: 'var(--yellow)' }}
        >
          ⚠️ Пороги правили после того, как собрали снимок данных: статусы на дашборде
          посчитаны по старым значениям. Пересобери снимок — <code>npm run snapshot</code> —
          и задеплой заново.
        </div>
      )}

      <section className="surface overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs muted">
              <th className="px-4 py-2 font-normal">Критерий</th>
              <th className="px-4 py-2 font-normal">🟢 зелёная</th>
              <th className="px-4 py-2 font-normal">🟡 жёлтая</th>
              <th className="px-4 py-2 font-normal">🔴 красная</th>
              <th className="px-4 py-2 font-normal">Статус цифр</th>
            </tr>
          </thead>
          <tbody>
            {CRITERION_ORDER.map((key) => {
              const c = config.criteria[key];
              if (!c) return null;
              const cells =
                c.kind === 'time'
                  ? [
                      `до ${c.greenUntil}`,
                      `${plusMinute(c.greenUntil)}–${c.yellowUntil}`,
                      `с ${plusMinute(c.yellowUntil)} / нет отметки`,
                    ]
                  : [
                      `${pct(c.greenFrom)}–100%`,
                      `${pct(c.yellowFrom)}–${pct(c.greenFrom) - 1}%`,
                      `≤${pct(c.yellowFrom) - 1}%`,
                    ];
              return (
                <tr key={key} className="border-t align-top" style={{ borderColor: 'var(--border)' }}>
                  <td className="px-4 py-2.5 font-medium whitespace-nowrap">{c.title}</td>
                  {cells.map((v, i) => (
                    <td key={i} className="px-4 py-2.5 tabular-nums whitespace-nowrap">{v}</td>
                  ))}
                  <td className="px-4 py-2.5">
                    {c.confirmed ? (
                      <span className="st-green rounded px-2 py-0.5 text-xs">подтверждено</span>
                    ) : (
                      <span className="st-yellow rounded px-2 py-0.5 text-xs">требует подтверждения</span>
                    )}
                    <p className="mt-1.5 max-w-prose text-xs muted">{c.note}</p>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="surface p-4">
        <h2 className="text-sm font-semibold">Правила расчёта</h2>
        <dl className="mt-3 flex flex-col gap-3 text-sm">
          <Rule
            title="Другой график"
            value={
              config.rules.otherSchedule.enabled
                ? `приход позже ${config.rules.otherSchedule.after} → нейтральный статус, из агрегатов исключается`
                : 'выключено'
            }
            note={config.rules.otherSchedule.note}
            warn={!config.rules.otherSchedule.confirmed}
          />
          <Rule
            title="Досчёт прихода"
            value={`уход − ${config.rules.derivedArrival.minutesBeforeDeparture} мин, окно правдоподобия ${config.rules.derivedArrival.plausibleWindow.from}–${config.rules.derivedArrival.plausibleWindow.to}`}
            note={config.rules.derivedArrival.note}
          />
          <Rule
            title="Лавка сотрудника"
            value={`поле «${config.rules.shopField.use}»`}
            note={config.rules.shopField.note}
            warn={!config.rules.shopField.confirmed}
          />
          <Rule
            title="Агрегация статуса лавки"
            value={config.rules.shopAggregation.strategy === 'worst' ? 'худший критерий побеждает' : config.rules.shopAggregation.strategy}
            note={config.rules.shopAggregation.note}
          />
          <Rule
            title="Агрегация внутри критерия"
            value="худший статус среди сотрудников роли"
            note={config.rules.criterionAggregation.note}
          />
        </dl>
      </section>

      <section className="surface p-4">
        <h2 className="text-sm font-semibold">Маппинг должностей</h2>
        <p className="mt-0.5 text-xs muted">
          Стажёр попадает в те же пороги, что базовая роль, и помечается флагом.
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {Object.entries(config.roleMap)
            .filter(([k]) => !k.startsWith('$'))
            .map(([role, entry]) => (
              <span
                key={role}
                className="rounded-md border px-2 py-1 text-xs"
                style={{ borderColor: 'var(--border)' }}
              >
                {role} → <b>{config.criteria[entry.criterion]?.title ?? entry.criterion}</b>
                {entry.trainee && <span className="muted"> · стажёр</span>}
              </span>
            ))}
        </div>
      </section>
    </div>
  );
}

function Rule({
  title,
  value,
  note,
  warn,
}: {
  title: string;
  value: string;
  note: string;
  warn?: boolean;
}) {
  return (
    <div className="border-t pt-3 first:border-0 first:pt-0" style={{ borderColor: 'var(--border)' }}>
      <dt className="font-medium">
        {title}
        {warn && <span title="Требует подтверждения"> ⚠</span>}
      </dt>
      <dd className="mt-0.5">{value}</dd>
      <dd className="mt-1 max-w-prose text-xs muted">{note}</dd>
    </div>
  );
}

function pct(v: number): number {
  return Math.round(v * 100);
}

/** Границы включительные, поэтому жёлтая зона начинается на минуту позже зелёной. */
function plusMinute(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = (h * 60 + m + 1) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
