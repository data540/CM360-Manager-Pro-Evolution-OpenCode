// Pure logic for "Quantcast Nativa": CM360 tag export (+ Title/Description columns) and Drive
// images → native creatives to upload and ad sets to (re)assign. The browser automation that
// executes it lives in server/quantcastNativeRunner.ts; these types are the contract between both.

export const QC_LANGUAGES = ['Spanish', 'English', 'Portuguese', 'French', 'Italian', 'German', 'Dutch'] as const;
export type QcLanguage = (typeof QC_LANGUAGES)[number];

export const LIMITS = { name: 255, title: 100, description: 300, advertiser: 30 };
export const REQUIRED_IMAGE_SIZE = '1000x600';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif'];

export interface NativeRow {
  rowNumber: number;
  placementId: string;
  placementName: string;
  title: string;
  description: string;
  landingUrl: string;
  impressionPixel: string;
  errors: string[];
  warnings: string[];
}

export interface NativeSheetResult {
  rows: NativeRow[];
  errors: string[];
}

type Column = 'placementId' | 'placementName' | 'title' | 'description' | 'click' | 'impression';

const COLUMN_LABELS: Record<Column, string[]> = {
  placementId: ['placement id'],
  placementName: ['placement name'],
  title: ['title', 'titulo'],
  description: ['description', 'descripcion'],
  click: ['click tag', 'click-through url', 'click through url'],
  impression: ['impression tag (image)', 'impression tag'],
};

const normalizeLabel = (value: string) =>
  value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const findHeader = (grid: string[][]) => {
  for (let r = 0; r < Math.min(grid.length, 80); r++) {
    const labels = grid[r].map(normalizeLabel);
    const columns: Partial<Record<Column, number>> = {};
    (Object.keys(COLUMN_LABELS) as Column[]).forEach((col) => {
      const exact = labels.findIndex((l) => COLUMN_LABELS[col].includes(l));
      const index = exact >= 0 ? exact : labels.findIndex((l) => COLUMN_LABELS[col].some((p) => l.startsWith(p)));
      if (index >= 0) columns[col] = index;
    });
    if (columns.placementName !== undefined && (columns.click !== undefined || columns.impression !== undefined)) {
      return { headerRow: r, columns };
    }
  }
  return undefined;
};

/** `<IMG SRC="https://…;dc_tdv=1?" …>` → the SRC value; a bare URL is returned as is. */
export const extractImgSrc = (tag: string): string => {
  const trimmed = tag.trim();
  const match = trimmed.match(/src\s*=\s*["']([^"']+)["']/i);
  if (match) return match[1].trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : '';
};

