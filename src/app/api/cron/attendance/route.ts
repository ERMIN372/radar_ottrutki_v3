import { NextResponse } from 'next/server';
import { checkCronSecret } from '@/lib/auth';
import { isWritable } from '@/lib/snapshot';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Job #1: раз в день, дедлайн 09:30 (расписание — в vercel.json / crontab). */
export async function GET(req: Request) {
  const auth = checkCronSecret(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.reason }, { status: 401 });

  // На read-only хостинге писать некуда: снимок собирается при сборке.
  if (!isWritable()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'Хранилище доступно только для чтения — синк не может записать результат. ' +
          'См. README, раздел «Хостинг».',
      },
      { status: 503 },
    );
  }

  try {
    const { syncAttendanceFromDrive } = await import('@/lib/etl/sync');
    const { invalidateSnapshot } = await import('@/lib/snapshot');

    const result = await syncAttendanceFromDrive();
    invalidateSnapshot();
    return NextResponse.json({
      ok: true,
      dates: result.dates,
      rows: result.rows,
      warnings: result.warnings.length,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
