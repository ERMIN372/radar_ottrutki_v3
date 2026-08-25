import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../config';
import { parseAttendanceBuffer } from './attendance';
import { parseLegacyVitriny } from './legacy-vitriny';
import { gridToFills } from '../connectors/google-sheets';

const config = loadConfig();
const fx = (name: string) => fs.readFileSync(path.join(process.cwd(), 'fixtures', name));

test('парсер выгрузки сотрудников: строка «Итого» не становится лавкой', () => {
  const r = parseAttendanceBuffer(fx('2026-08-25_vyhody.xls'), config);
  assert.equal(r.rows.length, 336, 'все строки кроме «Итого»');
  assert.deepEqual(r.dates, ['2026-08-25']);
  assert.ok(!r.rows.some((x) => /итого/i.test(x.shopCode) || /итого/i.test(x.shopName)));
});

test('парсер выгрузки: все должности распознаны, лишних предупреждений нет', () => {
  const r = parseAttendanceBuffer(fx('2026-08-25_vyhody.xls'), config);
  const unknown = r.warnings.filter((w) => w.kind === 'unknown_role');
  assert.equal(unknown.length, 0, unknown.map((w) => w.message).join('\n'));
  assert.ok(r.rows.every((x) => x.criterion !== null));
});

test('парсер выгрузки: расхождение подразделений попадает в предупреждения', () => {
  const r = parseAttendanceBuffer(fx('2026-08-25_vyhody.xls'), config);
  const mismatch = r.warnings.filter((w) => w.kind === 'shop_mismatch');
  assert.equal(mismatch.length, 29);
  // Сотрудник числится в одной лавке, отметился в другой — обе видны в строке.
  const row = r.rows.find((x) => x.homeShopCode && x.homeShopCode !== x.shopCode);
  assert.ok(row, 'должна быть хотя бы одна такая строка');
});

test('парсер выгрузки водителей: «Уход» заполнен, досчёт срабатывает', () => {
  const r = parseAttendanceBuffer(fx('2026-08-25_voditeli.xls'), config);
  assert.equal(r.rows.length, 63);
  assert.ok(r.rows.every((x) => x.criterion === 'driver'));

  const derived = r.rows.filter((x) => x.arrivalSource === 'derived_minus30');
  assert.equal(derived.length, 5, 'пять водителей без «Прихода», но с «Уходом»');
  for (const d of derived) assert.ok(d.arrivalMinutes != null);
});

test('парсер легаси-книги: лавки, даты и дедупликация людей', () => {
  const r = parseLegacyVitriny(fx('vitriny.xlsx'), config);
  assert.equal(r.shops.length, 80);
  assert.deepEqual(r.dates, [
    '2026-08-19', '2026-08-20', '2026-08-21',
    '2026-08-22', '2026-08-23', '2026-08-24', '2026-08-25',
  ]);
  // В книге блоки сотрудников местами продублированы (М2 Покровка), а у
  // М23 Добрынинский два блока целиком — дублей на выходе быть не должно.
  const keys = r.people.map((p) => `${p.date}|${p.shopCode}|${p.criterion}|${p.employeeName}`);
  assert.equal(new Set(keys).size, keys.length);
});

test('парсер легаси-книги: конфликт значений не проглатывается молча', () => {
  const r = parseLegacyVitriny(fx('vitriny.xlsx'), config);
  // У М23 Добрынинский за 20.08 в двух блоках стоят 0.85 и 0.9.
  assert.equal(r.warnings.length, 1, r.warnings.join('\n'));
  assert.match(r.warnings[0], /М23.*два разных значения наполнения/);

  // Конфликтующие даты не задваиваются в выдаче.
  const keys = r.showcase.map((s) => `${s.date}|${s.shopCode}`);
  assert.equal(new Set(keys).size, keys.length);
});

test('парсер легаси-книги: наполнение витрины пересчитывается по текущим порогам', () => {
  const r = parseLegacyVitriny(fx('vitriny.xlsx'), config);
  assert.ok(r.showcase.length > 100);
  for (const s of r.showcase) {
    assert.ok(s.fill >= 0 && s.fill <= 1, `доля вне диапазона: ${s.fill}`);
    if (s.fill >= 0.95) assert.equal(s.status, 'green');
    else if (s.fill >= 0.85) assert.equal(s.status, 'yellow');
    else assert.equal(s.status, 'red');
  }
});

test('парсер легаси-книги: у каждой лавки есть РМ', () => {
  const r = parseLegacyVitriny(fx('vitriny.xlsx'), config);
  assert.ok(r.shops.every((s) => s.region), 'РМ должен быть заполнен у всех лавок');
});

test('Google Таблица: сетка разбирается в значения по лавкам и датам', () => {
  const grid = [
    ['Лавка', '25.08.2026', '26.08.2026'],
    ['М1 Милютинский', 0.95, '87%'],
    ['М2 Покровка', '', 100],
    ['', 0.5, 0.5], // строка без лавки игнорируется
  ];
  const fills = gridToFills(grid);
  assert.deepEqual(fills, [
    { shop: 'М1 Милютинский', date: '2026-08-25', value: 0.95 },
    { shop: 'М1 Милютинский', date: '2026-08-26', value: '87%' },
    { shop: 'М2 Покровка', date: '2026-08-26', value: 100 },
  ]);
});

test('Google Таблица: без колонок-дат возвращается пусто, а не мусор', () => {
  assert.deepEqual(gridToFills([['Лавка', 'что-то', 'ещё'], ['М1', 1, 2]]), []);
  assert.deepEqual(gridToFills([]), []);
});

test('Job наполнения витрин терпит ручной ввод: «95», «0,95», «95%»', async () => {
  // Джоба пишет в БД, поэтому уводим её на временный файл: рабочая база и её
  // журнал запусков не должны меняться от прогона тестов.
  const tmpDb = path.join(
    os.tmpdir(),
    `radar-test-${process.pid}-${Date.now()}`,
    'radar.db',
  );
  const prev = process.env.RADAR_DB_PATH;
  process.env.RADAR_DB_PATH = tmpDb;

  try {
    // Импорт после подмены пути: db.ts читает переменную при загрузке модуля.
    const { runShowcaseJob } = await import('../etl/showcase-job');
    const r = runShowcaseJob(
      [
        { shop: 'М1 Милютинский', date: '2099-01-01', value: 95 },
        { shop: 'М2 Покровка', date: '2099-01-01', value: '0,95' },
        { shop: 'М3 Пресня', date: '2099-01-01', value: '87%' },
        { shop: 'М4 Спиридоновка', date: '2099-01-01', value: '' },
        { shop: 'Итого', date: '2099-01-01', value: 90 },
      ],
      'unit-test',
    );
    assert.equal(r.rows, 3);
    assert.equal(r.skipped, 2, 'пустое значение и строка «Итого»');
    assert.ok(fs.existsSync(tmpDb), 'джоба должна была писать во временную БД');
  } finally {
    if (prev === undefined) delete process.env.RADAR_DB_PATH;
    else process.env.RADAR_DB_PATH = prev;
    fs.rmSync(path.dirname(tmpDb), { recursive: true, force: true });
  }
});
