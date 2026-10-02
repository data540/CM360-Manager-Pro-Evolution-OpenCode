import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strToU8, zipSync } from 'fflate';
import { detectMarketFromFolder, marketOfCampaign } from './markets';
import { classifyFile, deviceFromFileName, parseAdSizeMeta, readHtml5Size, sizeFromFileName, type DetectedFile } from './creativeDetection';
import { buildCreativeName, buildTrafficPlan, type PlanAd, type PlanPlacement, type TrafficPlanInput } from './trafficPlan';

// --- markets ------------------------------------------------------------------------------

test('folder names map to their market, accents and case aside', () => {
  assert.equal(detectMarketFromFolder('Suiza')?.advertiserId, '13683980');
  assert.equal(detectMarketFromFolder('España')?.code, 'ES');
  assert.equal(detectMarketFromFolder('RD')?.code, 'DO');
  assert.equal(detectMarketFromFolder('USA')?.code, 'US');
  assert.equal(detectMarketFromFolder('Uruguay octubre')?.code, 'UY');
  assert.equal(detectMarketFromFolder('Air Europa CH')?.code, 'CH');
  assert.equal(detectMarketFromFolder('Creatividades varias'), undefined);
});

test('campaign market comes from its ae-xx prefix', () => {
  assert.equal(marketOfCampaign('ae-ch_kpi360_ttf_dis')?.code, 'CH');
  assert.equal(marketOfCampaign('2024_ae-suiza_kpi360_time-to-fly_nat'), undefined);
});

// --- detection ----------------------------------------------------------------------------

test('files are classified by extension or mime type', () => {
  assert.equal(classifyFile('banner.zip'), 'html5');
  assert.equal(classifyFile('spot_20s.MP4'), 'video');
  assert.equal(classifyFile('static.jpg'), 'image');
  assert.equal(classifyFile('brief.pdf'), 'unsupported');
});

test('size and device are read from the file name', () => {
  assert.equal(sizeFromFileName('ae-ch_ao_300x250_01102026.zip'), '300x250');
  assert.equal(sizeFromFileName('970X90-final.jpg'), '970x90');
  assert.equal(sizeFromFileName('spot_20s.mp4'), undefined);
  assert.equal(deviceFromFileName('ae-ch_prs_mobile_320x480.zip'), 'mobile');
  assert.equal(deviceFromFileName('banner_300x250.zip'), undefined);
});

test('HTML5 zip size comes from the ad.size meta of its shallowest html', () => {
  assert.equal(parseAdSizeMeta('<meta content="width=728,height=90" name="ad.size">'), '728x90');
  const zip = zipSync({
    '__MACOSX/index.html': strToU8('<meta name="ad.size" content="width=1,height=1">'),
    'banner/index.html': strToU8('<html><head><meta name="ad.size" content="width=300,height=600"></head></html>'),
    'banner/assets/logo.png': new Uint8Array([1, 2, 3]),
  });
  assert.equal(readHtml5Size(zip), '300x600');
  assert.equal(readHtml5Size(zipSync({ 'index.html': strToU8('<html></html>') })), undefined);
});

// --- plan ---------------------------------------------------------------------------------

const CAMPAIGN = { id: '35367036', name: 'ae-ch_kpi360_ao_dis' };
const DATE = new Date(2026, 9, 1);

const placement = (id: string, name: string, size: string | undefined, extra: Partial<PlanPlacement> = {}): PlanPlacement => ({
  id, name, siteId: '9031953', size, compatibility: 'DISPLAY', active: true, ...extra,
});
const ad = (id: string, placementIds: string[], extra: Partial<PlanAd> = {}): PlanAd => ({
  id, name: `ad_${id}`, isDefault: false, active: true, placementIds, ...extra,
});
const file = (name: string, extra: Partial<DetectedFile> = {}): DetectedFile => ({
  id: name, fileName: name, relativePath: `Suiza/${name}`, bytes: 1000, kind: 'html5',
  size: sizeFromFileName(name), sizeSource: 'name', sizeFromName: sizeFromFileName(name), sizeMismatch: false,
  device: deviceFromFileName(name), ...extra,
});

const P300_DESK = placement('p1', 'ae-ch_kpi360_ao_2025_dis_prs_dv360_desktop_gen_300x250_441002419', '300x250');
const P300_MOB = placement('p2', 'ae-ch_kpi360_ao_2025_dis_prs_dv360_mobile_gen_300x250_441002437', '300x250');
const P728 = placement('p3', 'ae-ch_kpi360_ao_2025_dis_prs_dv360_desktop_gen_728x90_441228548', '728x90');
const PVIDEO = placement('p4', 'ae-ch_kpi360_ao_2025_vid_prs_dv360_desktop_preroll', undefined, { compatibility: 'IN_STREAM_VIDEO' });

const baseInput = (overrides: Partial<TrafficPlanInput> = {}): TrafficPlanInput => ({
  campaign: CAMPAIGN,
  files: [file('banner_300x250.zip')],
  placements: [P300_DESK, P300_MOB],
  ads: [ad('a1', ['p1', 'p2']), ad('d1', ['p1'], { isDefault: true, name: '300x250 Default Web Ad' })],
  options: { includeDefaultAds: true, mode: 'replace', uploadDate: DATE },
  ...overrides,
});
const codes = (input: TrafficPlanInput) => buildTrafficPlan(input).issues.map((i) => i.code).sort();

