import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from './config';
import {
  mapRole,
  resolveArrival,
  statusForFill,
  statusForTime,
  worstStatus,
  normalizeFill,
} from './status';
import { parseShop, normalizeCode } from './shops';
import { CRITERION_ORDER } from './types';
import { parseClock, parseStamp, formatClock, dateRange } from './time';

const config = loadConfig();
const at = (h: number, m: number) => h * 60 + m;

test('пороги повара по листу: 🟢 до 6:00, 🟡 6:01–6:10, 🔴 6:11+', () => {
  assert.equal(statusForTime(at(5, 30), 'cook', config), 'green');
  assert.equal(statusForTime(at(6, 0), 'cook', config), 'green');
  assert.equal(statusForTime(at(6, 1), 'cook', config), 'yellow');
  assert.equal(statusForTime(at(6, 10), 'cook', config), 'yellow');
  assert.equal(statusForTime(at(6, 11), 'cook', config), 'red');
});

test('пороги кассира и бариста совпадают: 🟢 до 7:00, 🟡 7:01–7:10', () => {
  for (const c of ['cashier', 'barista'] as const) {
    assert.equal(statusForTime(at(7, 0), c, config), 'green');
    assert.equal(statusForTime(at(7, 1), c, config), 'yellow');
    assert.equal(statusForTime(at(7, 10), c, config), 'yellow');
    assert.equal(statusForTime(at(7, 11), c, config), 'red');
  }
});

test('водитель: 🟢 до 6:09, 🟡 6:10–6:30, 🔴 с 6:31', () => {
  assert.equal(statusForTime(at(5, 30), 'driver', config), 'green');
  assert.equal(statusForTime(at(6, 9), 'driver', config), 'green');
  assert.equal(statusForTime(at(6, 10), 'driver', config), 'yellow');
  assert.equal(statusForTime(at(6, 30), 'driver', config), 'yellow');
  // 6:31 в формулировке заказчика попадал и в жёлтую, и в красную — красная выигрывает.
  assert.equal(statusForTime(at(6, 31), 'driver', config), 'red');
});

test('зоны не пересекаются и не оставляют разрывов ни у одного критерия', () => {
  for (const key of ['driver', 'cook', 'cashier', 'barista', 'hallDeputy'] as const) {
    const cfg = config.criteria[key];
    assert.equal(cfg.kind, 'time');
    if (cfg.kind !== 'time') continue;

    const green = parseClock(cfg.greenUntil);
    const yellow = parseClock(cfg.yellowUntil);
    assert.ok(green < yellow, `${key}: граница 🟢 должна быть раньше границы 🟡`);

    // Каждая минута до порога «другого графика» получает ровно один статус.
    assert.equal(statusForTime(green, key, config), 'green');
    assert.equal(statusForTime(green + 1, key, config), 'yellow');
    assert.equal(statusForTime(yellow, key, config), 'yellow');
    assert.equal(statusForTime(yellow + 1, key, config), 'red');
  }
});

test('все пороги критериев подтверждены заказчиком', () => {
  for (const key of CRITERION_ORDER) {
    assert.equal(config.criteria[key].confirmed, true, `${key}: пороги не подтверждены`);
  }
});

test('нет отметки → красный, без исключений (п.5.1 ТЗ)', () => {
  assert.equal(statusForTime(null, 'cook', config), 'red');
  assert.equal(statusForTime(null, 'driver', config), 'red');
});

test('«другой график» срабатывает раньше пороговой таблицы (п.5.0 ТЗ)', () => {
  assert.equal(statusForTime(at(8, 1), 'cook', config), 'other_schedule');
  assert.equal(statusForTime(at(8, 0), 'cook', config), 'red', 'ровно 8:00 — ещё опоздание');
  assert.equal(statusForTime(at(9, 15), 'cashier', config), 'other_schedule');
});

test('расчёт прихода = уход − 30 мин (пример из ТЗ: уход 07:40 → приход 07:10)', () => {
  const r = resolveArrival(null, '25.08.2026 7:40:00', config);
  assert.equal(r.minutes, at(7, 10));
  assert.equal(r.source, 'derived_minus30');
  assert.match(r.note ?? '', /досчитано/);
});

test('реальная отметка приоритетнее расчёта', () => {
  const r = resolveArrival('25.08.2026 6:25:29', '25.08.2026 7:40:00', config);
  assert.equal(r.minutes, at(6, 25));
  assert.equal(r.source, 'mark');
});

