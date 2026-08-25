/**
 * Ручной запуск Job #2 (наполненность витрин из Google Таблицы).
 *   npm run etl:showcase
 */
import { syncShowcaseFromSheets } from '../src/lib/etl/sync';

syncShowcaseFromSheets()
  .then((r) => {
    console.log(`Записано значений: ${r.rows}, пропущено: ${r.skipped}`);
    for (const w of r.warnings.slice(0, 20)) console.log(`  · ${w}`);
  })
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
