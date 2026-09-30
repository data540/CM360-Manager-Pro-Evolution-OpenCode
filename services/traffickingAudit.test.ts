import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  auditCampaign,
  matchInsertionOrder,
  nameTokens,
  AuditInput,
  CmPlacementLite,
  DvCreative,
  DvLineItem,
} from './traffickingAudit';

// Names taken from the real Air Europa campaign used in the DV360 spike.
const CAMPAIGN = { id: '35367036', name: 'ae-ch_kpi360_ao_dis' };
const PRS_DESKTOP_IO = { insertionOrderId: '1026288086', displayName: 'ae-ch_kpi360_ao_dis_prs_dv360_desktop', entityStatus: 'ENTITY_STATUS_ACTIVE' };
const RTG_DESKTOP_IO = { insertionOrderId: '1026287810', displayName: 'ae-ch_kpi360_ao_dis_rtg_dv360_desktop', entityStatus: 'ENTITY_STATUS_ACTIVE' };

const placement = (id: string, name: string, extra: Partial<CmPlacementLite> = {}): CmPlacementLite => ({
  id, name: `${name}_${id}`, campaignId: CAMPAIGN.id, archived: false, ...extra,
});
const creativeFor = (p: CmPlacementLite, creativeId: string, extra: Partial<DvCreative> = {}): DvCreative => ({
  creativeId, displayName: p.name, cmPlacementId: p.id,
  reviewStatus: { approvalStatus: 'APPROVAL_STATUS_APPROVED_SERVABLE' }, ...extra,
});
const lineItem = (id: string, io: typeof PRS_DESKTOP_IO, suffix: string, creativeIds: string[]): DvLineItem => ({
  lineItemId: id, insertionOrderId: io.insertionOrderId, displayName: `${io.displayName}_${suffix}`,
  entityStatus: 'ENTITY_STATUS_ACTIVE', creativeIds,
});

const GEN_DESKTOP = placement('441002425', 'ae-ch_kpi360_ao_2025_dis_prs_dv360_desktop_gen_160x600');
const GEN_MOBILE = placement('441002434', 'ae-ch_kpi360_ao_2025_dis_prs_dv360_mobile_gen_320x480');
const AUDEXT_DESKTOP = placement('441269204', 'ae-ch_kpi360_ao_2025_dis_prs_dv360_desktop_audience-extension_160x600');

const baseInput = (overrides: Partial<AuditInput> = {}): AuditInput => ({
  campaign: CAMPAIGN,
  otherCampaignNames: [],
  campaignPlacements: [GEN_DESKTOP],
  foreignPlacements: [],
  insertionOrders: [PRS_DESKTOP_IO],
  lineItems: [lineItem('1', PRS_DESKTOP_IO, 'affinity', ['c1'])],
  creatives: [creativeFor(GEN_DESKTOP, 'c1')],
  ...overrides,
});

const codes = (input: AuditInput) => auditCampaign(input).issues.map((i) => i.code).sort();

test('nameTokens ignores year tokens and case', () => {
  assert.deepEqual(nameTokens('AE-CH_kpi360_ao_2025_dis'), ['ae-ch', 'kpi360', 'ao', 'dis']);
});

test('IO containing the campaign name matches', () => {
  assert.equal(matchInsertionOrder(CAMPAIGN.name, PRS_DESKTOP_IO.displayName).kind, 'match');
});

test('IO with one different token (_nat_ instead of _dis_) is a naming warning', () => {
  const match = matchInsertionOrder(CAMPAIGN.name, 'ae-ch_kpi360_ao_nat_prs_dv360_desktop');
  assert.deepEqual(match, { kind: 'naming', diffs: [{ index: 3, expected: 'dis', found: 'nat' }] });
});

test('IO of an unrelated campaign does not match', () => {
  assert.equal(matchInsertionOrder(CAMPAIGN.name, 'ae-es_prisa_ttf_dis_bd-home').kind, 'none');
});

test('IO of another market is a different campaign, not a naming warning', () => {
  assert.equal(matchInsertionOrder(CAMPAIGN.name, 'ae-co_kpi360_ao_2025_dis_rtg_dv360_mobile').kind, 'none');
});

test('line items of a naming-variant IO are not audited against this campaign', () => {
  const natIo = { insertionOrderId: '9', displayName: 'ae-ch_kpi360_ao_nat_prs_dv360_desktop', entityStatus: 'ENTITY_STATUS_ACTIVE' };
  const result = auditCampaign(baseInput({
    insertionOrders: [natIo],
    lineItems: [lineItem('90', natIo, 'affinity', ['c1'])],
  }));
  assert.deepEqual(result.issues.map((i) => i.code).sort(), ['io_naming', 'no_insertion_order']);
  assert.equal(result.counts.lineItems, 0);
});

test('clean campaign has no issues and full coverage', () => {
  const result = auditCampaign(baseInput());
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.coverage[0].lineItemIds, ['1']);
});

test('naming-variant IO is flagged unless it exactly matches another CM360 campaign', () => {
  const natIo = { insertionOrderId: '9', displayName: 'ae-ch_kpi360_ao_nat_prs_dv360_desktop', entityStatus: 'ENTITY_STATUS_ACTIVE' };
  assert.deepEqual(codes(baseInput({ insertionOrders: [PRS_DESKTOP_IO, natIo] })), ['io_naming']);
  assert.deepEqual(codes(baseInput({ insertionOrders: [PRS_DESKTOP_IO, natIo], otherCampaignNames: ['ae-ch_kpi360_ao_nat'] })), []);
});

