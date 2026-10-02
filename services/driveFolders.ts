// Pure logic for the creatives folder shared on Google Drive: which country (market) each file
// belongs to and what can be detected from Drive's metadata alone, without downloading.
//
// Accepted layouts (the agency doesn't always follow the same one):
//   root/<País>/<files>             ← usual
//   root/<wrapper>/<País>/<files>   ← as received: an unzipped "Banners RD Y Suiza" folder
//   root/<País>/<anything>/<files>  ← e.g. subfolders per size; a size in the folder name helps
//   <País>/<files>                  ← link straight to one country folder
//   root/<files>                    ← no country folder: the chosen campaign decides the market
// The country folder is the first folder of the path that names a known country, at any depth.
// Zips unpacked on a Mac bring `__MACOSX/` copies and `._*` files: those are ignored.

import { classifyFile, DetectedFile, deviceFromFileName, normalizeSize, sizeFromFileName } from './creativeDetection';
import { detectMarketFromFolder, Market } from './markets';

export const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';

export interface DriveEntry {
  id: string;
  name: string;
  mimeType: string;
  /** Folder names from the root (excluded) down to the file's parent. */
  path: string[];
  bytes?: number;
  modifiedTime?: string;
  image?: { width?: number; height?: number };
  video?: { width?: number; height?: number; durationMillis?: string | number };
}

export interface CountryGroup {
  /** Undefined for files with no country folder, or a folder name that isn't a known country. */
  market?: Market;
  /** Folder that names the country; empty for files at the root. */
  folderName: string;
  files: DetectedFile[];
}

export interface DriveFolderResult {
  groups: CountryGroup[];
  /** Folders holding files outside any country folder (their files are kept apart). */
  unknownFolders: string[];
  /** Files skipped as system junk (`__MACOSX`, `._*`, `.DS_Store`…). */
  ignored: number;
}

const JUNK_FILES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);

/** Folders not worth listing in Drive: Mac resource forks. */
export const isJunkFolder = (name: string) => name === '__MACOSX';

export const isJunkEntry = (entry: Pick<DriveEntry, 'name' | 'path'>) =>
  entry.path.some(isJunkFolder) || isJunkFolder(entry.name)
  || entry.name.startsWith('._') || JUNK_FILES.has(entry.name.toLowerCase());

/** Folder ID from a Drive link (`…/folders/<id>`, `…?id=<id>`) or a bare ID. */
export const parseDriveFolderId = (input: string): string | undefined => {
  const value = input.trim();
  const fromPath = value.match(/\/folders\/([A-Za-z0-9_-]{10,})/)?.[1];
  if (fromPath) return fromPath;
  const fromQuery = value.match(/[?&]id=([A-Za-z0-9_-]{10,})/)?.[1];
  if (fromQuery) return fromQuery;
  return /^[A-Za-z0-9_-]{10,}$/.test(value) ? value : undefined;
};

/** What Drive's metadata tells about a file; HTML5 zips still need a download to read `ad.size`. */
export const detectDriveFile = (entry: DriveEntry): DetectedFile => {
  const kind = classifyFile(entry.name, entry.mimeType);
  const sizeFromName = sizeFromFileName(entry.name)
    // A subfolder named after a size (`300x250`) counts as part of the name.
    ?? [...entry.path].reverse().map(sizeFromFileName).find(Boolean);
  const media = kind === 'image' ? entry.image : kind === 'video' ? entry.video : undefined;
  const sizeFromFile = media?.width && media?.height ? normalizeSize(media.width, media.height) : undefined;
  const size = sizeFromFile || sizeFromName;
  const durationMillis = Number(entry.video?.durationMillis);
  return {
    id: entry.id,
    fileName: entry.name,
    relativePath: [...entry.path, entry.name].join('/'),
    bytes: entry.bytes ?? 0,
    kind,
    size,
    sizeSource: sizeFromFile ? 'file' : sizeFromName ? 'name' : 'none',
    sizeFromName,
    sizeMismatch: !!(sizeFromFile && sizeFromName && sizeFromFile !== sizeFromName),
    durationSec: durationMillis > 0 ? Math.round(durationMillis / 1000) : undefined,
    device: deviceFromFileName(entry.name),
  };
};

/** Groups the files of the shared folder by country. */
export const groupDriveFiles = (rootName: string, entries: DriveEntry[]): DriveFolderResult => {
  const allFiles = entries.filter((e) => e.mimeType !== DRIVE_FOLDER_MIME);
  const files = allFiles.filter((e) => !isJunkEntry(e));
  const ignored = allFiles.length - files.length;
  const rootMarket = detectMarketFromFolder(rootName);
  if (rootMarket) {
    return { groups: [{ market: rootMarket, folderName: rootName, files: files.map(detectDriveFile) }], unknownFolders: [], ignored };
  }

  // Keyed by market code for country folders (two folders of one country merge), by the
  // first folder of the path otherwise.
  const groups = new Map<string, CountryGroup>();
  files.forEach((entry) => {
    const countryIndex = entry.path.findIndex((segment) => detectMarketFromFolder(segment));
    const market = countryIndex >= 0 ? detectMarketFromFolder(entry.path[countryIndex]) : undefined;
    const folderName = market ? entry.path[countryIndex] : entry.path[0] ?? '';
    const key = market ? `market:${market.code}` : `folder:${folderName}`;
    const group = groups.get(key) || { market, folderName, files: [] };
    group.files.push(detectDriveFile(entry));
    groups.set(key, group);
  });

  const sorted = [...groups.values()]
    .sort((a, b) => Number(!a.market) - Number(!b.market) || a.folderName.localeCompare(b.folderName));
  return {
    groups: sorted,
    unknownFolders: sorted.filter((g) => g.folderName && !g.market).map((g) => g.folderName),
    ignored,
  };
};

/** The group to traffic for a campaign's market: its country folder, else the root's loose files. */
export const groupForMarket = (result: DriveFolderResult, market: Market | undefined) =>
  (market && result.groups.find((g) => g.market?.code === market.code))
  || result.groups.find((g) => g.folderName === '');