export const parseNativeSheet = (grid: string[][]): NativeSheetResult => {
  const header = findHeader(grid);
  if (!header) {
    return { rows: [], errors: ['No se encontró la cabecera: hacen falta las columnas «Placement Name» y «Click Tag» / «Impression Tag (image)».'] };
  }
  const { headerRow, columns } = header;
  const errors: string[] = [];
  if (columns.title === undefined) errors.push('Falta la columna «Title».');
  if (columns.description === undefined) errors.push('Falta la columna «Description».');
  if (columns.click === undefined) errors.push('Falta la columna «Click Tag» (Landing URL).');
  if (columns.impression === undefined) errors.push('Falta la columna «Impression Tag (image)».');
  const cell = (row: string[], col: Column) => (columns[col] !== undefined ? (row[columns[col]!] || '').trim() : '');

  const rows: NativeRow[] = [];
  grid.slice(headerRow + 1).forEach((raw, offset) => {
    const placementName = cell(raw, 'placementName');
    if (!placementName) return;
    const title = cell(raw, 'title');
    const description = cell(raw, 'description');
    const landingUrl = cell(raw, 'click');
    const impressionPixel = extractImgSrc(cell(raw, 'impression'));
    const rowErrors: string[] = [];
    const rowWarnings: string[] = [];

    if (!title) rowErrors.push('Sin Title.');
    else if (title.length > LIMITS.title) rowErrors.push(`Title de ${title.length} caracteres (máx. ${LIMITS.title}).`);
    else if (title.length > 60) rowWarnings.push(`Title de ${title.length} caracteres (recomendado ≤ 60).`);
    if (!description) rowErrors.push('Sin Description.');
    else if (description.length > LIMITS.description) rowErrors.push(`Description de ${description.length} caracteres (máx. ${LIMITS.description}).`);
    else if (description.length > 140) rowWarnings.push(`Description de ${description.length} caracteres (recomendado ≤ 140).`);
    if (!/^https?:\/\//i.test(landingUrl)) rowErrors.push('Click Tag vacío o no es una URL.');
    if (!impressionPixel) rowErrors.push('No se pudo sacar la URL del Impression Tag (image).');
    if (placementName.length > LIMITS.name) rowErrors.push(`Nombre de ${placementName.length} caracteres (máx. ${LIMITS.name}).`);

    rows.push({
      rowNumber: headerRow + offset + 2,
      placementId: cell(raw, 'placementId') || placementName.match(/_(\d+)$/)?.[1] || '',
      placementName,
      title,
      description,
      landingUrl,
      impressionPixel,
      errors: rowErrors,
      warnings: rowWarnings,
    });
  });
  if (rows.length === 0) errors.push('El archivo no tiene filas con «Placement Name».');
  return { rows, errors };
};

// --- Language -------------------------------------------------------------------------------

const LANGUAGE_WORDS: Record<QcLanguage, string[]> = {
  Spanish: ['el', 'la', 'los', 'las', 'de', 'del', 'y', 'en', 'con', 'para', 'por', 'desde', 'ahora', 'más', 'vuela', 'trayecto', 'cerca', 'tu', 'tus', 'viaja', 'descubre', 'ida', 'vuelta', 'precio', 'precios', 'ofertas', 'hasta'],
  English: ['the', 'and', 'to', 'from', 'with', 'for', 'now', 'fly', 'closer', 'your', 'one', 'way', 'trip', 'discover', 'book', 'deals', 'offer', 'travel', 'of', 'in'],
  Portuguese: ['o', 'os', 'as', 'do', 'da', 'dos', 'das', 'e', 'em', 'com', 'para', 'agora', 'mais', 'voe', 'perto', 'viagem', 'desde', 'seu', 'sua', 'descubra', 'ofertas', 'até'],
  French: ['le', 'la', 'les', 'de', 'des', 'du', 'et', 'en', 'avec', 'pour', 'maintenant', 'plus', 'vol', 'volez', 'proche', 'dès', 'votre', 'vos', 'aller', 'découvrez', 'à', 'offres'],
  Italian: ['il', 'lo', 'la', 'gli', 'le', 'di', 'del', 'della', 'e', 'con', 'per', 'ora', 'più', 'vola', 'vicino', 'da', 'tuo', 'tua', 'scopri', 'andata', 'offerte'],
  German: ['der', 'die', 'das', 'und', 'mit', 'für', 'jetzt', 'nach', 'ab', 'fliegen', 'fliegt', 'näher', 'ihr', 'ihre', 'entdecken', 'strecke', 'angebote', 'von', 'zu'],
  Dutch: ['de', 'het', 'een', 'en', 'met', 'voor', 'nu', 'naar', 'vanaf', 'vlieg', 'dichterbij', 'jouw', 'je', 'ontdek', 'enkele', 'reis', 'aanbiedingen', 'van'],
};

const LANGUAGE_CHARS: Partial<Record<QcLanguage, RegExp>> = {
  Spanish: /[ñ¿¡]/g,
  Portuguese: /[ãõç]/g,
  French: /[èêàùûœç]/g,
  German: /[äöüß]/g,
};

/** Best guess of the creative's language from its Title + Description. `confident` = clear winner. */
export const detectLanguage = (text: string): { language?: QcLanguage; confident: boolean } => {
  const lower = text.toLowerCase();
  const words = lower.split(/[^a-zà-ÿœß]+/i).filter(Boolean);
  const scores = QC_LANGUAGES.map((lang) => {
    const vocab = new Set(LANGUAGE_WORDS[lang]);
    let score = words.filter((w) => vocab.has(w)).length;
    const chars = LANGUAGE_CHARS[lang];
    if (chars) score += (lower.match(chars) || []).length * 2;
    return { lang, score };
  }).sort((a, b) => b.score - a.score);
  const [best, second] = scores;
  if (best.score === 0) return { confident: false };
  return { language: best.lang, confident: best.score >= 2 && best.score > second.score };
};

// Only markets with one obvious ad language; CH, BE and US are left to the text.
const MARKET_LANGUAGE: Record<string, QcLanguage> = {
  ES: 'Spanish', AR: 'Spanish', BO: 'Spanish', CO: 'Spanish', DO: 'Spanish', EC: 'Spanish', MX: 'Spanish',
  PA: 'Spanish', PE: 'Spanish', PY: 'Spanish', SV: 'Spanish', UY: 'Spanish',
  BR: 'Portuguese', PT: 'Portuguese', FR: 'French', IT: 'Italian', DE: 'German', NL: 'Dutch', UK: 'English', ZA: 'English',
};

export const languageForMarket = (marketCode?: string): QcLanguage | undefined =>
  marketCode ? MARKET_LANGUAGE[marketCode.toUpperCase()] : undefined;

/** `TEST DAVID ae-es_kpi360_…` → `ES`. */
export const marketCodeFromPlacement = (placementName: string): string | undefined =>
  placementName.toLowerCase().match(/(?:^|[\s_])ae-([a-z]{2})(?=_)/)?.[1]?.toUpperCase();

export interface LanguageChoice {
  language?: QcLanguage;
  source?: 'texto' | 'carpeta' | 'placement';
  note?: string;
}

/** Text when it is clear; otherwise the Drive folder's country, then the placement's `ae-xx` market. */
export const resolveLanguage = (text: string, folderMarket?: string, placementName = ''): LanguageChoice => {
  const detected = detectLanguage(text);
  const fromFolder = languageForMarket(folderMarket);
  const fromPlacement = languageForMarket(marketCodeFromPlacement(placementName));
  const market = fromFolder || fromPlacement;
  if (detected.confident && detected.language) {
    const note = market && market !== detected.language
      ? `El texto parece ${detected.language} pero el mercado es ${market}.`
      : undefined;
    return { language: detected.language, source: 'texto', note };
  }
  if (fromFolder) return { language: fromFolder, source: 'carpeta' };
  if (fromPlacement) return { language: fromPlacement, source: 'placement' };
  return { language: detected.language, source: detected.language ? 'texto' : undefined };
};

// --- Images ---------------------------------------------------------------------------------

export interface DriveImage {
  id: string;
  name: string;
  mimeType: string;
  bytes?: number;
  width?: number;
  height?: number;
}

export const imageIssues = (image: DriveImage): string[] => {
  const issues: string[] = [];
  if (!IMAGE_MIMES.includes(image.mimeType)) issues.push('Solo se admiten JPEG, PNG o GIF.');
  if (image.width && image.height && `${image.width}x${image.height}` !== REQUIRED_IMAGE_SIZE) {
    issues.push(`Mide ${image.width}x${image.height}, no ${REQUIRED_IMAGE_SIZE}.`);
  }
  if (!image.width || !image.height) issues.push('Drive no da las dimensiones de la imagen.');
  if (image.bytes && image.bytes > MAX_IMAGE_BYTES) issues.push('Pesa más de 5 MB.');
  return issues;
};

/** One creative per image; with several images a `_vN` goes before the trailing placement ID. */
export const creativeNamesFor = (placementName: string, imageCount: number): string[] => {
  if (imageCount <= 1) return [placementName];
  const match = placementName.match(/^(.*)_(\d+)$/);
  return Array.from({ length: imageCount }, (_, i) =>
    match ? `${match[1]}_v${i + 1}_${match[2]}` : `${placementName}_v${i + 1}`,
  );
};

// --- Quantcast campaign / ad set matching --------------------------------------------------

export interface QcNamed {
  id: string;
  name: string;
  state?: string;
}

const tokens = (name: string) => name.trim().toLowerCase().split('_').filter(Boolean);
const DEVICE_TOKENS = ['desktop', 'mobile', 'tablet', 'ctv'];
const STRATEGY_TOKENS = ['prs', 'rtg'];
const isDead = (state?: string) => !!state && /archiv|delet/i.test(state);
const norm = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

export interface MatchResult<T> {
  match?: T;
  candidates: T[];
}

/**
 * Campaign root of a placement name: everything before the strategy token, since one Quantcast
 * campaign holds both prospecting and retargeting ad sets.
 * `TEST DAVID ae-es_kpi360_ao_2025_nat_prs_quantcast_mobile_…` → `TEST DAVID ae-es_kpi360_ao_2025_nat`.
 */
export const campaignRoot = (placementName: string): string | undefined => {
  const match = placementName.trim().match(/^(.+?)_(?:prs|rtg)_/i);
  return match?.[1];
};

const YEAR = /^(19|20)\d{2}$/;
const coreTokens = (name: string) => tokens(norm(name)).filter((t) => !YEAR.test(t));
const indexOfSequence = (hay: string[], needle: string[]) => {
  for (let i = 0; i + needle.length <= hay.length; i++) {
    if (needle.every((t, j) => hay[i + j] === t)) return i;
  }
  return -1;
};
const yearOf = (name: string) => tokens(norm(name)).find((t) => YEAR.test(t));

/** Year token differs between placement and campaign (e.g. 2025 vs 2026): matched, but worth a look. */
export const yearMismatch = (placementName: string, campaignName: string): string | undefined => {
  const a = yearOf(placementName);
  const b = yearOf(campaignName);
  return a && b && a !== b ? `El placement dice ${a} y la campaña ${b}.` : undefined;
};

/**
 * Strategy the placement is trafficked under. Audience-extension placements are retargeting even
 * when named `_prs_` (`…_prs_quantcast_desktop_audience-extension_1x1_…` → `rtg`).
 */
export const placementStrategy = (placementName: string): 'prs' | 'rtg' | undefined => {
  const pt = tokens(placementName);
  if (pt.some((t) => t.startsWith('audience-extension'))) return 'rtg';
  return pt.find((t): t is 'prs' | 'rtg' => STRATEGY_TOKENS.includes(t));
};

/**
 * Campaigns whose name contains the placement's root (year tokens ignored). Campaigns may be split
 * by strategy (`…_nat_prs_quantcast` / `…_nat_rtg_quantcast`): the placement's own strategy wins,
 * the opposite one is never auto-selected. Then: root at the start, then the shortest name.
 */
export const matchCampaign = <T extends QcNamed>(placementName: string, campaigns: T[]): MatchResult<T> => {
  const root = campaignRoot(placementName);
  if (!root) return { candidates: [] };
  const rootTokens = coreTokens(root);
  const strategy = placementStrategy(placementName);
  const scored = campaigns
    .filter((c) => !isDead(c.state))
    .map((c) => {
      const ct = coreTokens(c.name);
      const at = indexOfSequence(ct, rootTokens);
      if (at < 0) return undefined;
      const own = strategy && ct.includes(strategy);
      const other = ct.some((t) => STRATEGY_TOKENS.includes(t) && t !== strategy);
      return { c, strategyRank: own ? 0 : other ? 2 : 1, positionRank: at === 0 ? 0 : 1 };
    })
    .filter((x): x is { c: T; strategyRank: number; positionRank: number } => !!x)
    .sort((a, b) => a.strategyRank - b.strategyRank || a.positionRank - b.positionRank || a.c.name.length - b.c.name.length);
  const [top, second] = scored;
  const tie = second && second.strategyRank === top.strategyRank && second.positionRank === top.positionRank
    && second.c.name.length === top.c.name.length;
  return { match: top && top.strategyRank < 2 && !tie ? top.c : undefined, candidates: scored.map((s) => s.c) };
};

/** The ad set of the campaign that best fits the placement: same strategy and device, most shared tokens. */
export const matchAdSet = <T extends QcNamed>(placementName: string, adSets: T[]): MatchResult<T> => {
  const strategy = placementStrategy(placementName);
  // Score against the effective strategy, so `_prs_…_audience-extension` scores like `_rtg_`.
  const pt = coreTokens(placementName).map((t) => (STRATEGY_TOKENS.includes(t) && strategy ? strategy : t));
  const ptSet = new Set(pt);
  const device = pt.find((t) => DEVICE_TOKENS.includes(t));
  const scored = adSets
    .filter((a) => !isDead(a.state))
    .map((a) => {
      const at = coreTokens(a.name);
      const adDevice = at.find((t) => DEVICE_TOKENS.includes(t));
      const adStrategy = at.find((t) => STRATEGY_TOKENS.includes(t));
      if (device && adDevice && adDevice !== device) return undefined;
      if (strategy && adStrategy && adStrategy !== strategy) return undefined;
      const shared = at.filter((t) => ptSet.has(t)).length;
      return { a, score: shared - (at.length - shared) + (device && adDevice === device ? 5 : 0) };
    })
    .filter((x): x is { a: T; score: number } => !!x)
    .sort((x, y) => y.score - x.score);
  const tie = scored[1] && scored[1].score === scored[0].score;
  return { match: scored[0] && !tie ? scored[0].a : undefined, candidates: scored.map((s) => s.a) };
};

// --- Updating existing creatives -------------------------------------------------------------

const LANGUAGE_CODES: Record<QcLanguage, string> = {
  Spanish: 'es', English: 'en', Portuguese: 'pt', French: 'fr', Italian: 'it', German: 'de', Dutch: 'nl',
};

export const languageFromCode = (code?: string | null): QcLanguage | undefined =>
  QC_LANGUAGES.find((l) => LANGUAGE_CODES[l] === String(code || '').toLowerCase());

/** The placement's own name, or the `_vN` variant created when several images were uploaded. */
export const creativeBelongsToPlacement = (creativeName: string, placementName: string): boolean => {
  const c = creativeName.trim();
  const p = placementName.trim();
  if (c === p) return true;
  const match = p.match(/^(.*)_(\d+)$/);
  if (!match) return false;
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escape(match[1])}_v\\d+_${match[2]}$`).test(c);
};

export interface NativeChanges {
  title?: string;
  description?: string;
  advertiser?: string;
  landingUrl?: string;
  impressionPixel?: string;
  language?: QcLanguage;
}

export const CHANGE_LABELS: Record<keyof NativeChanges, string> = {
  title: 'Title',
  description: 'Description',
  advertiser: 'Advertiser',
  landingUrl: 'Landing URL',
  impressionPixel: 'Impression Tracker',
  language: 'Language',
};

export interface CurrentNative {
  language?: string | null;
  native?: {
    title?: string | null;
    description?: string | null;
    sponsored?: string | null;
    landingUrl?: string | null;
    impressionTrackerUrl?: (string | null)[] | null;
  } | null;
}

export interface NativeDiff {
  changes: NativeChanges;
  /** Current value of each changed field, for display. */
  before: Partial<Record<keyof NativeChanges, string>>;
  notes: string[];
}

const same = (a?: string | null, b?: string | null) => (a || '').trim() === (b || '').trim();

/** Fields of the file that differ from what the creative has in Quantcast now. */
export const diffNative = (
  desired: { title: string; description: string; advertiser: string; landingUrl: string; impressionPixel: string; language?: QcLanguage },
  current: CurrentNative,
): NativeDiff => {
  const n = current.native || {};
  const changes: NativeChanges = {};
  const before: NativeDiff['before'] = {};
  const notes: string[] = [];
  const check = (key: keyof NativeChanges, wanted: string | undefined, now: string | null | undefined) => {
    if (wanted === undefined || wanted.trim() === '' || same(wanted, now)) return;
    (changes as any)[key] = wanted.trim();
    before[key] = (now || '').trim();
  };
  check('title', desired.title, n.title);
  check('description', desired.description, n.description);
  check('advertiser', desired.advertiser, n.sponsored);
  check('landingUrl', desired.landingUrl, n.landingUrl);
  const trackers = (n.impressionTrackerUrl || []).filter((t): t is string => !!t);
  check('impressionPixel', desired.impressionPixel, trackers[0]);
  if (trackers.length > 1) notes.push(`Tiene ${trackers.length} impression trackers: solo se compara y cambia el primero.`);
  const currentLanguage = languageFromCode(current.language);
  if (desired.language && desired.language !== currentLanguage) {
    changes.language = desired.language;
    before.language = currentLanguage || String(current.language || '—');
  }
  return { changes, before, notes };
};

export interface NativeUpdateJob {
  creativeId: string;
  name: string;
  changes: NativeChanges;
}

// --- Runner contract ------------------------------------------------------------------------

export interface NativeCreativeJob {
  name: string;
  title: string;
  description: string;
  advertiser: string;
  landingUrl: string;
  impressionPixel: string;
  language: QcLanguage;
  image: { fileId: string; fileName: string };
}

export interface NativeAssignmentJob {
  campaignName: string;
  adSetName: string;
  creativeNames: string[];
  replace: boolean;
}

export interface NativeRunRequest {
  accountId: string;
  driveToken: string;
  dryRun: boolean;
  creatives: NativeCreativeJob[];
  assignments: NativeAssignmentJob[];
  /** Edits of creatives that already exist in Quantcast. */
  updates?: NativeUpdateJob[];
}

export type RunStepStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';

export interface RunStep {
  id: string;
  kind: 'creative' | 'assignment' | 'update';
  label: string;
  status: RunStepStatus;
  message?: string;
  screenshot?: string;
}

export interface RunState {
  runId: string;
  status: 'running' | 'finished' | 'stopped' | 'failed';
  dryRun: boolean;
  steps: RunStep[];
  error?: string;
  /** Feedback/survey popups closed automatically during the run. */
  popupsClosed?: number;
}

/** Groups creatives by ad set so each ad set is edited once with all its new creatives. */
export const buildAssignments = (
  items: { creativeNames: string[]; campaignName: string; adSetName: string }[],
  replace: boolean,
): NativeAssignmentJob[] => {
  const byAdSet = new Map<string, NativeAssignmentJob>();
  items.forEach((item) => {
    const key = `${item.campaignName}\u0000${item.adSetName}`;
    const existing = byAdSet.get(key);
    if (existing) existing.creativeNames.push(...item.creativeNames);
    else byAdSet.set(key, { campaignName: item.campaignName, adSetName: item.adSetName, creativeNames: [...item.creativeNames], replace });
  });
  return [...byAdSet.values()];
};
