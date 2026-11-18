// Reads the tracking template sent by the client (Eulerian "NOTAS PARA UN CORRECTO TRAFICADO EN
// DISPLAY", .xlsx or .csv) and turns it into landing rules: support (col C, NOMBRE_SOPORTE) +
// country (code inside col D / F, e.g. BF_Nov26_CO_ES → CO) → "URL de clic (por redirección)".
// The xlsx is read with fflate (it is a zip of XML), so no spreadsheet dependency is needed.

import { unzipSync, strFromU8 } from 'fflate';
import { resolveCountry } from './countryResolver';

export interface TrackingRule {
  /** Row number in the sheet (1-based), for messages. */
  row: number;
  /** File the rule comes from (one file per support is common: up to ~15 files at once). */
  source?: string;
  /** Unique across files: `<source>#<row>`. */
  id?: string;
  support: string;
  /** ISO-like market code, e.g. `CO`. Undefined if no code could be read. */
  country?: string;
  campaignName: string;
  bannerName: string;
  /** "Formato del banner", e.g. `300x250` or `1x1`. */
  format: string;
  clickUrl: string;
}

export interface TrackingSheet {
  rules: TrackingRule[];
  /** Rows with a support but no usable data (shown as warnings). */
  skipped: { row: number; reason: string }[];
  /** xlsx: the sheet the rules were read from. */
  sheetName?: string;
}

// ─── Spreadsheet → rows of strings ────────────────────────────────────────────

const decodeXml = (text: string) =>
  text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

/** Concatenated `<t>` texts of a shared string / inline string (rich text has several). */
const textOf = (xml: string) =>
  decodeXml([...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));

const columnIndex = (ref: string) => {
  const letters = ref.replace(/\d+/g, '').toUpperCase();
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

export interface XlsxSheet {
  name: string;
  hidden: boolean;
  rows: string[][];
}

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];

