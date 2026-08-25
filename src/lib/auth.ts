/** Крон-роуты закрыты общим секретом: Authorization: Bearer <CRON_SECRET>. */
export function checkCronSecret(req: Request): { ok: true } | { ok: false; reason: string } {
  const expected = process.env.CRON_SECRET;
  if (!expected) return { ok: false, reason: 'CRON_SECRET не задан на сервере' };

  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || !timingSafeEqual(token, expected)) {
    return { ok: false, reason: 'Неверный или отсутствующий токен' };
  }
  return { ok: true };
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
