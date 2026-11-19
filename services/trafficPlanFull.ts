// Plan builder for "crear desde cero": given plain-text placement names and Drive files,
// decides which placements to create, which creatives to upload, and which Default Ads to build.
// No API calls here; all network work happens in trafficExecutorFull.ts.

import type { DetectedFile, CreativeKind } from './creativeDetection';
import { buildCreativeName } from './trafficPlan';
import { sidesMatch, sizeWithSide } from './brandDay';

export interface ParsedPlacement {
  name: string;
  size: string;
  siteToken: string;
  siteId?: string;
  siteName?: string;
  compatibility: string;
  siteUnknown?: boolean;
}

export interface FullPlannedCreative {
  fileId: string;
  fileName: string;
  kind: CreativeKind;
  size: string;
  creativeName: string;
  /** Indices into ParsedPlacement[]. */
  placementIndices: number[];
}

export interface FullPlannedDefaultAd {
  placementIndex: number;
  adName: string;
  /** Index into FullPlannedCreative[]. */
  creativeIndex: number;
}

export interface FullTrafficPlan {
  placements: ParsedPlacement[];
  creatives: FullPlannedCreative[];
  defaultAds: FullPlannedDefaultAd[];
  /** Drive files for which no placement in the list matches by size. */
  extraFiles: DetectedFile[];
}

export interface FullPlanOptions {
  campaignName: string;
  uploadDate: Date;
  createDefaultAds: boolean;
  defaultAdMode: 'replace' | 'add';
  /** Site tokens whose placements get a Default Ad. Empty set = all sites. */
  siteFilter: Set<string>;
}

// Tokens that carry no useful site or tech information in Air Europa placement names.
const GENERIC_TOKENS = new Set([
  'dis', 'prs', 'rtg', 'nat', 'gen', 'desktop', 'mobile', 'tablet', 'ctv',
  'video', 'display', 'audio', 'connected', 'audience', 'extension', 'standard',
  // Brand day words (side of the page), never a site.
  'brandday', 'brandweek', 'izq', 'izda', 'izqda', 'izquierda', 'dch', 'dcha', 'drch', 'drcha', 'derecha',
]);

export const extractSiteToken = (name: string): string => {
  const parts = name.toLowerCase().split(/[_\-]+/).filter((p) => p.trim());
  return (
    parts.find(
      (p) =>
        !/^kpi\d+$/i.test(p) &&
        !/^ae[a-z]{0,3}$/.test(p) &&
        !/^\d{4}$/.test(p) &&
        !/^\d+x\d+$/.test(p) &&
        !/^\d+$/.test(p) &&
        !GENERIC_TOKENS.has(p) &&
        p.length > 2,
    ) || ''
  );
};

export const extractSizeFromName = (name: string): string | undefined => {
  // Not \b: in `…_gen_728x90` the `_` is a word character, so there is no word boundary.
  const match = name.match(/(?<!\d)(\d{1,4}x\d{1,4})(?!\d)/i);
  return match ? match[1].toLowerCase() : undefined;
};

interface CmSite {
  id: string;
  name: string;
}

const normSite = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

export const matchSiteToken = (token: string, sites: CmSite[]): CmSite | undefined => {
  if (!token) return undefined;
  const norm = normSite(token);
  return (
    sites.find((s) => normSite(s.name) === norm) ||
    sites.find((s) => normSite(s.name).startsWith(norm)) ||
    sites.find((s) => normSite(s.name).includes(norm) || norm.includes(normSite(s.name)))
  );
};

export const parsePlacementNames = (text: string, sites: CmSite[]): ParsedPlacement[] => {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .flatMap((name) => {
      const size = extractSizeFromName(name);
      if (!size) return [];
      const trimmed = name.replace(/_+$/, '');
      // The site is the word of the name that is a CM360 site (dv360, seedtag…); the concept
      // words before it (black-friday, decesos…) must not be taken for it.
      // `kpi360` is the agency token of every name, never the site (even if a "KPI360 Direct" site exists).
      const words = trimmed.toLowerCase().split(/[_-]+/).filter((w) => w && !/^kpi\d+$/.test(w));
      const bySite = words
        .map((w) => ({
          w,
          site: sites.find((s) => normSite(s.name) === normSite(w))
            || (w.length >= 4 ? sites.find((s) => normSite(s.name).startsWith(normSite(w))) : undefined),
        }))
        .find((x) => x.site);
      const siteToken = bySite?.w || extractSiteToken(trimmed);
      const matched = bySite?.site || matchSiteToken(siteToken, sites);
      return [
        {
          name: trimmed,
          size,
          siteToken,
          siteId: matched?.id,
          siteName: matched?.name,
          compatibility: size === '1x1' ? 'IN_STREAM_VIDEO' : 'DISPLAY',
          siteUnknown: !matched,
        },
      ];
    });
};

export const buildFullTrafficPlan = (
  parsedPlacements: ParsedPlacement[],
  driveFiles: DetectedFile[],
  options: FullPlanOptions,
): FullTrafficPlan => {
  const creatives: FullPlannedCreative[] = [];
  const defaultAds: FullPlannedDefaultAd[] = [];
  const extraFiles: DetectedFile[] = [];
  const usedNames = new Map<string, number>();

  for (const file of driveFiles.filter((f) => f.kind !== 'unsupported' && f.size)) {
    const matchingIndices = parsedPlacements
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p.size === file.size && sidesMatch(file.fileName, p.name))
      .map(({ i }) => i);

    if (matchingIndices.length === 0) {
      extraFiles.push(file);
      continue;
    }

    const baseName = buildCreativeName(options.campaignName, sizeWithSide(file.size, file.fileName), options.uploadDate);
    const count = (usedNames.get(baseName) || 0) + 1;
    usedNames.set(baseName, count);
    const creativeName = count === 1 ? baseName : `${baseName}_${count}`;

    creatives.push({
      fileId: file.id,
      fileName: file.fileName,
      kind: file.kind as CreativeKind,
      size: file.size!,
      creativeName,
      placementIndices: matchingIndices,
    });
  }

  if (options.createDefaultAds) {
    parsedPlacements.forEach((p, pi) => {
      if (options.siteFilter.size > 0 && !options.siteFilter.has(p.siteToken)) return;
      const ci = creatives.findIndex((c) => c.placementIndices.includes(pi));
      if (ci === -1) return;
      defaultAds.push({ placementIndex: pi, adName: `${p.size} Default Web Ad`, creativeIndex: ci });
    });
  }

  return { placements: parsedPlacements, creatives, defaultAds, extraFiles };
};
