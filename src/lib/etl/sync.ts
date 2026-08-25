import { findLatestFile, downloadFile } from '../connectors/google-drive';
import { readShowcaseSheet } from '../connectors/google-sheets';
import { runAttendanceJob, type AttendanceJobResult } from './attendance-job';
import { runShowcaseJob, type ShowcaseJobResult } from './showcase-job';

/** Живой синк с Google Диском: качаем последние версии обеих выгрузок. */
export async function syncAttendanceFromDrive(): Promise<AttendanceJobResult> {
  const folderId = required('GOOGLE_DRIVE_FOLDER_ID');
  const employeesPattern = process.env.DRIVE_EMPLOYEES_FILE_PATTERN ?? 'выходы';
  const driversPattern = process.env.DRIVE_DRIVERS_FILE_PATTERN ?? 'водител';

  const [employees, drivers] = await Promise.all([
    findLatestFile(folderId, employeesPattern),
    findLatestFile(folderId, driversPattern),
  ]);

  if (!employees && !drivers) {
    throw new Error(
      `В папке ${folderId} не найдено файлов по маскам «${employeesPattern}» и «${driversPattern}»`,
    );
  }

  const sources = [];
  for (const f of [employees, drivers]) {
    if (!f) continue;
    sources.push({ label: `${f.name} (${f.modifiedTime})`, buffer: await downloadFile(f.id) });
  }

  return runAttendanceJob(sources);
}

/** Живой синк наполненности витрин из Google Таблицы. */
export async function syncShowcaseFromSheets(): Promise<ShowcaseJobResult> {
  const spreadsheetId = required('GOOGLE_SHEETS_SPREADSHEET_ID');
  const sheetName = process.env.SHOWCASE_SHEET_NAME ?? 'Наполнение';
  const range = process.env.SHOWCASE_SHEET_RANGE ?? 'A1:ZZ200';

  const raw = await readShowcaseSheet(spreadsheetId, sheetName, range);
  return runShowcaseJob(raw, `${spreadsheetId}!${sheetName}`);
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Не задана переменная окружения ${name}. См. .env.example.`);
  return v;
}
