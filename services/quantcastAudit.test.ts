import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  auditCampaign,
  matchCampaign,
  nameTokens,
  QuantcastAuditInput,
  CmPlacementLite,
  QcAdSet,
  QcCampaignInfo,
} from './quantcastAudit';

// Names taken from the real Air Europa Switzerland campaign found in the Quantcast spike.
const CM_CAMPAIGN = { id: '99000001', name: 'ae-ch_kpi360_ttf_dis' };
const QC_PRS: QcCampaignInfo = { id: '9080879', name: 'ae-ch_kpi360_ttf_dis_prs_quantcast', state: 'ENABLED' };
const QC_RTG: QcCampaignInfo = { id: '9080881', name: 'ae-ch_kpi360_ttf_dis_rtg_quantcast', state: 'ENABLED' };

const placement = (id: string, name: string, extra: Partial<CmPlacementLite> = {}): CmPlacementLite => ({
  id, name: `${name}_${id}`, campaignId: CM_CAMPAIGN.id, archived: false, inactive: false, permanentlyArchived: false, ...extra,
});
const assignmentFor = (p: CmPlacementLite, creativeId: string, extra: Partial<QcAdSet['assignments'][number]> = {}) => ({
  creativeId, creativeName: p.name, cmPlacementId: p.id,
  state: 'CREATIVE_ASSIGNMENT_STATE_ENABLED', ...extra,
});
const adSet = (id: string, qc: QcCampaignInfo, suffix: string, assignments: QcAdSet['assignments'], state = 'ENABLED'): QcAdSet => ({
  id, qcCampaignId: qc.id, name: `${qc.name}_${suffix}`, state, assignments,
});

const GEN_DESKTOP = placement('436532549', 'ae-ch_kpi360_ttf_2026_dis_prs_quantcast_desktop_gen_970x250');
const GEN_MOBILE = placement('436532585', 'ae-ch_kpi360_ttf_2026_dis_prs_quantcast_mobile_gen_300x250');
const AUDEXT_DESKTOP = placement('436890999', 'ae-ch_kpi360_ttf_2026_dis_prs_quantcast_desktop_audience-extension_970x90');

const baseInput = (overrides: Partial<QuantcastAuditInput> = {}): QuantcastAuditInput => ({
  campaign: CM_CAMPAIGN,
  otherCampaignNames: [],
  campaignPlacements: [GEN_DESKTOP],
  foreignPlacements: [],
  qcCampaigns: [QC_PRS],
  qcAdSets: [adSet('1', QC_PRS, 'desktop', [assignmentFor(GEN_DESKTOP, 'c1')])],
  ...overrides,
});

const codes = (input: QuantcastAuditInput) => auditCampaign(input).issues.map((i) => i.code).sort();

test('nameTokens ignores year tokens and case', () => {
  assert.deepEqual(nameTokens('AE-CH_kpi360_ttf_2026_dis'), ['ae-ch', 'kpi360', 'ttf', 'dis']);
});

test('Quantcast campaign containing the CM360 campaign name matches', () => {
  assert.equal(matchCampaign(CM_CAMPAIGN.name, QC_PRS.name).kind, 'match');
});

test('Quantcast campaign with one different token (_nat_ instead of _dis_) is a naming warning', () => {
  const match = matchCampaign(CM_CAMPAIGN.name, 'ae-ch_kpi360_ttf_nat_prs_quantcast');
  assert.deepEqual(match, { kind: 'naming', diffs: [{ index: 3, expected: 'dis', found: 'nat' }] });
});

test('Quantcast campaign of another market does not match', () => {
  assert.equal(matchCampaign(CM_CAMPAIGN.name, 'ae-de_kpi360_ttf_dis_prs_quantcast').kind, 'none');
});

test('clean campaign has no issues and full coverage', () => {
  const result = auditCampaign(baseInput());
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.coverage[0].adSetIds, ['1']);
});

test('naming-variant Quantcast campaign is flagged unless it exactly matches another CM360 campaign', () => {
  const natQc: QcCampaignInfo = { id: '9', name: 'ae-ch_kpi360_ttf_nat_prs_quantcast', state: 'ENABLED' };
  assert.deepEqual(codes(baseInput({ qcCampaigns: [QC_PRS, natQc] })), ['campaign_naming']);
  assert.deepEqual(codes(baseInput({ qcCampaigns: [QC_PRS, natQc], otherCampaignNames: ['ae-ch_kpi360_ttf_nat'] })), []);
});

test('no matching Quantcast campaign is an error and skips missing-placement noise', () => {
  assert.deepEqual(codes(baseInput({ qcCampaigns: [], qcAdSets: [] })), ['no_campaign']);
});

test('ARCHIVED Quantcast campaigns are not matched', () => {
  const archived: QcCampaignInfo = { ...QC_PRS, state: 'ARCHIVED' };
  assert.deepEqual(codes(baseInput({ qcCampaigns: [archived], qcAdSets: [] })), ['no_campaign']);
});

test('prs placement in an rtg campaign is a strategy mismatch, reported once across ad sets', () => {
  const result = auditCampaign(baseInput({
    campaignPlacements: [GEN_DESKTOP],
    qcCampaigns: [QC_RTG],
    qcAdSets: [
      adSet('10', QC_RTG, 'desktop', [assignmentFor(GEN_DESKTOP, 'c2')]),
      adSet('11', QC_RTG, 'desktop-2', [assignmentFor(GEN_DESKTOP, 'c2')]),
    ],
  }));
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].code, 'strategy_mismatch');
  assert.deepEqual(result.issues[0].adSetIds, ['10', '11']);
});