test('no matching IO is an error and skips missing-placement noise', () => {
  assert.deepEqual(codes(baseInput({ insertionOrders: [], lineItems: [] })), ['no_insertion_order']);
});

test('prs placement in an rtg IO is a strategy mismatch, reported once across line items', () => {
  const result = auditCampaign(baseInput({
    insertionOrders: [RTG_DESKTOP_IO],
    lineItems: [
      lineItem('10', RTG_DESKTOP_IO, 'addtocart_<3D', ['c1']),
      lineItem('11', RTG_DESKTOP_IO, 'profundidad', ['c1']),
    ],
  }));
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].code, 'strategy_mismatch');
  assert.deepEqual(result.issues[0].lineItemIds, ['10', '11']);
});

test('audience-extension placement counts as rtg even when named prs', () => {
  const inRtg = baseInput({
    campaignPlacements: [AUDEXT_DESKTOP],
    insertionOrders: [RTG_DESKTOP_IO],
    lineItems: [lineItem('10', RTG_DESKTOP_IO, 'addtocart_<3D', ['c2'])],
    creatives: [creativeFor(AUDEXT_DESKTOP, 'c2')],
  });
  assert.deepEqual(codes(inRtg), []);

  const inPrs = baseInput({
    campaignPlacements: [AUDEXT_DESKTOP],
    lineItems: [lineItem('1', PRS_DESKTOP_IO, 'affinity', ['c2'])],
    creatives: [creativeFor(AUDEXT_DESKTOP, 'c2')],
  });
  assert.deepEqual(codes(inPrs), ['strategy_mismatch']);

  const regional = placement('452528255', 'ae-ch_kpi360_ao_2026_dis_prs_dv360_desktop_audience-extension-johannesburgo_970x250');
  assert.deepEqual(codes(baseInput({
    campaignPlacements: [regional],
    insertionOrders: [RTG_DESKTOP_IO],
    lineItems: [lineItem('10', RTG_DESKTOP_IO, 'addtocart_<3D', ['c3'])],
    creatives: [creativeFor(regional, 'c3')],
  })), []);
});

test('mobile placement in a desktop line item is a device mismatch', () => {
  assert.deepEqual(codes(baseInput({
    campaignPlacements: [GEN_DESKTOP, GEN_MOBILE],
    lineItems: [lineItem('1', PRS_DESKTOP_IO, 'affinity', ['c1', 'c3'])],
    creatives: [creativeFor(GEN_DESKTOP, 'c1'), creativeFor(GEN_MOBILE, 'c3')],
  })), ['device_mismatch']);
});

test('dv360 placement not assigned anywhere is missing; non-dv360 and archived ones are ignored', () => {
  const quantcast = placement('500', 'ae-ch_kpi360_ao_2025_dis_prs_quantcast_desktop_gen_300x250');
  const archived = placement('501', 'ae-ch_kpi360_ao_2025_dis_prs_dv360_desktop_gen_300x250', { archived: true });
  const result = auditCampaign(baseInput({ campaignPlacements: [GEN_DESKTOP, GEN_MOBILE, quantcast, archived] }));
  assert.deepEqual(result.issues.map((i) => [i.code, i.placementId]), [['missing_in_dv360', GEN_MOBILE.id]]);
});

test('renamed placement in CM360 is a name mismatch', () => {
  assert.deepEqual(codes(baseInput({
    creatives: [creativeFor(GEN_DESKTOP, 'c1', { displayName: 'old_name_441002425' })],
  })), ['name_mismatch']);
});

test('placement from another campaign and archived placement are errors', () => {
  const foreign = placement('777', 'ae-es_prisa_ttf_2026_dis_bd-home_directo_all_as_1200x250', { campaignId: '1', campaignName: 'ae-es_prisa_ttf', archived: true });
  assert.deepEqual(codes(baseInput({
    lineItems: [lineItem('1', PRS_DESKTOP_IO, 'affinity', ['c1', 'c9'])],
    creatives: [creativeFor(GEN_DESKTOP, 'c1'), creativeFor(foreign, 'c9')],
    foreignPlacements: [foreign],
  })), ['placement_archived', 'placement_other_campaign']);
});

test('unknown placement ID and creative without CM link are flagged', () => {
  assert.deepEqual(codes(baseInput({
    lineItems: [lineItem('1', PRS_DESKTOP_IO, 'affinity', ['c1', 'c4', 'c5'])],
    creatives: [
      creativeFor(GEN_DESKTOP, 'c1'),
      { creativeId: 'c4', displayName: 'x_999', cmPlacementId: '999' },
      { creativeId: 'c5', displayName: 'uploaded_banner' },
    ],
  })), ['creative_not_from_cm', 'placement_not_found']);
});

test('pending review creative and active line item without creatives are warnings', () => {
  const result = auditCampaign(baseInput({
    lineItems: [lineItem('1', PRS_DESKTOP_IO, 'affinity', ['c1']), lineItem('2', PRS_DESKTOP_IO, 'lal', [])],
    creatives: [creativeFor(GEN_DESKTOP, 'c1', { reviewStatus: { approvalStatus: 'APPROVAL_STATUS_PENDING_NOT_SERVABLE' } })],
  }));
  assert.deepEqual(result.issues.map((i) => i.code).sort(), ['li_without_creatives', 'not_servable']);
  assert.ok(result.issues.every((i) => i.severity === 'warning'));
});
