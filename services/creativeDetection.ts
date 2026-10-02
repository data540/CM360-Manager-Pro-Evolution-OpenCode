// Format detection for creatives picked from a local folder. Everything runs in the browser:
// nothing is uploaded until the user approves the trafficking plan.

import { unzipSync } from 'fflate';

export type CreativeKind = 'image' | 'html5' | 'video' | 'unsupported';
export type SizeSource = 'file' | 'name' | 'none';

export interface DetectedFile {
  /** Stable per file: name + bytes + last modified. */
  id: string;
  fileName: string;
  /** Path inside the picked folder, e.g. `Suiza/300x250/banner.zip`. */
  relativePath: string;
  bytes: number;
  kind: CreativeKind;
  /** `WxH` used for matching and naming; for video it's the video resolution. */
  size?: string;
  sizeSource: SizeSource;
  sizeFromName?: string;
  /** Size read from the file itself differs from the one in the file name. */
  sizeMismatch: boolean;
  durationSec?: number;
  device?: 'desktop' | 'mobile' | 'tablet' | 'ctv';
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;
const VIDEO_EXT = /\.(mp4|mov|webm|m4v)$/i;
const ZIP_EXT = /\.zip$/i;
const DEVICE_TOKENS = ['desktop', 'mobile', 'tablet', 'ctv'] as const;

export const fileId = (file: { name: string; size: number; lastModified: number }) =>
  `${file.name}|${file.size}|${file.lastModified}`;

export const classifyFile = (fileName: string, mimeType = ''): CreativeKind => {
  if (VIDEO_EXT.test(fileName) || mimeType.startsWith('video/')) return 'video';
  if (ZIP_EXT.test(fileName) || mimeType === 'application/zip' || mimeType === 'application/x-zip-compressed') return 'html5';
  if (IMAGE_EXT.test(fileName) || /^image\/(png|jpe?g|gif|webp)$/.test(mimeType)) return 'image';
  return 'unsupported';
};

export const normalizeSize = (width: number, height: number) => `${Math.round(width)}x${Math.round(height)}`;

/** First `WxH` token in a file name, e.g. `banner_300x250_v2.zip` → `300x250`. */
export const sizeFromFileName = (fileName: string): string | undefined => {
  const match = fileName.match(/(?:^|[^\d])(\d{2,4})\s*[x×]\s*(\d{2,4})(?:[^\d]|$)/i);
  return match ? normalizeSize(Number(match[1]), Number(match[2])) : undefined;
};

export const deviceFromFileName = (fileName: string): DetectedFile['device'] => {
  const tokens = fileName.toLowerCase().replace(/\.[^.]+$/, '').split(/[^a-z0-9]+/);
  return DEVICE_TOKENS.find((d) => tokens.includes(d));
};

/** Reads `<meta name="ad.size" content="width=300,height=250">` from an HTML5 banner. */
export const parseAdSizeMeta = (html: string): string | undefined => {
  const meta = html.match(/<meta[^>]+name\s*=\s*["']ad\.size["'][^>]*>/i)?.[0];
  if (!meta) return undefined;
  const content = meta.match(/content\s*=\s*["']([^"']+)["']/i)?.[1] || '';
  const width = content.match(/width\s*=\s*(\d+)/i)?.[1];
  const height = content.match(/height\s*=\s*(\d+)/i)?.[1];
  return width && height ? normalizeSize(Number(width), Number(height)) : undefined;
};

/** Size declared by an HTML5 zip: the shallowest `.html` file that carries an `ad.size` meta. */
export const readHtml5Size = (zipBytes: Uint8Array): string | undefined => {
  const entries = unzipSync(zipBytes, {
    filter: (f) => /\.html?$/i.test(f.name) && !f.name.startsWith('__MACOSX/'),
  });
  const htmlFiles = Object.keys(entries).sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  const decoder = new TextDecoder();
  for (const name of htmlFiles) {
    const size = parseAdSizeMeta(decoder.decode(entries[name]));
    if (size) return size;
  }
  return undefined;
};

// --- Browser-only readers -------------------------------------------------------------------

const imageSize = (file: File): Promise<string | undefined> =>
  new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img.naturalWidth > 0 ? normalizeSize(img.naturalWidth, img.naturalHeight) : undefined);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(undefined);
    };
    img.src = url;
  });

const videoMetadata = (file: File): Promise<{ size?: string; durationSec?: number }> =>
  new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve({
        size: video.videoWidth > 0 ? normalizeSize(video.videoWidth, video.videoHeight) : undefined,
        durationSec: Number.isFinite(video.duration) ? Math.round(video.duration * 10) / 10 : undefined,
      });
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({});
    };
    video.src = url;
  });

/** Detects kind, size, duration and device of one file without uploading it. */
export const detectFile = async (file: File): Promise<DetectedFile> => {
  const kind = classifyFile(file.name, file.type);
  const sizeFromName = sizeFromFileName(file.name);
  let sizeFromFile: string | undefined;
  let durationSec: number | undefined;

  try {
    if (kind === 'image') sizeFromFile = await imageSize(file);
    else if (kind === 'html5') sizeFromFile = readHtml5Size(new Uint8Array(await file.arrayBuffer()));
    else if (kind === 'video') ({ size: sizeFromFile, durationSec } = await videoMetadata(file));
  } catch {
    // Unreadable file: fall back to the size in its name.
  }

  const size = sizeFromFile || sizeFromName;
  return {
    id: fileId(file),
    fileName: file.name,
    relativePath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
    bytes: file.size,
    kind,
    size,
    sizeSource: sizeFromFile ? 'file' : sizeFromName ? 'name' : 'none',
    sizeFromName,
    sizeMismatch: !!(sizeFromFile && sizeFromName && sizeFromFile !== sizeFromName),
    durationSec,
    device: deviceFromFileName(file.name),
  };
};
