// Read-only Google Drive access for the creatives folder. Calls go straight from the browser to
// the Drive API (it allows CORS), not through a Vercel function: creatives weigh 20–50 MB and
// Vercel functions cap bodies at 4.5 MB. The Drive scope is requested on demand, like DV360's.
// The agency folder lives in a shared drive, so every call needs the `supportsAllDrives` flags.

import { DRIVE_FOLDER_MIME, DriveEntry, isJunkFolder } from './driveFolders';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const TOKEN_STORAGE_KEY = 'drive_token';
const API = 'https://www.googleapis.com/drive/v3';
const FILE_FIELDS = 'id,name,mimeType,size,modifiedTime,imageMediaMetadata(width,height),videoMediaMetadata(width,height,durationMillis)';
// Deeper levels are not expected (root/País/subfolder/files); this only guards against loops.
const MAX_DEPTH = 4;

const readStoredToken = (): string | null => {
  try {
    const raw = sessionStorage.getItem(TOKEN_STORAGE_KEY);
    if (!raw) return null;
    const { token, expiresAt } = JSON.parse(raw);
    return Date.now() < expiresAt ? token : null;
  } catch {
    return null;
  }
};

export const clearDriveToken = () => {
  try {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
};

/** Returns a valid Drive token, opening Google's consent popup only when there is none. */
export const getDriveToken = (clientId: string): Promise<string> => {
  const stored = readStoredToken();
  if (stored) return Promise.resolve(stored);

  return new Promise((resolve, reject) => {
    const oauth2 = (window as any).google?.accounts?.oauth2;
    if (!oauth2) {
      reject(new Error('Google Identity Services no está cargado. Recarga la página.'));
      return;
    }
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (response: any) => {
        if (response.error) {
          reject(new Error(`No se concedió acceso a Google Drive (${response.error}).`));
          return;
        }
        const expiresAt = Date.now() + (Number(response.expires_in || 3600) - 60) * 1000;
        try {
          sessionStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify({ token: response.access_token, expiresAt }));
        } catch {
          // ignore storage errors
        }
        resolve(response.access_token);
      },
      error_callback: (err: any) => reject(new Error(`Ventana de Google cerrada o bloqueada (${err?.type || 'error'}).`)),
    });
    client.requestAccessToken();
  });
};

const driveFetch = async (token: string, path: string, params: Record<string, string>) => {
  const qs = new URLSearchParams({ supportsAllDrives: 'true', ...params }).toString();
  const res = await fetch(`${API}/${path}?${qs}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) clearDriveToken();
    const detail = data?.error?.message || res.statusText;
    const hint = res.status === 404
      ? ' Comprueba el enlace y que la carpeta está compartida contigo.'
      : res.status === 403 ? ' ¿Está activada la Google Drive API en el proyecto de Google Cloud?' : '';
    throw new Error(`Drive ${res.status}: ${detail}.${hint}`);
  }
  return res;
};

export const getDriveFolder = async (token: string, folderId: string) => {
  const data = await (await driveFetch(token, `files/${folderId}`, { fields: 'id,name,mimeType' })).json();
  if (data.mimeType !== DRIVE_FOLDER_MIME) throw new Error(`«${data.name}» no es una carpeta de Drive.`);
  return { id: String(data.id), name: String(data.name) };
};

const listChildren = async (token: string, folderId: string): Promise<any[]> => {
  const items: any[] = [];
  let pageToken: string | undefined;
  do {
    const params: Record<string, string> = {
      q: `'${folderId}' in parents and trashed = false`,
      fields: `nextPageToken,files(${FILE_FIELDS})`,
      pageSize: '1000',
      includeItemsFromAllDrives: 'true',
    };
    if (pageToken) params.pageToken = pageToken;
    const data = await (await driveFetch(token, 'files', params)).json();
    items.push(...(data.files || []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return items;
};

/** Every file and folder under `folderId`, with its folder path relative to it. */
export const listDriveTree = async (token: string, folderId: string, path: string[] = []): Promise<DriveEntry[]> => {
  const entries: DriveEntry[] = [];
  for (const item of await listChildren(token, folderId)) {
    entries.push({
      id: String(item.id),
      name: String(item.name),
      mimeType: String(item.mimeType),
      path,
      bytes: item.size ? Number(item.size) : undefined,
      modifiedTime: item.modifiedTime,
      image: item.imageMediaMetadata,
      video: item.videoMediaMetadata,
    });
    if (item.mimeType === DRIVE_FOLDER_MIME && path.length < MAX_DEPTH && !isJunkFolder(String(item.name))) {
      entries.push(...await listDriveTree(token, item.id, [...path, String(item.name)]));
    }
  }
  return entries;
};

/** Downloads a file's content (used for HTML5 zips and, later, for the upload to CM360). */
export const downloadDriveFile = async (token: string, fileId: string): Promise<Blob> =>
  (await driveFetch(token, `files/${fileId}`, { alt: 'media' })).blob();
