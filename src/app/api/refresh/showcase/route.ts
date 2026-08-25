import { NextResponse } from 'next/server';
import { isWritable } from '@/lib/snapshot';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Принудительное обновление по кнопке в UI.
 *
 * Дашборд внутренний, отдельной авторизации пока нет — см. README, п.4
 * «Что нужно подтвердить»: если решим закрывать доступ, роут закрывается тем же
 * механизмом, что и крон.
 */
export async function POST() {
  if (!isWritable()) return readOnlyResponse();

  try {
    const { syncShowcaseFromSheets } = await import('@/lib/etl/sync');
    const { invalidateSnapshot } = await import('@/lib/snapshot');

    const result = await syncShowcaseFromSheets();
    invalidateSnapshot();

    return NextResponse.json({ ok: true, rows: result.rows, skipped: result.skipped });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

/** 503, а не 500: на read-only хостинге это не сбой, а отсутствующая возможность. */
function readOnlyResponse(): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error:
        'Хранилище доступно только для чтения: данные загружены из снимка, ' +
        'собранного при сборке. Запись работает там, где есть постоянный диск ' +
        '(локально или на своём сервере) — см. README, раздел «Хостинг».',
    },
    { status: 503 },
  );
}
