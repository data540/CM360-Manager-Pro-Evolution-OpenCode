// Pure planning logic for "traffic from creatives": given the detected files of a country folder
// and a CM360 campaign (its placements and ads), decide which creative goes to which placements
// and which existing ads. No API calls here; the view loads the data and executes the plan.

import type { CreativeKind, DetectedFile } from './creativeDetection';
import { marketOfCampaign, type Market } from './markets';

export interface PlanPlacement {
  id: string;
  name: string;
  siteId: string;
  siteName?: string;
  /** `WxH`, or undefined when CM360 reports no size. */
  size?: string;
  /** CM360 compatibility: DISPLAY, DISPLAY_INTERSTITIAL, APP, APP_INTERSTITIAL, IN_STREAM_VIDEO, IN_STREAM_AUDIO */
  compatibility: string;
  /** False for inactive, archived or permanently archived placements. */
  active: boolean;
}

export interface PlanAd {
  id: string;
  name: string;
  isDefault: boolean;
  active: boolean;
  placementIds: string[];
}

export interface PlanOptions {
  /** Also assign to Default Ads of each size (on by default). */
  includeDefaultAds: boolean;
  /** `replace`: the new creatives become the ad's whole rotation. `add`: they join the current rotation. */
  mode: 'replace' | 'add';
  uploadDate: Date;
}

export interface PlannedCreative {
  fileId: string;
  fileName: string;
  kind: CreativeKind;
  size: string;
  creativeName: string;
  placementIds: string[];
  adIds: string[];
}

export interface PlannedAdAssignment {
  adId: string;
  adName: string;
  isDefault: boolean;
  mode: 'replace' | 'add';
  /** All creatives this ad receives in this run, applied in a single update. */
  fileIds: string[];
}

export type PlanIssueCode =
  | 'market_mismatch'
  | 'unsupported_file'
  | 'size_unknown'
  | 'size_mismatch'
  | 'unmatched_file'
  | 'duplicate_name'
  | 'placement_without_creative'
  | 'placement_without_ad'
  | 'mixed_size_ad';

export interface PlanIssue {
  severity: 'error' | 'warning';
  code: PlanIssueCode;
  message: string;
  fileId?: string;
  placementId?: string;
  adId?: string;
}

export interface PlacementCoverage {
  placement: PlanPlacement;
  fileIds: string[];
  adIds: string[];
}

export interface TrafficPlan {
  creatives: PlannedCreative[];
  adAssignments: PlannedAdAssignment[];
  coverage: PlacementCoverage[];
  issues: PlanIssue[];
  /** True when an error blocks execution (e.g. folder and campaign from different countries). */
  blocked: boolean;
}

export interface TrafficPlanInput {
  campaign: { id: string; name: string };
  /** Market detected from the folder name, if any. */
  folderMarket?: Market;
  files: DetectedFile[];
  placements: PlanPlacement[];
  ads: PlanAd[];
  options: PlanOptions;
}

const DISPLAY_COMPATIBILITIES = ['DISPLAY', 'DISPLAY_INTERSTITIAL', 'APP', 'APP_INTERSTITIAL'];
const VIDEO_COMPATIBILITIES = ['IN_STREAM_VIDEO'];
const DEVICE_TOKENS = ['desktop', 'mobile', 'tablet', 'ctv'];

const familyOf = (kind: CreativeKind) => (kind === 'video' ? 'video' : 'display');
const placementFamily = (p: PlanPlacement) =>
  VIDEO_COMPATIBILITIES.includes(p.compatibility) ? 'video'
    : DISPLAY_COMPATIBILITIES.includes(p.compatibility) ? 'display'
      : 'other';

const deviceOfName = (name: string) => {
  const tokens = name.toLowerCase().split(/[^a-z0-9]+/);
  return DEVICE_TOKENS.find((d) => tokens.includes(d));
};

/** `ddmmyyyy`, the date token used in creative names. */
export const formatDateToken = (date: Date) =>
  `${String(date.getDate()).padStart(2, '0')}${String(date.getMonth() + 1).padStart(2, '0')}${date.getFullYear()}`;

/** `<campaign>_<size>_<ddmmyyyy>`, e.g. `ae-es_kpi360_johannesburgo_nat_300x250_01102026`. */
export const buildCreativeName = (campaignName: string, size: string, date: Date) =>
  `${campaignName.trim()}_${size}_${formatDateToken(date)}`;

const matchesFile = (file: DetectedFile, placement: PlanPlacement) => {
  if (!placement.active || placementFamily(placement) !== familyOf(file.kind)) return false;
  // Display creatives must match the placement size exactly; video placements carry no
  // meaningful size in CM360, so any active video placement of the campaign is a candidate.
  if (file.kind !== 'video' && placement.size !== file.size) return false;
  const placementDevice = deviceOfName(placement.name);
  return !(file.device && placementDevice && file.device !== placementDevice);
};

