import { google } from 'googleapis';
import { getJwt } from './google-auth';

/**
 * Файлы выгрузок заменяются целиком, а не дописываются: ищем в папке по
 * подстроке имени и берём самую свежую версию по modifiedTime.
 */
export interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string;
}

export async function findLatestFile(
  folderId: string,
  namePattern: string,
): Promise<DriveFile | null> {
  const drive = google.drive({ version: 'v3', auth: getJwt() });

  const res = await drive.files.list({
    q: `'${folderId}' in parents and name contains '${escapeQuery(namePattern)}' and trashed = false`,
    orderBy: 'modifiedTime desc',
    pageSize: 10,
    fields: 'files(id, name, modifiedTime)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const file = res.data.files?.[0];
  if (!file?.id || !file.name) return null;
  return { id: file.id, name: file.name, modifiedTime: file.modifiedTime ?? '' };
}

export async function downloadFile(fileId: string): Promise<Buffer> {
  const drive = google.drive({ version: 'v3', auth: getJwt() });
  const res = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' },
  );
  return Buffer.from(res.data as ArrayBuffer);
}

/** В запросах Drive одинарная кавычка экранируется обратным слешем. */
function escapeQuery(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
