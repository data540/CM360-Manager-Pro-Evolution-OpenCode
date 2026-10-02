// Reads the trafficking sheet (Eulerian tracking template) the user exports per country or for
// all countries: one row per media outlet ("soporte") and banner format, with its landing and its
// Eulerian click URL. The layout is not fixed, so columns are found by their header labels and
// the header row is searched for (the template has ~20 rows of notes above it).

import { unzipSync } from 'fflate';
import { normalizeLabel } from './markets';

export interface SheetRow {
  /** 1-based row number in the original file, for messages. */
  rowNumber: number;
  site: string;
  campaign: string;
  location: string;
  banner: string;
  /** Normalized `WxH`, e.g. `300x250`; `1x1` is the template's value for CTV/video. */
  format: string;
  landingUrl: string;
  clickUrl: string;
  impressionTag: string;
  /** Country code found in the campaign name (`TimetoFly_SEP26_ES-ES` → `ES`). */
  country?: string;
  warnings: string[];
}

export interface SheetParseResult {
  rows: SheetRow[];
  /** Problems with the file itself (no header found, missing columns…). */
  errors: string[];
}

type Column = 'site' | 'campaign' | 'location' | 'banner' | 'format' | 'landing' | 'click' | 'impression';

// Each column is identified by the start of its (normalized) header label.
const COLUMN_LABELS: Record<Column, string[]> = {
  site: ['nombre de soporte', 'soporte'],
  campaign: ['nombre de campana', 'campana'],
  location: ['ubicacion'],
  banner: ['banner'],
  format: ['formato del banner', 'formato'],
  landing: ['url de destino', 'landing'],
  click: ['url de clic (por redireccion)', 'url de clic'],
  impression: ['url de impresion'],
};
const REQUIRED: Column[] = ['site', 'format'];

// --- CSV / XLSX to a grid of strings --------------------------------------------------------

const detectDelimiter = (text: string) => {
  const sample = text.split(/\r?\n/).slice(0, 40).join('\n');
  const counts = [';', ',', '\t'].map((d) => [d, sample.split(d).length] as const);
  return counts.sort((a, b) => b[1] - a[1])[0][0];
};

/** RFC 4180-style CSV: quoted fields may contain the delimiter, newlines and `""` escapes. */
export const parseCsv = (text: string): string[][] => {
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delimiter) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
};

const xmlDecode = (value: string) =>
  value
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');

