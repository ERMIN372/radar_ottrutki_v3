/**
 * Ручной запуск Job #1 (отметки с Google Диска).
 *
 *   npm run etl:attendance              — скачать и обработать
 *   npm run etl:attendance -- --whoami  — показать email сервис-аккаунта
 *   npm run etl:attendance -- --file a.xls --file b.xls  — из локальных файлов
 */
import fs from 'node:fs';
import path from 'node:path';
import { serviceAccountEmail } from '../src/lib/connectors/google-auth';
import { runAttendanceJob } from '../src/lib/etl/attendance-job';
import { syncAttendanceFromDrive } from '../src/lib/etl/sync';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--whoami')) {
    console.log(serviceAccountEmail());
    console.log('\nВыдай этому адресу доступ «Читатель»:');
    console.log('  · на папку Google Диска с выгрузками .xls');
    console.log('  · на Google Таблицу наполненности витрин');
    return;
  }

  const files: string[] = [];
  args.forEach((a, i) => {
    if (a === '--file' && args[i + 1]) files.push(args[i + 1]);
  });

  const result = files.length
    ? runAttendanceJob(
        files.map((f) => ({ label: path.basename(f), buffer: fs.readFileSync(f) })),
      )
    : await syncAttendanceFromDrive();

  console.log(`Строк: ${result.rows}, даты: ${result.dates.join(', ')}`);
  if (result.warnings.length) {
    console.log(`Предупреждений: ${result.warnings.length}`);
    for (const w of result.warnings.slice(0, 20)) console.log(`  · ${w.message}`);
    if (result.warnings.length > 20) console.log(`  … ещё ${result.warnings.length - 20}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
