// Pure cross-check logic between a CM360 campaign and its DV360 insertion orders.
// No API calls here: callers load the data (see services/dv360.ts) and pass it in.

export interface CmPlacementLite {
  id: string;
  name: string;
  campaignId: string;
  campaignName?: string;
  archived: boolean;
}

export interface DvInsertionOrder {
  insertionOrderId: string;
  displayName: string;
  entityStatus: string;
}

export interface DvLineItem {
  lineItemId: string;
  insertionOrderId: string;
  displayName: string;
  entityStatus: string;
  creativeIds?: string[];
}

export interface DvCreative {
  creativeId: string;
  displayName: string;
  cmPlacementId?: string;
  cmTrackingAd?: { cmPlacementId?: string };
  reviewStatus?: { approvalStatus?: string };
}

export type IssueSeverity = 'error' | 'warning';

export type IssueCode =
  | 'no_insertion_order'
  | 'io_naming'
  | 'missing_in_dv360'
  | 'li_without_creatives'
  | 'creative_not_from_cm'
  | 'placement_not_found'
  | 'placement_other_campaign'
  | 'placement_archived'
  | 'name_mismatch'
  | 'strategy_mismatch'
  | 'device_mismatch'
  | 'not_servable';

export interface AuditIssue {
  severity: IssueSeverity;
  code: IssueCode;
  message: string;
  insertionOrderId?: string;
  insertionOrderName?: string;
  lineItemIds: string[];
  placementId?: string;
  placementName?: string;
  creativeId?: string;
}

export interface TokenDiff {
  index: number;
  expected: string;
  found: string;
}

export type IoMatch =
  | { kind: 'match' }
  | { kind: 'naming'; diffs: TokenDiff[] }
  | { kind: 'none' };

export interface IoMatchRow {
  io: DvInsertionOrder;
  kind: 'match' | 'naming';
  diffs: TokenDiff[];
}

export interface PlacementCoverageRow {
  placement: CmPlacementLite;
  expectedInDv360: boolean;
  lineItemIds: string[];
  insertionOrderIds: string[];
}

export interface AuditResult {
  ioMatches: IoMatchRow[];
  coverage: PlacementCoverageRow[];
  issues: AuditIssue[];
  counts: { errors: number; warnings: number; lineItems: number; assignedPlacements: number };
}

export const STRATEGY_TOKENS = ['prs', 'rtg'];
export const DEVICE_TOKENS = ['desktop', 'mobile', 'tablet', 'ctv'];
const DV360_TOKEN = 'dv360';
const NOT_SERVABLE = ['APPROVAL_STATUS_PENDING_NOT_SERVABLE', 'APPROVAL_STATUS_REJECTED_NOT_SERVABLE'];

const isYearToken = (token: string) => /^(19|20)\d{2}$/.test(token);

/** Lowercased `_`-separated tokens, ignoring year tokens (placements carry `_2025_`, campaigns don't). */
export const nameTokens = (name: string): string[] =>
  name.trim().toLowerCase().split('_').filter((t) => t !== '' && !isYearToken(t));

/**
 * The campaign name must be the prefix of the IO name; exactly one differing token is a naming warning.
 * The first token is the market (`ae-ch`, `ae-es`…): a different market is a different campaign, not a typo.
 */
export const matchInsertionOrder = (campaignName: string, ioName: string): IoMatch => {
  const campaign = nameTokens(campaignName);
  const io = nameTokens(ioName);
  if (campaign.length === 0 || io.length < campaign.length || io[0] !== campaign[0]) return { kind: 'none' };

  const diffs: TokenDiff[] = [];
  campaign.forEach((expected, index) => {
    if (io[index] !== expected) diffs.push({ index, expected, found: io[index] });
  });
  if (diffs.length === 0) return { kind: 'match' };
  if (diffs.length === 1) return { kind: 'naming', diffs };
  return { kind: 'none' };
};

/** Tokens after the campaign prefix, e.g. `prs dv360 desktop gen 160x600 441002425`. */
const tokensAfterCampaign = (campaignName: string, name: string): string[] => {
  const campaign = nameTokens(campaignName);
  const tokens = nameTokens(name);
  const hasPrefix = campaign.every((t, i) => tokens[i] === t);
  return hasPrefix ? tokens.slice(campaign.length) : tokens;
};

const strategyOf = (campaignName: string, name: string): string | undefined => {
  const first = tokensAfterCampaign(campaignName, name)[0];
  return first && STRATEGY_TOKENS.includes(first) ? first : undefined;
};

const deviceOf = (campaignName: string, name: string): string | undefined =>
  tokensAfterCampaign(campaignName, name).find((t) => DEVICE_TOKENS.includes(t));

export const isExpectedInDv360 = (placement: CmPlacementLite) =>
  !placement.archived && nameTokens(placement.name).includes(DV360_TOKEN);

