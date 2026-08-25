import { google } from 'googleapis';
import type { JWT } from 'google-auth-library';

/**
 * Один сервис-аккаунт на Диск и Таблицы (обоснование выбора Google вместо
 * Яндекс Диска — в README). Доступ только на чтение.
 */
const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
];

export class GoogleCredentialsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleCredentialsError';
  }
}

export function serviceAccountEmail(): string {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  if (!email) {
    throw new GoogleCredentialsError(
      'Не задан GOOGLE_SERVICE_ACCOUNT_EMAIL. См. .env.example.',
    );
  }
  return email;
}

export function getJwt(): JWT {
  const email = serviceAccountEmail();
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;
  if (!rawKey) {
    throw new GoogleCredentialsError('Не задан GOOGLE_PRIVATE_KEY. См. .env.example.');
  }

  // В .env перевод строки хранится как \n — возвращаем настоящие переносы.
  const key = rawKey.replace(/\\n/g, '\n');

  return new google.auth.JWT({ email, key, scopes: SCOPES });
}
