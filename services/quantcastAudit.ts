// Pure cross-check logic between a CM360 campaign and its Quantcast campaign/ad sets.
//
// Deliberately self-contained: it does not import anything from traffickingAudit.ts (the
// validated DV360 audit) so that file stays completely untouched. The small amount of
// duplication (name-token matching, strategy/device inference) is the price of that isolation.

export interface CmPlacementLite {
  id: string;
  name: string;
  campaignId: string;
  campaignName?: string;
  archived: boolean;
  inactive: boolean;
  permanentlyArchived: boolean;
}

/** A Quantcast campaign (the equivalent of a DV360 Insertion Order). */
export interface QcCampaignInfo {
  id: string;
  name: string;
  /** CampaignState: PAUSED | ENABLED | DELETED | ARCHIVED */
  state: string;
}

/** One creative assignment inside a Quantcast ad set, already resolved to its CM360 placement. */
export interface QcCreativeAssignment {
  creativeId: string;
  creativeName: string;
  /** CreativeAssignmentState: CREATIVE_ASSIGNMENT_STATE_ENABLED | _PAUSED | _DELETED | _UNSPECIFIED */
  state: string;
  /** Extracted from the ad-server tag's `data-dcm-placement`; absent for non-CM360 creatives. */
  cmPlacementId?: string;
}

/** A Quantcast ad set (the equivalent of a DV360 Display line item) with its creative assignments. */
export interface QcAdSet {
  id: string;
  name: string;
  qcCampaignId: string;
  /** AdSetState: PAUSED | ENABLED | DELETED */
  state: string;
  assignments: QcCreativeAssignment[];
}

export type IssueSeverity = 'error' | 'warning';

export type IssueCode =
  | 'no_campaign'
  | 'campaign_naming'
  | 'missing_in_quantcast'
  | 'assignment_paused'
  | 'ad_set_without_creatives'
  | 'creative_not_from_cm'
  | 'placement_not_found'
  | 'placement_other_campaign'
  | 'placement_archived'
  | 'name_mismatch'
  | 'strategy_mismatch'
  | 'device_mismatch';

export interface AuditIssue {
  severity: IssueSeverity;
  code: IssueCode;
  message: string;
  qcCampaignId?: string;
  qcCampaignName?: string;
  adSetIds: string[];
  placementId?: string;
  placementName?: string;
  creativeId?: string;
}

export interface TokenDiff {
  index: number;
  expected: string;
  found: string;
}

export type CampaignMatch =
  | { kind: 'match' }
  | { kind: 'naming'; diffs: TokenDiff[] }
  | { kind: 'none' };

export interface CampaignMatchRow {
  qcCampaign: QcCampaignInfo;
  kind: 'match' | 'naming';
  diffs: TokenDiff[];
}

export interface PlacementCoverageRow {
  placement: CmPlacementLite;
  expectedInQuantcast: boolean;
  adSetIds: string[];
  qcCampaignIds: string[];
}

export interface AuditResult {
  campaignMatches: CampaignMatchRow[];
  coverage: PlacementCoverageRow[];
  issues: AuditIssue[];
  counts: { errors: number; warnings: number; adSets: number; assignedPlacements: number };
}

export const STRATEGY_TOKENS = ['prs', 'rtg'];
export const DEVICE_TOKENS = ['desktop', 'mobile', 'tablet', 'ctv'];
const QUANTCAST_TOKEN = 'quantcast';
const ARCHIVED_CAMPAIGN_STATES = ['ARCHIVED', 'DELETED'];
const NOT_CURRENT_ASSIGNMENT_STATES = ['CREATIVE_ASSIGNMENT_STATE_DELETED', 'CREATIVE_ASSIGNMENT_STATE_UNSPECIFIED'];

const isYearToken = (token: string) => /^(19|20)\d{2}$/.test(token);

/** Lowercased `_`-separated tokens, ignoring year tokens (placements carry `_2025_`, campaigns don't). */
export const nameTokens = (name: string): string[] =>
  name.trim().toLowerCase().split('_').filter((t) => t !== '' && !isYearToken(t));

/** The CM360 campaign name must be the prefix of the Quantcast campaign name; one differing token is a naming warning. */
export const matchCampaign = (cmCampaignName: string, qcCampaignName: string): CampaignMatch => {
  const cm = nameTokens(cmCampaignName);
  const qc = nameTokens(qcCampaignName);
  if (cm.length === 0 || qc.length < cm.length || qc[0] !== cm[0]) return { kind: 'none' };

  const diffs: TokenDiff[] = [];
  cm.forEach((expected, index) => {
    if (qc[index] !== expected) diffs.push({ index, expected, found: qc[index] });
  });
  if (diffs.length === 0) return { kind: 'match' };
  if (diffs.length === 1) return { kind: 'naming', diffs };
  return { kind: 'none' };
};

/** Tokens after the campaign prefix, e.g. `prs quantcast desktop gen 970x250 436532549`. */
const tokensAfterCampaign = (cmCampaignName: string, name: string): string[] => {
  const cm = nameTokens(cmCampaignName);
  const tokens = nameTokens(name);
  const hasPrefix = cm.every((t, i) => tokens[i] === t);
  return hasPrefix ? tokens.slice(cm.length) : tokens;
};

