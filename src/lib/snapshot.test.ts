import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { configFingerprint, type Snapshot } from './snapshot';
import { CRITERION_ORDER } from './types';

const SNAPSHOT_PATH = path.join(process.cwd(), 'src', 'generated', 'snapshot.json');

function readSnapshot(): Snapshot {
  return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8')) as Snapshot;
}

test('снимок закоммичен: без него не соберётся serverless-сборка', () => {
  assert.ok(fs.existsSync(SNAPSHOT_PATH), `нет файла ${SNAPSHOT_PATH} — запусти npm run snapshot`);
});

test('снимок собран на действующих порогах', () => {
  const s = readSnapshot();
  assert.equal(
    s.configFingerprint,
    configFingerprint(),
    'пороги правили после сборки снимка — пересобери: npm run snapshot',
  );
});

test('снимок содержит все данные, которые рисует дашборд', () => {
  const s = readSnapshot();
  assert.equal(s.shops.length, 80);
  assert.ok(s.attendance.length > 300, 'отметки за 25.08');
  assert.ok(s.showcase.length > 100, 'наполнение витрин');
  assert.ok(s.criteria.length > 1000, 'статусы критериев');
  assert.ok(s.legacyPeople.length > 2000, 'легаси-статусы людей');
  assert.ok(s.shops.every((x) => x.region), 'у каждой лавки есть РМ');
});

test('снимок покрывает весь период 19–25.08', () => {
  const s = readSnapshot();
  const dates = [...new Set(s.criteria.map((c) => c.date))].sort();
  assert.deepEqual(dates, [
    '2026-08-19', '2026-08-20', '2026-08-21',
    '2026-08-22', '2026-08-23', '2026-08-24', '2026-08-25',
  ]);
});

test('за 25.08 статусы посчитаны, а не взяты из легаси-книги', () => {
  const s = readSnapshot();
  const day = s.criteria.filter((c) => c.date === '2026-08-25' && c.criterion !== 'showcase');
  assert.ok(day.length > 0);
  assert.ok(
    day.every((c) => c.origin === 'computed'),
    'ролевые критерии за 25.08 должны быть origin=computed',
  );
});

test('в снимке нет неизвестных критериев и статусов', () => {
  const s = readSnapshot();
  const allowed = new Set(['green', 'yellow', 'red', 'other_schedule', 'no_data']);
  for (const c of s.criteria) {
    assert.ok(CRITERION_ORDER.includes(c.criterion), `неизвестный критерий ${c.criterion}`);
    assert.ok(allowed.has(c.status), `неизвестный статус ${c.status}`);
  }
});

test('снимок не тянет за собой better-sqlite3', () => {
  // На serverless нативный модуль не собирается: если он попадёт в статический
  // граф импортов, страницы упадут в рантайме.
  const src = fs.readFileSync(path.join(process.cwd(), 'src', 'lib', 'snapshot.ts'), 'utf8');
  assert.ok(
    !/^import .*better-sqlite3/m.test(src) && !/^import .*from '\.\/db'/m.test(src),
    'db.ts должен подключаться только динамическим import()',
  );
});