/** Every worksheet in workbook order, with its name and whether it is hidden. */
const listSheets = (files: Record<string, Uint8Array>) => {
  const workbook = files['xl/workbook.xml'] ? strFromU8(files['xl/workbook.xml']) : '';
  const rels = files['xl/_rels/workbook.xml.rels'] ? strFromU8(files['xl/_rels/workbook.xml.rels']) : '';
  const targets = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id');
    const target = attr(m[0], 'Target');
    if (id && target) targets.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`);
  }
  const sheets = [...workbook.matchAll(/<sheet\b[^>]*>/g)]
    .map((m) => ({
      name: decodeXml(attr(m[0], 'name') || ''),
      hidden: /hidden/i.test(attr(m[0], 'state') || ''),
      path: targets.get(attr(m[0], 'r:id') || '') || '',
    }))
    .filter((s) => files[s.path]);
  if (sheets.length) return sheets;
  return Object.keys(files)
    .filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((path) => ({ name: path, hidden: false, path }));
};

/** All worksheets of an .xlsx (the client template has several, some hidden). */
export const readXlsxSheets = (bytes: Uint8Array): XlsxSheet[] => {
  const files = unzipSync(bytes);
  const sheets = listSheets(files);
  if (!sheets.length) throw new Error('El archivo no tiene ninguna hoja.');
  const shared = files['xl/sharedStrings.xml']
    ? [...strFromU8(files['xl/sharedStrings.xml']).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]))
    : [];
  return sheets.map((s) => ({ name: s.name, hidden: s.hidden, rows: readSheetRows(strFromU8(files[s.path]), shared) }));
};

/** Rows of the first worksheet (kept for simple files and tests). */
export const readXlsxRows = (bytes: Uint8Array): string[][] => readXlsxSheets(bytes)[0].rows;

const readSheetRows = (sheet: string, shared: string[]): string[][] => {
  const rows: string[][] = [];
  // Empty rows may be self-closing (`<row r="5"/>`): they must not swallow the next row.
  for (const rowMatch of sheet.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowNumber = Number(rowMatch[1].match(/\br="(\d+)"/)?.[1]) || rows.length + 1;
    const cells: string[] = [];
    for (const cell of (rowMatch[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1];
      const body = cell[2] || '';
      const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
      const type = attrs.match(/\bt="([^"]+)"/)?.[1];
      const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let value = '';
      if (type === 's' && raw !== undefined) value = shared[Number(raw)] ?? '';
      else if (type === 'inlineStr') value = textOf(body);
      else if (raw !== undefined) value = decodeXml(raw);
      cells[ref ? columnIndex(ref) : cells.length] = value;
    }
    rows[rowNumber - 1] = Array.from(cells, (v) => v ?? '');
  }
  return Array.from(rows, (r) => r ?? []);
};

/** CSV with `;` or `,` separator and `"` quoting (Excel's "CSV UTF-8" export). */
export const readCsvRows = (text: string): string[][] => {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] || '';
  const sep = (firstLine.match(/;/g)?.length || 0) >= (firstLine.match(/,/g)?.length || 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
};

// ─── Rows → landing rules ──────────────────────────────────────────────────────

const norm = (value: string) =>
  (value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const HEADERS = {
  support: ['nombre de soporte'],
  campaign: ['nombre de campana'],
  banner: ['banner'],
  format: ['formato del banner'],
  click: ['url de clic (por redireccion)'],
};
// Columns of the client template, used when the header row is not found.
const FALLBACK = { support: 2, campaign: 3, banner: 5, format: 6, click: 13 };

/** `BF_Nov26_CO_ES` → `CO`: the country is the token before the language. */
/** Country of a campaign / banner name (see countryResolver: CO_ES, BEL_EN, SUI-EN, USA-EN…). */
export const countryFromName = (name: string, knownCodes?: Set<string>): string | undefined => {
  const code = resolveCountry(name);
  return code && (!knownCodes || knownCodes.has(code)) ? code : undefined;
};

export const parseTrackingRows = (rows: string[][], knownCodes?: Set<string>): TrackingSheet => {
  const headerIndex = rows.findIndex((r) => r.some((c) => norm(c) === HEADERS.support[0]) && r.some((c) => norm(c).startsWith('url de clic (por redireccion')));
  const header = headerIndex >= 0 ? rows[headerIndex].map(norm) : [];
  const col = (key: keyof typeof HEADERS) => {
    const i = header.findIndex((h) => HEADERS[key].some((name) => h === name || (key === 'click' && h.startsWith(name.slice(0, -1)))));
    return i >= 0 ? i : FALLBACK[key];
  };
  const idx = { support: col('support'), campaign: col('campaign'), banner: col('banner'), format: col('format'), click: col('click') };

  const rules: TrackingRule[] = [];
  const skipped: TrackingSheet['skipped'] = [];
  rows.forEach((r, i) => {
    if (i <= headerIndex) return;
    const cell = (k: keyof typeof idx) => (r[idx[k]] || '').trim();
    const support = cell('support');
    // Template rows: placeholders (NOMBRE_SOPORTE…) or empty lines with "URL NO VÁLIDA".
    if (!support || /^NOMBRE_SOPORTE$/i.test(support)) return;
    const clickUrl = cell('click');
    const row = i + 1;
    if (!/^https?:\/\//i.test(clickUrl)) {
      skipped.push({ row, reason: `Fila ${row} (${support}): la URL de clic no es válida.` });
      return;
    }
    const campaignName = cell('campaign');
    const bannerName = cell('banner');
    const country = countryFromName(campaignName, knownCodes) || countryFromName(bannerName, knownCodes);
    if (!country) skipped.push({ row, reason: `Fila ${row} (${support}): «${campaignName || bannerName}» no indica ningún país (como BEL_EN o CO_ES), así que su URL no se aplica a ninguna campaña.` });
    rules.push({ row, support, country, campaignName, bannerName, format: cell('format').toLowerCase(), clickUrl });
  });
  return { rules, skipped };
};

/**
 * The tracking rows can be in any sheet: the client template starts with hidden ones ("Versión 4",
 * "Afiliación"…) and the real one is visible. Visible sheets first; the first with rules wins.
 */
export const parseTrackingXlsx = (bytes: Uint8Array, knownCodes?: Set<string>): TrackingSheet => {
  const sheets = readXlsxSheets(bytes);
  const ordered = [...sheets.filter((s) => !s.hidden), ...sheets.filter((s) => s.hidden)];
  for (const sheet of ordered) {
    const parsed = parseTrackingRows(sheet.rows, knownCodes);
    if (parsed.rules.length) return { ...parsed, sheetName: sheet.name };
  }
  return { rules: [], skipped: [] };
};

export const readTrackingFile = async (file: File, knownCodes?: Set<string>): Promise<TrackingSheet> =>
  readTrackingBytes(new Uint8Array(await file.arrayBuffer()), file.name, knownCodes);

/** Same as readTrackingFile, for bytes downloaded from Drive. */
export const readTrackingBytes = (bytes: Uint8Array, fileName: string, knownCodes?: Set<string>): TrackingSheet => {
  const file = { name: fileName };
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (isZip) return parseTrackingXlsx(bytes, knownCodes);
  if (/\.xls$/i.test(file.name)) throw new Error('El formato .xls antiguo no se admite: guarda el archivo como .xlsx.');
  let text = new TextDecoder('utf-8').decode(bytes);
  if (text.includes('�')) text = new TextDecoder('windows-1252').decode(bytes);
  return parseTrackingRows(readCsvRows(text), knownCodes);
};

// ─── Matching a placement to its rule ─────────────────────────────────────────

const compact = (value: string) => norm(value).replace(/[^a-z0-9]/g, '');

/**
 * The placement belongs to the support only when the name is exactly the same (case and accents
 * aside): a token of the placement name, or the whole CM360 site name. No partial matches.
 */
export const placementMatchesSupport = (placementName: string, siteName: string | undefined, support: string) => {
  const target = compact(support);
  if (!target) return false;
  if (placementName.toLowerCase().split(/[^a-z0-9]+/).some((t) => t === target)) return true;
  const site = compact(siteName || '');
  return !!site && site === target;
};

/** A placement token or site name that looks like the support (one contains the other), for error hints. */
export const similarSupportName = (
  support: string,
  placements: { name: string; siteName?: string }[],
): string | undefined => {
  const target = compact(support);
  if (target.length < 3) return undefined;
  const candidates = new Set<string>();
  placements.forEach((p) => {
    p.name.toLowerCase().split(/[^a-z0-9]+/).forEach((t) => candidates.add(t));
    if (p.siteName) candidates.add(p.siteName);
  });
  return [...candidates].find((c) => {
    const value = compact(c);
    return value.length >= 3 && value !== target && (value.includes(target) || target.includes(value));
  });
};

/** Rule for a placement of `country`: same support; a row with the placement's size wins. */
export const findTrackingRule = (
  rules: TrackingRule[],
  country: string | undefined,
  placement: { name: string; size?: string },
  siteName?: string,
): TrackingRule | undefined => {
  const candidates = rules.filter((r) => r.country === country && placementMatchesSupport(placement.name, siteName, r.support));
  return candidates.find((r) => placement.size && r.format === placement.size) || candidates[0];
};

// ─── Several files (often one per support) ────────────────────────────────────

export interface TrackingFile {
  fileName: string;
  sheet: TrackingSheet;
}

/** Stable key of a rule even when several files share row numbers. */
export const ruleKey = (rule: TrackingRule) => rule.id || `${rule.source || ''}#${rule.row}`;

/** `Alkimiads.xlsx · fila 21` (or just `fila 21` for a rule without source). */
export const describeRule = (rule: TrackingRule) => `${rule.source ? `${rule.source} · ` : ''}fila ${rule.row}`;

/** Tags every rule and warning of a parsed file with its file name. */
export const withSource = (fileName: string, sheet: TrackingSheet): TrackingSheet => ({
  ...sheet,
  rules: sheet.rules.map((r) => ({ ...r, source: fileName, id: `${fileName}#${r.row}` })),
  skipped: sheet.skipped.map((s) => ({ ...s, reason: `${fileName}: ${s.reason}` })),
});

export interface MergedTracking {
  rules: TrackingRule[];
  /** Same support + country + format with different URLs (the first one loaded wins). */
  conflicts: string[];
}

/** All rules of all files, in load order, flagging contradictory URLs. */
export const mergeTrackingFiles = (files: TrackingFile[]): MergedTracking => {
  const rules = files.flatMap((f) => f.sheet.rules);
  const firstByKey = new Map<string, TrackingRule>();
  const conflicts: string[] = [];
  rules.forEach((rule) => {
    if (!rule.country) return;
    const key = `${norm(rule.support)}|${rule.country}|${rule.format}`;
    const first = firstByKey.get(key);
    if (!first) firstByKey.set(key, rule);
    else if (first.clickUrl !== rule.clickUrl) {
      conflicts.push(
        `${rule.support} ${rule.country}${rule.format ? ` ${rule.format}` : ''}: URLs distintas en ${describeRule(first)} y ${describeRule(rule)}. Se usa la primera.`,
      );
    }
  });
  return { rules, conflicts };
};