const creativePlacementId = (creative: DvCreative) =>
  creative.cmPlacementId || creative.cmTrackingAd?.cmPlacementId || undefined;

export interface AuditInput {
  campaign: { id: string; name: string };
  /** Names of the advertiser's other CM360 campaigns: an IO that matches one of them exactly is not a naming error. */
  otherCampaignNames: string[];
  /** Placements of the audited campaign. */
  campaignPlacements: CmPlacementLite[];
  /** Placements referenced by DV360 creatives that belong to other campaigns. */
  foreignPlacements: CmPlacementLite[];
  insertionOrders: DvInsertionOrder[];
  lineItems: DvLineItem[];
  creatives: DvCreative[];
}

export const auditCampaign = (input: AuditInput): AuditResult => {
  const { campaign } = input;
  const issues = new Map<string, AuditIssue>();
  const addIssue = (key: string, issue: Omit<AuditIssue, 'lineItemIds'>, lineItemId?: string) => {
    const existing = issues.get(key);
    if (existing) {
      if (lineItemId && !existing.lineItemIds.includes(lineItemId)) existing.lineItemIds.push(lineItemId);
      return;
    }
    issues.set(key, { ...issue, lineItemIds: lineItemId ? [lineItemId] : [] });
  };

  // 1. Campaign <-> insertion orders
  const otherCampaigns = input.otherCampaignNames.filter((n) => n !== campaign.name);
  const ioMatches: IoMatchRow[] = [];
  input.insertionOrders
    .filter((io) => io.entityStatus !== 'ENTITY_STATUS_ARCHIVED')
    .forEach((io) => {
      const match = matchInsertionOrder(campaign.name, io.displayName);
      if (match.kind === 'match') {
        ioMatches.push({ io, kind: 'match', diffs: [] });
      } else if (match.kind === 'naming') {
        const belongsToOtherCampaign = otherCampaigns.some((n) => matchInsertionOrder(n, io.displayName).kind === 'match');
        if (belongsToOtherCampaign) return;
        ioMatches.push({ io, kind: 'naming', diffs: match.diffs });
        const diff = match.diffs[0];
        addIssue(`io_naming:${io.insertionOrderId}`, {
          severity: 'warning',
          code: 'io_naming',
          message: `El IO usa «${diff.found}» donde la campaña dice «${diff.expected}»: posible estrategia distinta o error de naming.`,
          insertionOrderId: io.insertionOrderId,
          insertionOrderName: io.displayName,
        });
      }
    });

  if (!ioMatches.some((m) => m.kind === 'match')) {
    addIssue('no_insertion_order', {
      severity: 'error',
      code: 'no_insertion_order',
      message: 'No hay ningún Insertion Order en DV360 cuyo nombre contenga el de la campaña.',
    });
  }

  // 2. Creative assignments of the matched IOs' line items (naming-variant IOs are only reported, not audited)
  const matchedIos = new Map(ioMatches.filter((m) => m.kind === 'match').map((m) => [m.io.insertionOrderId, m.io]));
  const lineItems = input.lineItems.filter(
    (li) => matchedIos.has(li.insertionOrderId) && li.entityStatus !== 'ENTITY_STATUS_ARCHIVED',
  );
  const creativesById = new Map(input.creatives.map((c) => [c.creativeId, c]));
  const campaignPlacementsById = new Map(input.campaignPlacements.map((p) => [p.id, p]));
  const foreignPlacementsById = new Map(input.foreignPlacements.map((p) => [p.id, p]));
  const assignments = new Map<string, { lineItemIds: Set<string>; ioIds: Set<string> }>();

  lineItems.forEach((li) => {
    const io = matchedIos.get(li.insertionOrderId)!;
    const creativeIds = li.creativeIds || [];

    if (creativeIds.length === 0 && li.entityStatus === 'ENTITY_STATUS_ACTIVE') {
      addIssue(`li_without_creatives:${li.lineItemId}`, {
        severity: 'warning',
        code: 'li_without_creatives',
        message: `Line item activo sin creatividades: ${li.displayName}`,
        insertionOrderId: io.insertionOrderId,
        insertionOrderName: io.displayName,
      }, li.lineItemId);
    }

    creativeIds.forEach((creativeId) => {
      const creative = creativesById.get(creativeId);
      if (!creative) return;
      const ioRef = { insertionOrderId: io.insertionOrderId, insertionOrderName: io.displayName, creativeId };

      if (creative.reviewStatus?.approvalStatus && NOT_SERVABLE.includes(creative.reviewStatus.approvalStatus)) {
        const rejected = creative.reviewStatus.approvalStatus.includes('REJECTED');
        addIssue(`not_servable:${creativeId}`, {
          severity: 'warning',
          code: 'not_servable',
          message: rejected
            ? `Creatividad rechazada en la revisión de Google, no se sirve: ${creative.displayName}`
            : `Creatividad pendiente de revisión, todavía no se sirve en todos los exchanges: ${creative.displayName}`,
          creativeId,
        }, li.lineItemId);
      }

      const placementId = creativePlacementId(creative);
      if (!placementId) {
        addIssue(`creative_not_from_cm:${io.insertionOrderId}:${creativeId}`, {
          severity: 'warning',
          code: 'creative_not_from_cm',
          message: `Creatividad no vinculada a un placement de CM360: ${creative.displayName}`,
          ...ioRef,
        }, li.lineItemId);
        return;
      }

      const own = campaignPlacementsById.get(placementId);
      const foreign = foreignPlacementsById.get(placementId);
      const placement = own || foreign;
      const placementRef = { ...ioRef, placementId, placementName: placement?.name || creative.displayName };
      const key = (code: IssueCode) => `${code}:${io.insertionOrderId}:${placementId}`;

      if (!placement) {
        addIssue(key('placement_not_found'), {
          severity: 'error',
          code: 'placement_not_found',
          message: `El placement ${placementId} no existe en CM360 o no es accesible.`,
          ...placementRef,
        }, li.lineItemId);
        return;
      }

      if (own) {
        const entry = assignments.get(placementId) || { lineItemIds: new Set<string>(), ioIds: new Set<string>() };
        entry.lineItemIds.add(li.lineItemId);
        entry.ioIds.add(io.insertionOrderId);
        assignments.set(placementId, entry);
      } else {
        addIssue(key('placement_other_campaign'), {
          severity: 'error',
          code: 'placement_other_campaign',
          message: `Placement de otra campaña (${placement.campaignName || placement.campaignId}) asignado en este IO.`,
          ...placementRef,
        }, li.lineItemId);
      }

      if (placement.archived) {
        addIssue(key('placement_archived'), {
          severity: 'error',
          code: 'placement_archived',
          message: 'El placement está archivado en CM360 pero sigue asignado en DV360.',
          ...placementRef,
        }, li.lineItemId);
      }

      if (placement.name !== creative.displayName) {
        addIssue(key('name_mismatch'), {
          severity: 'warning',
          code: 'name_mismatch',
          message: `El nombre en DV360 («${creative.displayName}») no coincide con el de CM360.`,
          ...placementRef,
        }, li.lineItemId);
      }

      const ioStrategy = strategyOf(campaign.name, io.displayName);
      const placementStrategy = strategyOf(campaign.name, placement.name);
      if (ioStrategy && placementStrategy && ioStrategy !== placementStrategy) {
        addIssue(key('strategy_mismatch'), {
          severity: 'error',
          code: 'strategy_mismatch',
          message: `Estrategia distinta: el IO es «${ioStrategy}» y el placement «${placementStrategy}».`,
          ...placementRef,
        }, li.lineItemId);
      }

      const lineDevice = deviceOf(campaign.name, li.displayName) || deviceOf(campaign.name, io.displayName);
      const placementDevice = deviceOf(campaign.name, placement.name);
      if (lineDevice && placementDevice && lineDevice !== placementDevice) {
        addIssue(key('device_mismatch'), {
          severity: 'error',
          code: 'device_mismatch',
          message: `Dispositivo distinto: el line item es «${lineDevice}» y el placement «${placementDevice}».`,
          ...placementRef,
        }, li.lineItemId);
      }
    });
  });

  // 3. Expected placements missing in DV360
  const coverage: PlacementCoverageRow[] = input.campaignPlacements.map((placement) => {
    const entry = assignments.get(placement.id);
    return {
      placement,
      expectedInDv360: isExpectedInDv360(placement),
      lineItemIds: entry ? [...entry.lineItemIds] : [],
      insertionOrderIds: entry ? [...entry.ioIds] : [],
    };
  });

  if (matchedIos.size > 0) {
    coverage
      .filter((row) => row.expectedInDv360 && row.lineItemIds.length === 0)
      .forEach((row) => {
        addIssue(`missing_in_dv360:${row.placement.id}`, {
          severity: 'error',
          code: 'missing_in_dv360',
          message: 'Placement de DV360 en CM360 que no está asignado en ningún line item.',
          placementId: row.placement.id,
          placementName: row.placement.name,
        });
      });
  }

  const issueList = [...issues.values()].sort((a, b) =>
    a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1,
  );

  return {
    ioMatches,
    coverage,
    issues: issueList,
    counts: {
      errors: issueList.filter((i) => i.severity === 'error').length,
      warnings: issueList.filter((i) => i.severity === 'warning').length,
      lineItems: lineItems.length,
      assignedPlacements: assignments.size,
    },
  };
};
