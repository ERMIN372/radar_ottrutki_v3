'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/**
 * Принудительное обновление наполненности витрин (Job #2 вне расписания крона).
 * Отметки с Диска приходят раз в день, поэтому кнопка дёргает только витрины.
 */
export function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/refresh/showcase', { method: 'POST' });
      const body = (await res.json()) as { ok: boolean; rows?: number; error?: string };
      setMsg(body.ok ? `Обновлено: ${body.rows ?? 0} значений` : (body.error ?? 'Ошибка'));
      if (body.ok) startTransition(() => router.refresh());
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Сеть недоступна');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {msg && <span className="text-xs muted">{msg}</span>}
      <button
        type="button"
        onClick={refresh}
        disabled={busy || pending}
        className="rounded-md border px-3 py-1.5 text-sm transition-opacity disabled:opacity-50"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        {busy || pending ? 'Обновляю…' : 'Обновить витрины'}
      </button>
    </div>
  );
}