const strategyOf = (cmCampaignName: string, name: string): string | undefined => {
  const first = tokensAfterCampaign(cmCampaignName, name)[0];
  return first && STRATEGY_TOKENS.includes(first) ? first : undefined;
};

/** Audience-extension placements are retargeting even when their name says `prs` (same rule as the DV360 audit). */
const placementStrategyOf = (cmCampaignName: string, name: string): string | undefined =>
  nameTokens(name).some((t) => t.startsWith('audience-extension')) ? 'rtg' : strategyOf(cmCampaignName, name);

const deviceOf = (cmCampaignName: string, name: string): string | undefined =>
  tokensAfterCampaign(cmCampaignName, name).find((t) => DEVICE_TOKENS.includes(t));

export const isExpectedInQuantcast = (placement: CmPlacementLite) =>
  !placement.archived && !placement.inactive && nameTokens(placement.name).includes(QUANTCAST_TOKEN);

export interface QuantcastAuditInput {
  campaign: { id: string; name: string };
  /** Names of the advertiser's other CM360 campaigns: a Quantcast campaign matching one of them exactly is not a naming error. */
  otherCampaignNames: string[];
  /** Placements of the audited campaign. */
  campaignPlacements: CmPlacementLite[];
  /** Placements referenced by Quantcast creatives that belong to other campaigns. */
  foreignPlacements: CmPlacementLite[];
  qcCampaigns: QcCampaignInfo[];
  qcAdSets: QcAdSet[];
}

