// "Missing formats" report: crosses the trafficking sheet (one row per outlet and format) with
// what CM360 already has for the chosen campaign, and optionally with the creatives folder.
// Pure logic; the view loads placements/ads and renders the result.

import type { DetectedFile } from './creativeDetection';
import { normalizeLabel } from './markets';
import type { SheetRow } from './trafficSheet';
import type { PlanPlacement } from './trafficPlan';

export interface ReportAd {
  id: string;
  active: boolean;
  placementIds: string[];
  creativeIds: string[];
}

export type RowStatus =
  | 'site_not_found'
  | 'placement_missing'
  | 'no_creative'
  | 'ok';

export interface ReportRow {
  sheetRow: SheetRow;
  siteId?: string;
  siteName?: string;
  /** Site candidates when the outlet name is ambiguous. */
  siteCandidates: { id: string; name: string }[];
  placementIds: string[];
  /** Placements of this row that already serve at least one creative. */
  placementsWithCreative: string[];
  status: RowStatus;
  /** Whether the creatives folder has a file for this format (undefined when no folder was given). */
  inFolder?: boolean;
}

export interface ExtraPlacement {
  placement: PlanPlacement;
  hasCreative: boolean;
}

export interface FormatReport {
  rows: ReportRow[];
  /** Active placements of the campaign that no sheet row asks for. */
  notInSheet: ExtraPlacement[];
  counts: Record<RowStatus, number> & { missingInFolder: number; rowWarnings: number };
}

export interface FormatReportInput {
  sheetRows: SheetRow[];
  placements: PlanPlacement[];
  ads: ReportAd[];
  files?: DetectedFile[];
  /** Manual outlet → CM360 site choices, keyed by normalized outlet name. */
  siteOverrides?: Record<string, string>;
}

// Words that describe the channel, not the outlet: `CTV_Disney` must match the site `Disney+`.
const GENERIC_TOKENS = new Set(['ctv', 'rtb', 'dis', 'display', 'video', 'vid', 'nat', 'native', 'web', 'app', 'tv', 'the', 'and']);

const tokens = (value: string) =>
  normalizeLabel(value).split(/[^a-z0-9]+/).filter((t) => t.length >= 2 && !GENERIC_TOKENS.has(t));

export const outletKey = (outlet: string) => normalizeLabel(outlet);

/** CM360 sites whose name shares a meaningful word with the outlet name. */
export const matchSites = (outlet: string, sites: { id: string; name: string }[]) => {
  const outletTokens = tokens(outlet);
  const compactOutlet = outletTokens.join('');
  return sites.filter((site) => {
    const siteTokens = tokens(site.name);
    const compactSite = siteTokens.join('');
    return siteTokens.some((t) => outletTokens.includes(t))
      || (compactSite.length >= 3 && compactOutlet.includes(compactSite))
      || (compactOutlet.length >= 3 && compactSite.includes(compactOutlet));
  });
};

// `1x1` is ambiguous in the sheet: usually CTV/video, but it can also be a real 1x1 display
// placement (tracking/pixel). It accepts both; any other format only matches its exact size.
const isOneByOne = (format: string) => format === '1x1';

const placementFitsFormat = (placement: PlanPlacement, format: string) => {
  if (!placement.active) return false;
  if (placement.compatibility === 'IN_STREAM_VIDEO') return isOneByOne(format);
  return placement.size === format;
};

const fileFitsFormat = (file: DetectedFile, format: string) => {
  if (file.kind === 'unsupported') return false;
  if (file.kind === 'video') return isOneByOne(format);
  return file.size === format;
};

export const buildFormatReport = (input: FormatReportInput): FormatReport => {
  const { sheetRows, placements, ads, files, siteOverrides = {} } = input;
  const sites = [...new Map(placements.map((p) => [p.siteId, { id: p.siteId, name: p.siteName || p.siteId }])).values()];
  const servedPlacements = new Set(
    ads.filter((ad) => ad.active && ad.creativeIds.length > 0).flatMap((ad) => ad.placementIds),
  );
  const coveredPlacements = new Set<string>();

  const rows: ReportRow[] = sheetRows.map((sheetRow) => {
    const override = siteOverrides[outletKey(sheetRow.site)];
    const candidates = override ? sites.filter((s) => s.id === override) : matchSites(sheetRow.site, sites);
    const inFolder = files ? files.some((f) => fileFitsFormat(f, sheetRow.format)) : undefined;

    if (candidates.length !== 1) {
      return { sheetRow, siteCandidates: candidates, placementIds: [], placementsWithCreative: [], status: 'site_not_found', inFolder };
    }
    const site = candidates[0];
    const placementIds = placements
      .filter((p) => p.siteId === site.id && placementFitsFormat(p, sheetRow.format))
      .map((p) => p.id);
    placementIds.forEach((id) => coveredPlacements.add(id));
    const placementsWithCreative = placementIds.filter((id) => servedPlacements.has(id));
    const status: RowStatus = placementIds.length === 0 ? 'placement_missing'
      : placementsWithCreative.length < placementIds.length ? 'no_creative'
        : 'ok';
    return { sheetRow, siteId: site.id, siteName: site.name, siteCandidates: candidates, placementIds, placementsWithCreative, status, inFolder };
  });

  const notInSheet = placements
    .filter((p) => p.active && !coveredPlacements.has(p.id))
    .map((placement) => ({ placement, hasCreative: servedPlacements.has(placement.id) }));

  const count = (status: RowStatus) => rows.filter((r) => r.status === status).length;
  return {
    rows,
    notInSheet,
    counts: {
      site_not_found: count('site_not_found'),
      placement_missing: count('placement_missing'),
      no_creative: count('no_creative'),
      ok: count('ok'),
      missingInFolder: rows.filter((r) => r.inFolder === false && r.status !== 'ok').length,
      rowWarnings: rows.filter((r) => r.sheetRow.warnings.length > 0).length,
    },
  };
};
