// Pure planning logic for "completar Ads": the campaign already has its placements but some lack
// their standard Ad and/or Default Ad. Same idea as Creatives → Batch Upload (prefix/suffix
// naming, sites, auto-match by size, "poner como Default", "crear Default Ads donde falten"),
// but fed by the country folders of "traficar desde carpeta". No API calls here.

import type { DetectedFile } from './creativeDetection';
import { marketOfCampaign, type Market } from './markets';
import { describeRule, findTrackingRule, placementMatchesSupport, ruleKey, similarSupportName, type TrackingRule } from './trackingSheet';
import { formatDateToken, matchesFile, placementFamily, type PlanAd, type PlanIssue, type PlanPlacement } from './trafficPlan';

export interface CompleteOptions {
  prefix: string;
  suffix: string;
  includeDate: boolean;
  uploadDate: Date;
  /** Sites whose placements are trafficked. Undefined = every site of the campaign; an empty set = none. */
  siteIds?: Set<string>;
  /** Also put the creatives in the Default Ads of each placement. */
  setAsDefault: boolean;
  /** Create a Default Ad on matched placements that have none (needs `setAsDefault`). */
  createMissingDefaultAds: boolean;
  defaultMode: 'replace' | 'add';
  standardMode: 'replace' | 'add';
  /** "Juego" chosen for Default Ads when a size has several files. */
  defaultSetKey?: string;
  /** Landing rules from the tracking file (all countries; filtered by the folder market). */
  trackingRules?: TrackingRule[];
  /** Serving window of each creative inside its standard Ads (`YYYY-MM-DD`), by file id. */
  creativeDates?: Record<string, CreativeDates>;
}

export interface CreativeDates {
  start?: string;
  end?: string;
}

export interface CompleteCreative {
  fileId: string;
  fileName: string;
  kind: DetectedFile['kind'];
  size: string;
  creativeName: string;
  placementIds: string[];
  /** First / last day this creative serves in its standard Ads (`YYYY-MM-DD`, inclusive). */
  startDate?: string;
  endDate?: string;
}

export interface CompleteAdAction {
  key: string;
  kind: 'update' | 'create';
  isDefault: boolean;
  /** Existing ad (update) — for a create it is only known after execution. */
  adId?: string;
  adName: string;
  /** Placement the new ad is created on (create only). */
  placementId?: string;
  placementIds: string[];
  fileIds: string[];
  mode: 'replace' | 'add';
  /** The Ad was inactive (not archived): it is switched on when its creatives are updated. */
  activate?: boolean;
  /** Click-through URL from the tracking file for the creatives of this run (not the ones already in rotation). */
  clickUrl?: string;
}

export type RowAction = 'update' | 'activate' | 'create' | 'none' | 'off';

export interface CompleteRow {
  placement: PlanPlacement;
  siteName?: string;
  fileIds: string[];
  standard: { action: RowAction; adNames: string[] };
  default: { action: RowAction; adNames: string[] };
  /** Tracking-file click URL for this placement, and the support that matched it. */
  landing?: { url: string; support: string; row: number; key: string; source?: string };
}

export interface CreativeSet {
  key: string;
  sizes: string[];
}

export interface CompletePlan {
  creatives: CompleteCreative[];
  actions: CompleteAdAction[];
  rows: CompleteRow[];
  /** Files with no matching placement in the selected sites: not uploaded. */
  extraFiles: DetectedFile[];
  /** Active placements in the selected sites that no file fits. */
  uncovered: PlanPlacement[];
  sets: CreativeSet[];
  /** True when some size has several files, so the Default needs a "juego". */
  needsSetChoice: boolean;
  issues: PlanIssue[];
  blocked: boolean;
}

export interface CompletePlanInput {
  campaign: { id: string; name: string; startDate?: string; endDate?: string };
  folderMarket?: Market;
  files: DetectedFile[];
  placements: PlanPlacement[];
  ads: PlanAd[];
  sites: { id: string; name: string }[];
  options: CompleteOptions;
}

const toNameToken = (value?: string) => (value || '').trim().replace(/\s+/g, '_');