export const auditCampaign = (input: QuantcastAuditInput): AuditResult => {
  const { campaign } = input;
  const issues = new Map<string, AuditIssue>();
  const addIssue = (key: string, issue: Omit<AuditIssue, 'adSetIds'>, adSetId?: string) => {
    const existing = issues.get(key);
    if (existing) {
      if (adSetId && !existing.adSetIds.includes(adSetId)) existing.adSetIds.push(adSetId);
      return;
    }
    issues.set(key, { ...issue, adSetIds: adSetId ? [adSetId] : [] });
  };

  // 1. CM360 campaign <-> Quantcast campaigns
  const otherCampaigns = input.otherCampaignNames.filter((n) => n !== campaign.name);
  const campaignMatches: CampaignMatchRow[] = [];
  input.qcCampaigns
    .filter((qc) => !ARCHIVED_CAMPAIGN_STATES.includes(qc.state))
    .forEach((qc) => {
      const match = matchCampaign(campaign.name, qc.name);
      if (match.kind === 'match') {
        campaignMatches.push({ qcCampaign: qc, kind: 'match', diffs: [] });
      } else if (match.kind === 'naming') {
        const belongsToOtherCampaign = otherCampaigns.some((n) => matchCampaign(n, qc.name).kind === 'match');
        if (belongsToOtherCampaign) return;
        campaignMatches.push({ qcCampaign: qc, kind: 'naming', diffs: match.diffs });
        const diff = match.diffs[0];
        addIssue(`campaign_naming:${qc.id}`, {
          severity: 'warning',
          code: 'campaign_naming',
          message: `La campaña de Quantcast usa «${diff.found}» donde la de CM360 dice «${diff.expected}»: posible estrategia distinta o error de naming.`,
          qcCampaignId: qc.id,
          qcCampaignName: qc.name,
        });
      }
    });

  if (!campaignMatches.some((m) => m.kind === 'match')) {
    addIssue('no_campaign', {
      severity: 'error',
      code: 'no_campaign',
      message: 'No hay ninguna campaña en Quantcast cuyo nombre contenga el de la campaña de CM360.',
    });
  }

  // 2. Creative assignments of the matched campaigns' ad sets (naming-variant campaigns are only reported, not audited)
  const matchedCampaigns = new Map(campaignMatches.filter((m) => m.kind === 'match').map((m) => [m.qcCampaign.id, m.qcCampaign]));
  const adSets = input.qcAdSets.filter((a) => matchedCampaigns.has(a.qcCampaignId) && a.state !== 'DELETED');
  const campaignPlacementsById = new Map(input.campaignPlacements.map((p) => [p.id, p]));
  const foreignPlacementsById = new Map(input.foreignPlacements.map((p) => [p.id, p]));
  const assignments = new Map<string, { adSetIds: Set<string>; qcCampaignIds: Set<string> }>();

  adSets.forEach((adSet) => {
    const qc = matchedCampaigns.get(adSet.qcCampaignId)!;
    const current = adSet.assignments.filter((a) => !NOT_CURRENT_ASSIGNMENT_STATES.includes(a.state));

    if (current.length === 0 && adSet.state === 'ENABLED') {
      addIssue(`ad_set_without_creatives:${adSet.id}`, {
        severity: 'warning',
        code: 'ad_set_without_creatives',
        message: `Ad set activo sin creatividades: ${adSet.name}`,
        qcCampaignId: qc.id,
        qcCampaignName: qc.name,
      }, adSet.id);
    }

    current.forEach((assignment) => {
      const qcRef = { qcCampaignId: qc.id, qcCampaignName: qc.name, creativeId: assignment.creativeId };

      if (assignment.state === 'CREATIVE_ASSIGNMENT_STATE_PAUSED') {
        addIssue(`assignment_paused:${qc.id}:${assignment.creativeId}`, {
          severity: 'warning',
          code: 'assignment_paused',
          message: `Asignación en pausa, la creatividad no se sirve: ${assignment.creativeName}`,
          ...qcRef,
        }, adSet.id);
      }

      const placementId = assignment.cmPlacementId;
      if (!placementId) {
        addIssue(`creative_not_from_cm:${qc.id}:${assignment.creativeId}`, {
          severity: 'warning',
          code: 'creative_not_from_cm',
          message: `Creatividad sin tag de CM360 reconocible: ${assignment.creativeName}`,
          ...qcRef,
        }, adSet.id);
        return;
      }

      const own = campaignPlacementsById.get(placementId);
      const foreign = foreignPlacementsById.get(placementId);
      const placement = own || foreign;
      const placementRef = { ...qcRef, placementId, placementName: placement?.name || assignment.creativeName };
      const key = (code: IssueCode) => `${code}:${qc.id}:${placementId}`;

      if (!placement) {
        addIssue(key('placement_not_found'), {
          severity: 'error',
          code: 'placement_not_found',
          message: `El placement ${placementId} no existe en CM360 o no es accesible.`,
          ...placementRef,
        }, adSet.id);
        return;
      }
      if (placement.permanentlyArchived) return;

      if (own) {
        const entry = assignments.get(placementId) || { adSetIds: new Set<string>(), qcCampaignIds: new Set<string>() };
        entry.adSetIds.add(adSet.id);
        entry.qcCampaignIds.add(qc.id);
        assignments.set(placementId, entry);
      } else {
        addIssue(key('placement_other_campaign'), {
          severity: 'error',
          code: 'placement_other_campaign',
          message: `Placement de otra campaña (${placement.campaignName || placement.campaignId}) asignado en esta campaña de Quantcast.`,
          ...placementRef,
        }, adSet.id);
      }

      if (placement.archived) {
        addIssue(key('placement_archived'), {
          severity: 'error',
          code: 'placement_archived',
          message: 'El placement está archivado en CM360 pero sigue asignado en Quantcast.',
          ...placementRef,
        }, adSet.id);
      }

      if (placement.name !== assignment.creativeName) {
        addIssue(key('name_mismatch'), {
          severity: 'warning',
          code: 'name_mismatch',
          message: `El nombre en Quantcast («${assignment.creativeName}») no coincide con el de CM360.`,
          ...placementRef,
        }, adSet.id);
      }

      const campaignStrategy = strategyOf(campaign.name, qc.name);
      const placementStrategy = placementStrategyOf(campaign.name, placement.name);
      if (campaignStrategy && placementStrategy && campaignStrategy !== placementStrategy) {
        addIssue(key('strategy_mismatch'), {
          severity: 'error',
          code: 'strategy_mismatch',
          message: `Estrategia distinta: la campaña es «${campaignStrategy}» y el placement «${placementStrategy}».`,
          ...placementRef,
        }, adSet.id);
      }

      const adSetDevice = deviceOf(campaign.name, adSet.name) || deviceOf(campaign.name, qc.name);
      const placementDevice = deviceOf(campaign.name, placement.name);
      if (adSetDevice && placementDevice && adSetDevice !== placementDevice) {
        addIssue(key('device_mismatch'), {
          severity: 'error',
          code: 'device_mismatch',
          message: `Dispositivo distinto: el ad set es «${adSetDevice}» y el placement «${placementDevice}».`,
          ...placementRef,
        }, adSet.id);
      }
    });
  });

  // 3. Expected placements missing in Quantcast
  const coverage: PlacementCoverageRow[] = input.campaignPlacements
    .filter((p) => !p.permanentlyArchived)
    .map((placement) => {
      const entry = assignments.get(placement.id);
      return {
        placement,
        expectedInQuantcast: isExpectedInQuantcast(placement),
        adSetIds: entry ? [...entry.adSetIds] : [],
        qcCampaignIds: entry ? [...entry.qcCampaignIds] : [],
      };
    });

  if (matchedCampaigns.size > 0) {
    coverage
      .filter((row) => row.expectedInQuantcast && row.adSetIds.length === 0)
      .forEach((row) => {
        addIssue(`missing_in_quantcast:${row.placement.id}`, {
          severity: 'error',
          code: 'missing_in_quantcast',
          message: 'Placement de Quantcast en CM360 que no está asignado en ningún ad set.',
          placementId: row.placement.id,
          placementName: row.placement.name,
        });
      });
  }

  const issueList = [...issues.values()].sort((a, b) =>
    a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1,
  );

  return {
    campaignMatches,
    coverage,
    issues: issueList,
    counts: {
      errors: issueList.filter((i) => i.severity === 'error').length,
      warnings: issueList.filter((i) => i.severity === 'warning').length,
      adSets: adSets.length,
      assignedPlacements: assignments.size,
    },
  };
};