test('ночной уход не превращается в приход: окно правдоподобия', () => {
  // Реальный случай из выгрузки: бариста М3 Пресня, уход 00:32.
  const r = resolveArrival(null, '25.08.2026 0:32:11', config);
  assert.equal(r.minutes, null);
  assert.equal(r.source, 'none');
  assert.match(r.note ?? '', /вне окна правдоподобия/);
  assert.equal(statusForTime(r.minutes, 'barista', config), 'red');
});

test('нет ни прихода, ни ухода → source=none без примечания', () => {
  const r = resolveArrival(null, null, config);
  assert.deepEqual(r, { minutes: null, source: 'none', note: null });
});

test('наполнение витрины: 🟢 95–100%, 🟡 85–94%, 🔴 ≤84%', () => {
  assert.equal(statusForFill(1.0, config), 'green');
  assert.equal(statusForFill(0.95, config), 'green');
  assert.equal(statusForFill(0.94, config), 'yellow');
  assert.equal(statusForFill(0.85, config), 'yellow');
  assert.equal(statusForFill(0.84, config), 'red');
  assert.equal(statusForFill(null, config), 'no_data');
});

test('наполнение принимает и проценты, и доли', () => {
  assert.equal(normalizeFill(95), 0.95);
  assert.equal(normalizeFill(0.95), 0.95);
  assert.equal(normalizeFill(1), 1);
  assert.equal(statusForFill(95, config), 'green');
});

test('агрегация: худший статус побеждает, нейтральные не учитываются', () => {
  assert.equal(worstStatus(['green', 'yellow', 'red']), 'red');
  assert.equal(worstStatus(['green', 'yellow']), 'yellow');
  assert.equal(worstStatus(['green', 'green']), 'green');
  assert.equal(worstStatus(['green', 'other_schedule']), 'green');
  assert.equal(worstStatus(['other_schedule', 'no_data']), 'no_data');
  assert.equal(worstStatus([]), 'no_data');
});

test('стажёр маппится на базовую роль с флагом trainee', () => {
  assert.deepEqual(mapRole('Повар', config), { criterion: 'cook', trainee: false });
  assert.deepEqual(mapRole('Повар-стажер', config), { criterion: 'cook', trainee: true });
  assert.deepEqual(mapRole('Кассир - стажер', config), { criterion: 'cashier', trainee: true });
  // Написание в 1С плавает — дефисы, пробелы, «ё» и регистр не должны ломать маппинг.
  assert.deepEqual(mapRole('кассир стажёр', config), { criterion: 'cashier', trainee: true });
  assert.equal(mapRole('Уборщик', config), null);
  assert.equal(mapRole(null, config), null);
});

test('все должности из тестовых выгрузок распознаются', () => {
  const roles = [
    'Повар', 'Повар-стажер', 'Кассир', 'Кассир - стажер',
    'Бариста', 'Бариста - стажер', 'Водитель-экспедитор',
  ];
  for (const r of roles) assert.ok(mapRole(r, config), `не распознана должность «${r}»`);
});

test('лавка определяется по коду, а не по названию', () => {
  assert.deepEqual(parseShop('М12 Даниловская мануфактура '), {
    code: 'М12',
    name: 'М12 Даниловская мануфактура',
  });
  // Одна и та же лавка под разными названиями (переименование в выгрузке).
  assert.equal(parseShop('М32 Кржижановского')?.code, parseShop('М32 Профсоюзная')?.code);
  assert.equal(parseShop('М17 Б.Сухаревский')?.code, parseShop('М17 Б. Сухаревский')?.code);
  assert.equal(parseShop('Итого'), null);
  assert.equal(parseShop(null), null);
  assert.equal(normalizeCode('M12'), 'М12', 'латинская M приводится к кириллице');
});

test('разбор отметки из выгрузки 1С', () => {
  assert.deepEqual(parseStamp('25.08.2026 6:25:29'), { date: '2026-08-25', minutes: 385 });
  assert.deepEqual(parseStamp('01.09.2026 15:04'), { date: '2026-09-01', minutes: 904 });
  assert.equal(parseStamp(''), null);
  assert.equal(parseStamp(null), null);
  assert.equal(parseStamp('какая-то строка'), null);
});

test('форматирование времени и диапазон дат', () => {
  assert.equal(formatClock(385), '06:25');
  assert.equal(formatClock(null), '—');
  assert.deepEqual(dateRange('2026-08-23', '2026-08-25'), [
    '2026-08-23', '2026-08-24', '2026-08-25',
  ]);
});