export const buildTrafficPlan = (input: TrafficPlanInput): TrafficPlan => {
  const { campaign, files, placements, ads, options } = input;
  const issues: PlanIssue[] = [];

  const campaignMarket = marketOfCampaign(campaign.name);
  if (input.folderMarket && campaignMarket && input.folderMarket.code !== campaignMarket.code) {
    issues.push({
      severity: 'error',
      code: 'market_mismatch',
      message: `La carpeta es de ${input.folderMarket.code} pero la campaña es de ${campaignMarket.code}.`,
    });
  }

  const activeAds = ads.filter((ad) => ad.active && (options.includeDefaultAds || !ad.isDefault));
  const placementsById = new Map(placements.map((p) => [p.id, p]));
  const usedNames = new Map<string, number>();
  const creatives: PlannedCreative[] = [];
  const fileIdsByPlacement = new Map<string, string[]>();
  const fileIdsByAd = new Map<string, string[]>();

  files.forEach((file) => {
    if (file.kind === 'unsupported') {
      issues.push({ severity: 'warning', code: 'unsupported_file', message: `Formato no admitido, se ignora: ${file.relativePath}`, fileId: file.id });
      return;
    }
    if (!file.size) {
      issues.push({ severity: 'error', code: 'size_unknown', message: `No se pudo saber el tamaño de ${file.relativePath}.`, fileId: file.id });
      return;
    }
    if (file.sizeMismatch) {
      issues.push({
        severity: 'warning',
        code: 'size_mismatch',
        message: `${file.fileName}: el nombre dice ${file.sizeFromName} pero el archivo mide ${file.size}. Se usa ${file.size}.`,
        fileId: file.id,
      });
    }

    const placementIds = placements.filter((p) => matchesFile(file, p)).map((p) => p.id);
    if (placementIds.length === 0) {
      issues.push({ severity: 'warning', code: 'unmatched_file', message: `Ningún placement activo de la campaña admite ${file.fileName} (${file.size}).`, fileId: file.id });
      return;
    }

    const baseName = buildCreativeName(campaign.name, file.size, options.uploadDate);
    const count = (usedNames.get(baseName) || 0) + 1;
    usedNames.set(baseName, count);
    const creativeName = count === 1 ? baseName : `${baseName}_${count}`;
    if (count > 1) {
      issues.push({
        severity: 'warning',
        code: 'duplicate_name',
        message: `Hay varias creatividades de ${file.size}: ${file.fileName} se llamará ${creativeName}.`,
        fileId: file.id,
      });
    }

    const placementSet = new Set(placementIds);
    const adIds = activeAds.filter((ad) => ad.placementIds.some((id) => placementSet.has(id))).map((ad) => ad.id);
    placementIds.forEach((id) => fileIdsByPlacement.set(id, [...(fileIdsByPlacement.get(id) || []), file.id]));
    adIds.forEach((id) => fileIdsByAd.set(id, [...(fileIdsByAd.get(id) || []), file.id]));
    creatives.push({ fileId: file.id, fileName: file.fileName, kind: file.kind, size: file.size, creativeName, placementIds, adIds });
  });

  const adAssignments: PlannedAdAssignment[] = activeAds
    .filter((ad) => fileIdsByAd.has(ad.id))
    .map((ad) => ({ adId: ad.id, adName: ad.name, isDefault: ad.isDefault, mode: options.mode, fileIds: fileIdsByAd.get(ad.id)! }));

  // An ad spanning several sizes would get a creative that only fits part of its placements.
  adAssignments.forEach((assignment) => {
    const ad = activeAds.find((a) => a.id === assignment.adId)!;
    const sizes = new Set(ad.placementIds.map((id) => placementsById.get(id)?.size).filter(Boolean));
    if (sizes.size > 1) {
      issues.push({
        severity: 'warning',
        code: 'mixed_size_ad',
        message: `El ad «${ad.name}» tiene placements de varios tamaños (${[...sizes].join(', ')}).`,
        adId: ad.id,
      });
    }
  });

  // Coverage: only for the families present in the folder (a banners-only folder doesn't
  // flag every video placement of the campaign).
  const familiesInFolder = new Set<string>(creatives.map((c) => familyOf(c.kind)));
  const coverage: PlacementCoverage[] = placements
    .filter((p) => p.active && familiesInFolder.has(placementFamily(p)))
    .map((placement) => ({
      placement,
      fileIds: fileIdsByPlacement.get(placement.id) || [],
      adIds: activeAds.filter((ad) => ad.placementIds.includes(placement.id)).map((ad) => ad.id),
    }));

  coverage.forEach(({ placement, fileIds, adIds }) => {
    if (fileIds.length === 0) {
      issues.push({
        severity: 'warning',
        code: 'placement_without_creative',
        message: `Ninguna creatividad de la carpeta encaja con ${placement.name}${placement.size ? ` (${placement.size})` : ''}.`,
        placementId: placement.id,
      });
    } else if (adIds.length === 0) {
      issues.push({
        severity: 'warning',
        code: 'placement_without_ad',
        message: `${placement.name} no tiene ningún ad activo: sus creatividades no se asignarán ahí.`,
        placementId: placement.id,
      });
    }
  });

  const sortedIssues = issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
  return {
    creatives,
    adAssignments,
    coverage,
    issues: sortedIssues,
    blocked: sortedIssues.some((i) => i.severity === 'error' && i.code === 'market_mismatch'),
  };
};
