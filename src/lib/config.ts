import fs from 'node:fs';
import path from 'node:path';
import type { ThresholdConfig } from './types';
import bundled from '../../config/thresholds.json';

const CONFIG_PATH =
  process.env.RADAR_CONFIG_PATH ??
  path.join(process.cwd(), 'config', 'thresholds.json');

let cached: { mtimeMs: number; value: ThresholdConfig } | null = null;

/**
 * Пороги живут в JSON, а не в компонентах: часть цифр снята с рукописного листа
 * и будет правиться.
 *
 * Файл одновременно вкомпилирован в сборку и читается с диска. Импорт нужен,
 * чтобы конфиг гарантированно доехал до serverless-функции (трейсер не видит
 * путь, собранный в рантайме); чтение с диска — чтобы правка порогов на своём
 * сервере подхватывалась без пересборки.
 */
export function loadConfig(): ThresholdConfig {
  try {
    // turbopackIgnore: путь берётся из окружения, статически его не разрешить.
    const stat = fs.statSync(/* turbopackIgnore: true */ CONFIG_PATH);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.value;

    const raw = JSON.parse(
      fs.readFileSync(/* turbopackIgnore: true */ CONFIG_PATH, 'utf8'),
    ) as ThresholdConfig;
    cached = { mtimeMs: stat.mtimeMs, value: raw };
    return raw;
  } catch {
    // Файловой системы с конфигом нет (serverless) — работаем со вшитой копией.
    return bundled as unknown as ThresholdConfig;
  }
}

export function configPath(): string {
  return CONFIG_PATH;
}