/** Same naming as Batch Upload: `<prefix>_<file name>_<suffix>_<ddmmyyyy>`. */
export const buildPrefixedCreativeName = (fileName: string, prefix: string, suffix: string, dateToken: string) =>
  [prefix, fileName.replace(/\.[^./\\]+$/, ''), suffix, dateToken]
    .map(toNameToken)
    .filter(Boolean)
    .join('_')
    .replace(/_{2,}/g, '_');

/** Files sharing a name once the size token is removed belong to the same "juego". */
export const creativeSetKey = (fileName: string) => {
  const base = fileName
    .replace(/\.[^./\\]+$/, '')
    .replace(/\d+\s*[x×]\s*\d+/gi, '')
    .replace(/[\s_.-]{2,}/g, '_')
    .replace(/^[\s_.-]+|[\s_.-]+$/g, '');
  return base || fileName;
};

export const defaultAdNameFor = (placement: PlanPlacement, size: string) =>
  placementFamily(placement) === 'video' ? 'Default Video Ad' : `${size} Default Web Ad`;

export const buildCompletePlan = (input: CompletePlanInput): CompletePlan => {
  const { campaign, files, placements, ads, sites, options } = input;
  const issues: PlanIssue[] = [];

  const campaignMarket = marketOfCampaign(campaign.name);
  if (input.folderMarket && campaignMarket && input.folderMarket.code !== campaignMarket.code) {
    issues.push({
      severity: 'error',
      code: 'market_mismatch',
      message: `La carpeta es de ${input.folderMarket.code} pero la campaña es de ${campaignMarket.code}.`,
    });
  }

  const siteName = new Map(sites.map((s) => [s.id, s.name]));
  const inSites = (p: PlanPlacement) => !options.siteIds || options.siteIds.has(p.siteId);
  const candidatePlacements = placements.filter((p) => p.active && inSites(p));
  const dateToken = options.includeDate ? formatDateToken(options.uploadDate) : '';
  const countryRules = (options.trackingRules || []).filter((r) => r.country && r.country === input.folderMarket?.code);
  const landingFor = (p: PlanPlacement) => {
    const rule = countryRules.length ? findTrackingRule(countryRules, input.folderMarket?.code, p, siteName.get(p.siteId)) : undefined;
    return rule ? { url: rule.clickUrl, support: rule.support, row: rule.row, key: ruleKey(rule), source: rule.source } : undefined;
  };

  // 1. Creatives: every usable file matched by size (and device) to the selected placements.
  const creatives: CompleteCreative[] = [];
  const extraFiles: DetectedFile[] = [];
  const usedNames = new Map<string, number>();
  files.forEach((file) => {
    if (file.kind === 'unsupported') {
      issues.push({ severity: 'warning', code: 'unsupported_file', message: `Formato no admitido, se ignora: ${file.relativePath}`, fileId: file.id });
      extraFiles.push(file);
      return;
    }
    if (!file.size) {
      issues.push({ severity: 'error', code: 'size_unknown', message: `No se pudo saber el tamaño de ${file.relativePath}.`, fileId: file.id });
      extraFiles.push(file);
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
    const placementIds = candidatePlacements.filter((p) => matchesFile(file, p)).map((p) => p.id);
    if (placementIds.length === 0) {
      extraFiles.push(file);
      return;
    }
    const baseName = buildPrefixedCreativeName(file.fileName, options.prefix, options.suffix, dateToken);
    const count = (usedNames.get(baseName) || 0) + 1;
    usedNames.set(baseName, count);
    const creativeName = count === 1 ? baseName : `${baseName}_${count}`;
    if (count > 1) {
      issues.push({ severity: 'warning', code: 'duplicate_name', message: `Nombre repetido: ${file.fileName} se llamará ${creativeName}.`, fileId: file.id });
    }
    const dates = options.creativeDates?.[file.id] || {};
    const startDate = dates.start || undefined;
    const endDate = dates.end || undefined;
    if (startDate && endDate && endDate < startDate) {
      issues.push({ severity: 'error', code: 'creative_dates', message: `${creativeName}: la fecha de fin (${endDate}) es anterior a la de inicio (${startDate}).`, fileId: file.id });
    } else if ((startDate && campaign.endDate && startDate > campaign.endDate) || (endDate && campaign.startDate && endDate < campaign.startDate)) {
      issues.push({
        severity: 'error',
        code: 'creative_dates',
        message: `${creativeName}: sus fechas quedan fuera de la campaña (${campaign.startDate || '…'} → ${campaign.endDate || '…'}).`,
        fileId: file.id,
      });
    } else if ((startDate && campaign.startDate && startDate < campaign.startDate) || (endDate && campaign.endDate && endDate > campaign.endDate)) {
      issues.push({
        severity: 'warning',
        code: 'creative_dates',
        message: `${creativeName}: parte de sus fechas cae fuera de la campaña; se ajustan a las fechas de cada Ad.`,
        fileId: file.id,
      });
    }
    creatives.push({ fileId: file.id, fileName: file.fileName, kind: file.kind, size: file.size, creativeName, placementIds, startDate, endDate });
  });

  // 2. "Juegos" for the Default Ads, as in Batch Upload.
  const setSizes = new Map<string, string[]>();
  creatives.forEach((c) => {
    const key = creativeSetKey(c.fileName);
    const list = setSizes.get(key) || [];
    if (!list.includes(c.size)) list.push(c.size);
    setSizes.set(key, list);
  });
  const sets = [...setSizes.entries()]
    .map(([key, sizes]) => ({ key, sizes }))
    .sort((a, b) => b.sizes.length - a.sizes.length || a.key.localeCompare(b.key));
  const filesBySize = new Map<string, CompleteCreative[]>();
  creatives.forEach((c) => filesBySize.set(c.size, [...(filesBySize.get(c.size) || []), c]));
  const needsSetChoice = [...filesBySize.values()].some((list) => list.length > 1);
  const chosenSet = options.defaultSetKey && setSizes.has(options.defaultSetKey) ? options.defaultSetKey : sets[0]?.key;
  const defaultFileIdsFor = (fileIds: string[]) => {
    const own = creatives.filter((c) => fileIds.includes(c.fileId));
    const fromSet = own.filter((c) => creativeSetKey(c.fileName) === chosenSet);
    return (fromSet.length ? fromSet : own).map((c) => c.fileId);
  };

  // 3. Per placement: update its Ads or create the missing ones.
  const actionsByAd = new Map<string, CompleteAdAction>();
  const creates: CompleteAdAction[] = [];
  const rows: CompleteRow[] = [];
  const uncovered: PlanPlacement[] = [];
  const familiesInFolder = new Set(creatives.map((c) => (c.kind === 'video' ? 'video' : 'display')));

  const addUpdate = (ad: PlanAd, placementId: string, fileIds: string[], isDefault: boolean, clickUrl?: string, activate = false) => {
    const existing = actionsByAd.get(ad.id);
    if (existing) {
      if (clickUrl && existing.clickUrl && existing.clickUrl !== clickUrl) {
        issues.push({
          severity: 'warning',
          code: 'mixed_size_ad',
          message: `El Ad «${ad.name}» tiene placements con URLs de clic distintas en el archivo de tracking: se usa la primera.`,
          adId: ad.id,
        });
      }
      existing.clickUrl = existing.clickUrl || clickUrl;
      existing.placementIds.push(placementId);
      fileIds.forEach((id) => { if (!existing.fileIds.includes(id)) existing.fileIds.push(id); });
      return;
    }
    actionsByAd.set(ad.id, {
      key: `ad:${ad.id}`,
      kind: 'update',
      isDefault,
      adId: ad.id,
      adName: ad.name,
      placementIds: [placementId],
      fileIds: [...fileIds],
      mode: isDefault ? options.defaultMode : options.standardMode,
      clickUrl: isDefault ? undefined : clickUrl,
      ...(activate ? { activate: true } : {}),
    });
  };

  candidatePlacements.forEach((placement) => {
    const fileIds = creatives.filter((c) => c.placementIds.includes(placement.id)).map((c) => c.fileId);
    const landing = landingFor(placement);
    if (fileIds.length === 0) {
      // No new creative here: the landing of the creatives already serving is never changed.
      if (familiesInFolder.has(placementFamily(placement) as 'video' | 'display')) uncovered.push(placement);
      return;
    }
    const size = creatives.find((c) => c.fileId === fileIds[0])!.size;
    const linked = ads.filter((ad) => ad.placementIds.includes(placement.id));
    const row: CompleteRow = {
      placement,
      siteName: siteName.get(placement.siteId),
      fileIds,
      standard: { action: 'none', adNames: [] },
      default: { action: options.setAsDefault ? 'none' : 'off', adNames: [] },
      landing,
    };

    // Existing standard Ads are reused: the active ones, or else the inactive (not archived) ones,
    // which are switched on. A new Ad is created only when the placement has none to reuse.
    const usableStandard = linked.filter((ad) => !ad.isDefault && !ad.archived);
    const activeStandard = usableStandard.filter((ad) => ad.active);
    const targets = activeStandard.length > 0 ? activeStandard : usableStandard;
    if (targets.length > 0) {
      targets.forEach((ad) => addUpdate(ad, placement.id, fileIds, false, landing?.url, !ad.active));
      row.standard = { action: activeStandard.length > 0 ? 'update' : 'activate', adNames: targets.map((a) => a.name) };
    } else {
      creates.push({
        key: `std:${placement.id}`,
        kind: 'create',
        isDefault: false,
        adName: placement.name,
        placementId: placement.id,
        placementIds: [placement.id],
        fileIds,
        mode: options.standardMode,
        clickUrl: landing?.url,
      });
      row.standard = { action: 'create', adNames: [placement.name] };
    }

    if (options.setAsDefault) {
      const defaultFileIds = defaultFileIdsFor(fileIds);
      const defaults = linked.filter((ad) => ad.isDefault);
      if (defaults.length > 0) {
        defaults.forEach((ad) => addUpdate(ad, placement.id, defaultFileIds, true));
        row.default = { action: 'update', adNames: defaults.map((a) => a.name) };
      } else if (options.createMissingDefaultAds) {
        const adName = defaultAdNameFor(placement, size);
        creates.push({
          key: `def:${placement.id}`,
          kind: 'create',
          isDefault: true,
          adName,
          placementId: placement.id,
          placementIds: [placement.id],
          fileIds: defaultFileIds,
          mode: options.defaultMode,
        });
        row.default = { action: 'create', adNames: [adName] };
      }
    }
    rows.push(row);
  });

  // Supports of this country in the tracking file. The support must be named exactly as in CM360
  // (placement name token or site name): otherwise it is an error, with the closest name as a hint.
  const matchedRows = new Set(rows.map((r) => r.landing?.key).filter(Boolean));
  const campaignNames = placements.map((p) => ({ name: p.name, siteName: siteName.get(p.siteId) }));
  countryRules.forEach((rule) => {
    if (matchedRows.has(ruleKey(rule))) return;
    const anyPlacement = campaignNames.some((p) => placementMatchesSupport(p.name, p.siteName, rule.support));
    if (anyPlacement) {
      issues.push({
        severity: 'warning',
        code: 'unmatched_file',
        message: `Tracking ${describeRule(rule)} (${rule.support}): sus placements no reciben creatividades nuevas en esta tirada (o no están en los sites elegidos). La landing de las creatividades que ya tienen no se cambia.`,
      });
      return;
    }
    const similar = similarSupportName(rule.support, campaignNames);
    issues.push({
      severity: 'error',
      code: 'tracking_support_mismatch',
      message: similar
        ? `Tracking ${describeRule(rule)}: el soporte «${rule.support}» no se llama igual que en CM360 («${similar}»). Corrige el nombre en el archivo: su URL no se aplica.`
        : `Tracking ${describeRule(rule)}: ningún placement de la campaña es del soporte «${rule.support}». Revisa el nombre en el archivo: su URL no se aplica.`,
    });
  });

  // Standard first, then Default Ads: updates before creations within each group.
  const updates = [...actionsByAd.values()];
  const actions = [
    ...updates.filter((a) => !a.isDefault),
    ...creates.filter((a) => !a.isDefault),
    ...updates.filter((a) => a.isDefault),
    ...creates.filter((a) => a.isDefault),
  ];

  const sortedIssues = issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
  return {
    creatives,
    actions,
    rows,
    extraFiles,
    uncovered,
    sets,
    needsSetChoice,
    issues: sortedIssues,
    blocked: sortedIssues.some((i) => i.severity === 'error' && (i.code === 'market_mismatch' || i.code === 'creative_dates')),
  };
};