test('creative name is campaign_size_ddmmyyyy', () => {
  assert.equal(buildCreativeName('ae-es_kpi360_johannesburgo_nat', '300x250', DATE), 'ae-es_kpi360_johannesburgo_nat_300x250_01102026');
});

test('a banner goes to every active placement of its size and to the ads (standard and default) serving them', () => {
  const plan = buildTrafficPlan(baseInput());
  assert.deepEqual(plan.issues, []);
  assert.equal(plan.creatives[0].creativeName, 'ae-ch_kpi360_ao_dis_300x250_01102026');
  assert.deepEqual(plan.creatives[0].placementIds, ['p1', 'p2']);
  assert.deepEqual(plan.adAssignments.map((a) => [a.adId, a.mode, a.fileIds]), [['a1', 'replace', ['banner_300x250.zip']], ['d1', 'replace', ['banner_300x250.zip']]]);
});

test('Default Ads can be excluded', () => {
  const plan = buildTrafficPlan(baseInput({ options: { includeDefaultAds: false, mode: 'add', uploadDate: DATE } }));
  assert.deepEqual(plan.adAssignments.map((a) => [a.adId, a.mode]), [['a1', 'add']]);
});

test('device in the file name restricts placements to that device', () => {
  const plan = buildTrafficPlan(baseInput({ files: [file('banner_mobile_300x250.zip')] }));
  assert.deepEqual(plan.creatives[0].placementIds, ['p2']);
});

test('several creatives for the same ad are applied together, and repeated sizes get a suffix', () => {
  const plan = buildTrafficPlan(baseInput({ files: [file('a_300x250.zip'), file('b_300x250.zip')] }));
  assert.deepEqual(plan.creatives.map((c) => c.creativeName), ['ae-ch_kpi360_ao_dis_300x250_01102026', 'ae-ch_kpi360_ao_dis_300x250_01102026_2']);
  assert.deepEqual(plan.adAssignments.find((a) => a.adId === 'a1')?.fileIds, ['a_300x250.zip', 'b_300x250.zip']);
  assert.deepEqual(codes(baseInput({ files: [file('a_300x250.zip'), file('b_300x250.zip')] })), ['duplicate_name']);
});

test('inactive placements and inactive ads are ignored', () => {
  const plan = buildTrafficPlan(baseInput({
    placements: [P300_DESK, { ...P300_MOB, active: false }],
    ads: [ad('a1', ['p1', 'p2']), ad('a2', ['p1'], { active: false })],
  }));
  assert.deepEqual(plan.creatives[0].placementIds, ['p1']);
  assert.deepEqual(plan.adAssignments.map((a) => a.adId), ['a1']);
});

test('video goes to video placements only', () => {
  const plan = buildTrafficPlan(baseInput({
    files: [file('spot_20s.mp4', { kind: 'video', size: '1920x1080', sizeSource: 'file', sizeFromName: undefined })],
    placements: [P300_DESK, PVIDEO],
    ads: [ad('a1', ['p1']), ad('v1', ['p4'])],
  }));
  assert.equal(plan.creatives[0].creativeName, 'ae-ch_kpi360_ao_dis_1920x1080_01102026');
  assert.deepEqual(plan.creatives[0].placementIds, ['p4']);
  assert.deepEqual(plan.adAssignments.map((a) => a.adId), ['v1']);
});

test('folder of another country blocks the plan', () => {
  const plan = buildTrafficPlan(baseInput({ folderMarket: detectMarketFromFolder('España') }));
  assert.equal(plan.blocked, true);
  assert.equal(plan.issues[0].code, 'market_mismatch');
  assert.equal(buildTrafficPlan(baseInput({ folderMarket: detectMarketFromFolder('Suiza') })).blocked, false);
});

test('coverage warns about placements without creative or without ad, only for the families in the folder', () => {
  assert.deepEqual(codes(baseInput({ placements: [P300_DESK, P300_MOB, P728, PVIDEO] })), ['placement_without_creative']);
  assert.deepEqual(codes(baseInput({ ads: [ad('a1', ['p1'])] })), ['placement_without_ad']);
});

test('unsupported files, unknown sizes, size mismatches and unmatched files are reported', () => {
  assert.deepEqual(codes(baseInput({
    files: [
      file('banner_300x250.zip'),
      file('brief.pdf', { kind: 'unsupported' }),
      file('nosize.zip', { size: undefined, sizeSource: 'none' }),
      file('banner_160x600.zip'),
      file('wrong_300x600.zip', { size: '300x250', sizeSource: 'file', sizeMismatch: true }),
    ],
  })), ['duplicate_name', 'size_mismatch', 'size_unknown', 'unmatched_file', 'unsupported_file']);
});

test('an ad spanning several sizes is flagged', () => {
  assert.deepEqual(codes(baseInput({ placements: [P300_DESK, P300_MOB, P728], ads: [ad('a1', ['p1', 'p2', 'p3'])] })),
    ['mixed_size_ad', 'placement_without_creative']);
});