test('audience-extension placement counts as rtg even when named prs', () => {
  assert.deepEqual(codes(baseInput({
    campaignPlacements: [AUDEXT_DESKTOP],
    qcCampaigns: [QC_RTG],
    qcAdSets: [adSet('10', QC_RTG, 'desktop', [assignmentFor(AUDEXT_DESKTOP, 'c2')])],
  })), []);
});

test('mobile placement in a desktop ad set is a device mismatch', () => {
  assert.deepEqual(codes(baseInput({
    campaignPlacements: [GEN_DESKTOP, GEN_MOBILE],
    qcAdSets: [adSet('1', QC_PRS, 'desktop', [assignmentFor(GEN_DESKTOP, 'c1'), assignmentFor(GEN_MOBILE, 'c3')])],
  })), ['device_mismatch']);
});

test('quantcast placement not assigned anywhere is missing; non-quantcast, archived and inactive ones are ignored', () => {
  const dv360Only = placement('500', 'ae-ch_kpi360_ttf_2026_dis_prs_dv360_desktop_gen_300x250');
  const archived = placement('501', 'ae-ch_kpi360_ttf_2026_dis_prs_quantcast_desktop_gen_300x250', { archived: true });
  const inactive = placement('502', 'ae-ch_kpi360_ttf_2026_dis_prs_quantcast_mobile_gen_300x250', { inactive: true });
  const result = auditCampaign(baseInput({ campaignPlacements: [GEN_DESKTOP, GEN_MOBILE, dv360Only, archived, inactive] }));
  assert.deepEqual(result.issues.map((i) => [i.code, i.placementId]), [['missing_in_quantcast', GEN_MOBILE.id]]);
});

test('permanently archived placements are ignored entirely; archived ones still warn when assigned', () => {
  const gone = placement('436890999', 'ae-ch_kpi360_ttf_2026_dis_prs_quantcast_desktop_audience-extension_970x90', { archived: true, permanentlyArchived: true });
  const ignored = auditCampaign(baseInput({
    campaignPlacements: [GEN_DESKTOP, gone],
    qcAdSets: [adSet('1', QC_PRS, 'desktop', [assignmentFor(GEN_DESKTOP, 'c1'), assignmentFor(gone, 'c8')])],
  }));
  assert.deepEqual(ignored.issues, []);
  assert.deepEqual(ignored.coverage.map((r) => r.placement.id), [GEN_DESKTOP.id]);

  const archived = { ...GEN_DESKTOP, archived: true };
  assert.deepEqual(codes(baseInput({ campaignPlacements: [archived] })), ['placement_archived']);
});

test('renamed placement in CM360 is a name mismatch', () => {
  assert.deepEqual(codes(baseInput({
    qcAdSets: [adSet('1', QC_PRS, 'desktop', [assignmentFor(GEN_DESKTOP, 'c1', { creativeName: 'old_name_436532549' })])],
  })), ['name_mismatch']);
});

test('placement from another campaign and archived placement are errors', () => {
  const foreign = placement('999', 'ae-es_prisa_ttf_2026_dis_bd-home_directo_all_as_1200x250', { campaignId: '1', campaignName: 'ae-es_prisa_ttf', archived: true });
  assert.deepEqual(codes(baseInput({
    qcAdSets: [adSet('1', QC_PRS, 'desktop', [assignmentFor(GEN_DESKTOP, 'c1'), assignmentFor(foreign, 'c9')])],
    foreignPlacements: [foreign],
  })), ['placement_archived', 'placement_other_campaign']);
});

test('unknown placement ID and creative without a recognizable CM tag are flagged', () => {
  assert.deepEqual(codes(baseInput({
    qcAdSets: [adSet('1', QC_PRS, 'desktop', [
      assignmentFor(GEN_DESKTOP, 'c1'),
      { creativeId: 'c4', creativeName: 'x_999', cmPlacementId: '999', state: 'CREATIVE_ASSIGNMENT_STATE_ENABLED' },
      { creativeId: 'c5', creativeName: 'uploaded_banner', state: 'CREATIVE_ASSIGNMENT_STATE_ENABLED' },
    ])],
  })), ['creative_not_from_cm', 'placement_not_found']);
});

test('paused assignment and active ad set without creatives are warnings; deleted assignments are ignored', () => {
  const result = auditCampaign(baseInput({
    qcAdSets: [
      adSet('1', QC_PRS, 'desktop', [
        assignmentFor(GEN_DESKTOP, 'c1', { state: 'CREATIVE_ASSIGNMENT_STATE_PAUSED' }),
        { creativeId: 'c6', creativeName: 'old_removed', cmPlacementId: '777', state: 'CREATIVE_ASSIGNMENT_STATE_DELETED' },
      ]),
      adSet('2', QC_PRS, 'mobile', []),
    ],
  }));
  assert.deepEqual(result.issues.map((i) => i.code).sort(), ['ad_set_without_creatives', 'assignment_paused']);
  assert.ok(result.issues.every((i) => i.severity === 'warning'));
});

test('a paused ad set without creatives is not flagged', () => {
  assert.deepEqual(codes(baseInput({
    qcAdSets: [adSet('1', QC_PRS, 'desktop', [assignmentFor(GEN_DESKTOP, 'c1')]), adSet('2', QC_PRS, 'mobile', [], 'PAUSED')],
  })), []);
});
