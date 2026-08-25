import * as XLSX from 'xlsx';
import type { AttendanceRow, ThresholdConfig } from '../types';
import { parseShop } from '../shops';
import { mapRole, resolveArrival, statusForTime } from '../status';
import { parseStamp } from '../time';

/**
 * Парсер выгрузок отметок (и «выходы», и «водители» — формат колонок одинаковый):
 * Подразделение | Сотрудник | Должность | Подразделение сотрудника | Приход | Уход |
 * Часов фактически | Часов ночь
 *
 * Особенности реальных файлов, учтённые здесь:
 *  - старый формат .xls (BIFF), не .xlsx;
 *  - последняя строка — «Итого», её надо выбросить;
 *  - в «выходы» колонка «Уход» пустая в 332 строках из 336 — на неё нельзя опираться;
 *  - у водителей заполнены обе колонки;
 *  - в названиях лавок встречаются хвостовые пробелы и переименования.
 */

export interface AttendanceParseResult {
  rows: AttendanceRow[];
  /** Даты, встреченные в файле (обычно одна). */
  dates: string[];
  warnings: ParseWarning[];
}

export interface ParseWarning {
  kind: 'unknown_role' | 'no_shop' | 'no_stamps' | 'shop_mismatch' | 'no_date';
  message: string;
  row?: number;
}

interface RawRow {
  Подразделение?: unknown;
  Сотрудник?: unknown;
  Должность?: unknown;
  'Подразделение сотрудника'?: unknown;
  Приход?: unknown;
  Уход?: unknown;
}

export function parseAttendanceBuffer(
  buffer: Buffer,
  config: ThresholdConfig,
  /** Дата отчёта, если в файле не удалось её вывести из отметок. */
  fallbackDate?: string,
): AttendanceParseResult {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false, raw: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error('В файле нет ни одного листа');

  const raw = XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: null, raw: false });

  const rows: AttendanceRow[] = [];
  const warnings: ParseWarning[] = [];
  const dates = new Set<string>();

  const shopField = config.rules.shopField.use;

  raw.forEach((r, i) => {
    const rowNo = i + 2; // +1 за заголовок, +1 за 1-based нумерацию Excel

    const markShop = parseShop(r['Подразделение']);
    const homeShop = parseShop(r['Подразделение сотрудника']);
    const employeeName = String(r['Сотрудник'] ?? '').trim();

    // Строка «Итого» и прочие служебные — parseShop вернёт null.
    if (!markShop && !employeeName) return;

    const shop = shopField === 'Подразделение сотрудника' ? (homeShop ?? markShop) : markShop;
    if (!shop) {
      warnings.push({
        kind: 'no_shop',
        message: `Строка ${rowNo}: не удалось определить лавку («${String(r['Подразделение'] ?? '')}»), сотрудник «${employeeName}»`,
        row: rowNo,
      });
      return;
    }

    const role = r['Должность'] == null ? null : String(r['Должность']).trim();
    const mapped = mapRole(role, config);
    if (!mapped) {
      warnings.push({
        kind: 'unknown_role',
        message: `Строка ${rowNo}: должность «${role ?? '—'}» не найдена в roleMap, сотрудник «${employeeName}» (лавка ${shop.code})`,
        row: rowNo,
      });
    }

    if (markShop && homeShop && markShop.code !== homeShop.code) {
      warnings.push({
        kind: 'shop_mismatch',
        message: `Строка ${rowNo}: «${employeeName}» числится в ${homeShop.name}, отметился в ${markShop.name}`,
        row: rowNo,
      });
    }

    const arrival = resolveArrival(r['Приход'], r['Уход'], config);

    const stampDate =
      parseStamp(r['Приход'])?.date ?? parseStamp(r['Уход'])?.date ?? fallbackDate ?? null;
    if (!stampDate) {
      warnings.push({
        kind: 'no_date',
        message: `Строка ${rowNo}: нет ни одной отметки со временем, дату определить нечем — строка пропущена («${employeeName}»)`,
        row: rowNo,
      });
      return;
    }
    dates.add(stampDate);

    const status = mapped
      ? statusForTime(arrival.minutes, mapped.criterion, config)
      : 'no_data';

    rows.push({
      date: stampDate,
      shopCode: shop.code,
      shopName: shop.name,
      employeeName,
      role: role ?? '',
      criterion: mapped?.criterion ?? null,
      trainee: mapped?.trainee ?? false,
      homeShopCode: homeShop?.code ?? null,
      arrivalMinutes: arrival.minutes,
      arrivalSource: arrival.source,
      rawArrival: r['Приход'] == null ? null : String(r['Приход']),
      rawDeparture: r['Уход'] == null ? null : String(r['Уход']),
      status,
      note: arrival.note,
    });
  });

  return { rows, dates: [...dates].sort(), warnings };
}
