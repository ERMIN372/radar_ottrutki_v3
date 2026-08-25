/**
 * Печёт src/generated/snapshot.json из fixtures — без SQLite и без записи в БД.
 *
 * Запускается автоматически перед `npm run build` (npm-хук `prebuild`), поэтому
 * работает на Vercel: нативный `better-sqlite3` там не собирается, а этот путь
 * его вообще не касается — только чистый JS-парсер xlsx.
 *
 * Вручную: npm run snapshot
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/lib/config';
import { parseAttendanceBuffer } from '../src/lib/parsers/attendance';
import { parseLegacyVitriny } from '../src/lib/parsers/legacy-vitriny';
import { rollUpAttendance } from '../src/lib/rollup';
import { configFingerprint, type Snapshot } from '../src/lib/snapshot';
import type { AttendanceRow, CriterionStatusRow, Shop } from '../src/lib/types';

const FIXTURES = path.join(process.cwd(), 'fixtures');
const OUT = path.join(process.cwd(), 'src', 'generated', 'snapshot.json');

const LEGACY = path.join(FIXTURES, 'vitriny.xlsx');
const ATTENDANCE_FILES = ['2026-08-25_vyhody.xls', '2026-08-25_voditeli.xls'];

function main(): void {
  const config = loadConfig();

  // 1. Легаси-книга: справочник лавок с супервайзерами + история 19–24.08.
  const legacy = parseLegacyVitriny(fs.readFileSync(LEGACY), config);

  // 2. Сырые выгрузки за 25.08: реальный расчёт по алгоритму.
  const attendance: AttendanceRow[] = [];
  const warnings: string[] = [...legacy.warnings];

  for (const name of ATTENDANCE_FILES) {
    const file = path.join(FIXTURES, name);
    if (!fs.existsSync(file)) {
      warnings.push(`Файл ${name} не найден — пропущен`);
      continue;
    }
    const parsed = parseAttendanceBuffer(fs.readFileSync(file), config);
    attendance.push(...parsed.rows);
    warnings.push(...parsed.warnings.map((w) => `[${name}] ${w.message}`));
  }

  // 3. Лавки: имя из самой свежей выгрузки, супервайзер — из легаси-книги.
  const shops = new Map<string, Shop>();
  for (const s of legacy.shops) shops.set(s.code, s);
  for (const r of attendance) {
    const prev = shops.get(r.shopCode);
    shops.set(r.shopCode, {
      code: r.shopCode,
      name: r.shopName,
      region: prev?.region ?? null,
    });
  }

  // 4. Статусы критериев: посчитанные за 25.08 перекрывают легаси за ту же дату.
  const criteria = new Map<string, CriterionStatusRow>();
  for (const c of legacy.criteria) {
    criteria.set(`${c.date}|${c.shopCode}|${c.criterion}`, c);
  }
  for (const date of new Set(attendance.map((r) => r.date))) {
    for (const c of rollUpAttendance(date, attendance, config)) {
      criteria.set(`${c.date}|${c.shopCode}|${c.criterion}`, c);
    }
  }

  const snapshot: Snapshot = {
    generatedAt: new Date().toISOString(),
    source: 'json',
    configFingerprint: configFingerprint(),
    shops: [...shops.values()],
    attendance,
    showcase: legacy.showcase,
    criteria: [...criteria.values()],
    legacyPeople: legacy.people,
    runs: [
      {
        job: 'snapshot',
        source: `fixtures: ${[path.basename(LEGACY), ...ATTENDANCE_FILES].join(', ')}`,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        status: 'ok',
        rows: attendance.length + legacy.people.length,
      },
    ],
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(snapshot));

  const sizeKb = Math.round(fs.statSync(OUT).size / 1024);
  console.log(`Снимок собран: ${path.relative(process.cwd(), OUT)} (${sizeKb} КБ)`);
  console.log(
    `  лавок ${snapshot.shops.length}, отметок ${snapshot.attendance.length}, ` +
      `витрин ${snapshot.showcase.length}, статусов критериев ${snapshot.criteria.length}, ` +
      `легаси-статусов людей ${snapshot.legacyPeople.length}`,
  );
  if (warnings.length) console.log(`  предупреждений при разборе: ${warnings.length}`);
}

main();