const columnIndex = (ref: string) =>
  ref.replace(/\d+$/, '').split('').reduce((acc, ch) => acc * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** Minimal .xlsx reader: first worksheet, shared and inline strings, cell values as text. */
export const parseXlsx = (bytes: Uint8Array): string[][] => {
  const files = unzipSync(bytes, { filter: (f) => /^xl\/(sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/.test(f.name) });
  const decoder = new TextDecoder();
  const shared = files['xl/sharedStrings.xml']
    ? [...decoder.decode(files['xl/sharedStrings.xml']).matchAll(/<si>([\s\S]*?)<\/si>/g)]
      .map((m) => xmlDecode([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')))
    : [];
  const sheetName = Object.keys(files).filter((n) => n.startsWith('xl/worksheets/')).sort()[0];
  if (!sheetName) return [];
  const rows: string[][] = [];
  for (const rowMatch of decoder.decode(files[sheetName]).matchAll(/<row[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const row: string[] = [];
    for (const cell of (rowMatch[1] || '').matchAll(/<c\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = cell[1].match(/r="([A-Z]+\d+)"/)?.[1];
      const type = cell[1].match(/t="(\w+)"/)?.[1];
      const body = cell[2] || '';
      const raw = type === 'inlineStr'
        ? [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')
        : body.match(/<v>([\s\S]*?)<\/v>/)?.[1] || '';
      const value = type === 's' ? shared[Number(raw)] || '' : xmlDecode(raw);
      row[ref ? columnIndex(ref) : row.length] = value;
    }
    rows.push(Array.from(row, (v) => v ?? ''));
  }
  return rows;
};

// --- Grid to rows ---------------------------------------------------------------------------

const normalizeFormat = (value: string) => {
  const match = value.match(/(\d+)\s*[x×]\s*(\d+)/i);
  return match ? `${Number(match[1])}x${Number(match[2])}` : value.trim();
};

/** `TimetoFly_SEP26_ES-ES` → `ES`; `Ruta_GVA-CH-EN` → `CH` (country first, then language). */
export const countryFromCampaign = (campaign: string): string | undefined =>
  campaign.match(/(?:^|[_-])([A-Za-z]{2})-[A-Za-z]{2}\s*$/)?.[1]?.toUpperCase();

const findHeader = (grid: string[][]) => {
  for (let r = 0; r < Math.min(grid.length, 60); r++) {
    const labels = grid[r].map((cell) => normalizeLabel(cell));
    const columns: Partial<Record<Column, number>> = {};
    (Object.keys(COLUMN_LABELS) as Column[]).forEach((col) => {
      const index = labels.findIndex((label) => COLUMN_LABELS[col].some((prefix) => label.startsWith(prefix)));
      if (index >= 0) columns[col] = index;
    });
    if (REQUIRED.every((col) => columns[col] !== undefined)) return { headerRow: r, columns };
  }
  return undefined;
};

// Placeholder row of the template (`NOMBRE_SOPORTE`, `FORMATO_BANNER`…) and leftover formula rows.
const isPlaceholder = (value: string) => /^[A-ZÁÉÍÓÚÑ_]+$/.test(value.trim()) && value.includes('_');

export const parseTrafficSheet = (grid: string[][]): SheetParseResult => {
  const header = findHeader(grid);
  if (!header) {
    return { rows: [], errors: ['No se encontró la fila de cabecera (columnas «Nombre de soporte» y «Formato del banner»).'] };
  }
  const { headerRow, columns } = header;
  const cell = (row: string[], col: Column) => (columns[col] !== undefined ? (row[columns[col]!] || '') : '');
  const errors: string[] = [];
  if (columns.click === undefined && columns.landing === undefined) {
    errors.push('No hay columna de URL de clic ni de URL de destino: no se podrán asignar landings.');
  }

  const rows: SheetRow[] = [];
  grid.slice(headerRow + 1).forEach((raw, offset) => {
    const site = cell(raw, 'site').trim();
    const format = cell(raw, 'format').trim();
    if (!site || !format || isPlaceholder(site)) return;

    const warnings: string[] = [];
    const rawLanding = cell(raw, 'landing');
    const rawClick = cell(raw, 'click');
    if (rawLanding !== rawLanding.trim()) warnings.push('La URL de destino tiene espacios al principio o al final.');
    if (/%20(&|$)/.test(rawClick.trim())) warnings.push('La URL de clic lleva un espacio codificado (%20) al final de un parámetro.');
    if (!rawClick.trim() && !rawLanding.trim()) warnings.push('Fila sin URL de clic ni de destino.');
    else if (rawClick.trim() && !/^https?:\/\//i.test(rawClick.trim())) warnings.push('La URL de clic no es válida.');
    const normalizedFormat = normalizeFormat(format);
    if (!/^\d+x\d+$/.test(normalizedFormat)) warnings.push(`Formato «${format}» no es del tipo númeroxnúmero.`);

    const campaign = cell(raw, 'campaign').trim();
    rows.push({
      rowNumber: headerRow + offset + 2,
      site,
      campaign,
      location: cell(raw, 'location').trim(),
      banner: cell(raw, 'banner').trim(),
      format: normalizedFormat,
      landingUrl: rawLanding.trim(),
      clickUrl: rawClick.trim(),
      impressionTag: cell(raw, 'impression').trim(),
      country: countryFromCampaign(campaign),
      warnings,
    });
  });

  if (rows.length === 0) errors.push('La hoja no tiene filas con soporte y formato.');
  return { rows, errors };
};

/** Reads a .csv or .xlsx file chosen by the user. */
export const readTrafficSheetFile = async (file: File): Promise<SheetParseResult> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (/\.xlsx$/i.test(file.name)) return parseTrafficSheet(parseXlsx(bytes));
  if (/\.xls$/i.test(file.name)) {
    return { rows: [], errors: ['El formato .xls antiguo no se puede leer: guarda el archivo como .xlsx o .csv.'] };
  }
  // CSV exported by Excel in Spain is usually Windows-1252, not UTF-8.
  let text = new TextDecoder('utf-8').decode(bytes);
  if (text.includes('�')) text = new TextDecoder('windows-1252').decode(bytes);
  return parseTrafficSheet(parseCsv(text));
};
