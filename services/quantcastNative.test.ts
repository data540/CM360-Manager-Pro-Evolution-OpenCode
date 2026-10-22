import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAssignments,
  campaignRoot,
  creativeNamesFor,
  detectLanguage,
  extractImgSrc,
  imageIssues,
  matchAdSet,
  matchCampaign,
  marketCodeFromPlacement,
  parseNativeSheet,
  placementStrategy,
  resolveLanguage,
  yearMismatch,
} from './quantcastNative';

const PLACEMENT = 'ae-es_kpi360_ao_2025_nat_prs_quantcast_mobile_gen_1x1_421530992';
const PIXEL = 'https://ad.doubleclick.net/ddm/trackimp/N2136498.2365312QUANCAST/B33517964.421530992;dc_trk_aid=614286355;dc_trk_cid=235311330;ord=[timestamp];dc_lat=;dc_rdid=;tag_for_child_directed_treatment=;tfua=;gdpr=${GDPR};gdpr_consent=${GDPR_CONSENT_755};ltd=;dc_tdv=1?';
const IMG_TAG = `<IMG SRC="${PIXEL}" attributionsrc BORDER="0" HEIGHT="1" WIDTH="1" ALT="Advertisement">`;
const CLICK = 'https://ad.doubleclick.net/ddm/trackclk/N2136498.2365312QUANCAST/B33517964.421530992;dc_trk_aid=614286355;dc_trk_cid=235311330;dc_lat=;dc_rdid=;tag_for_child_directed_treatment=;tfua=;gdpr=${GDPR};gdpr_consent=${GDPR_CONSENT_755};ltd=;dc_tdv=1';

const grid = (row: Partial<Record<string, string>> = {}) => [
  ['CONTRACT INFORMATION', '', '1.0'],
  ['Campaign Name', '', 'ae-es_kpi360_ao_nat'],
  [],
  ['Placement ID', 'Placement Name', 'Click Tag', 'Impression Tag (image)', 'Impression Tag (javascript)', 'Title', 'Description'],
  [
    row.id ?? '421530992',
    row.name ?? PLACEMENT,
    row.click ?? CLICK,
    row.img ?? IMG_TAG,
    '<SCRIPT …>',
    row.title ?? 'Johannesburgo ahora más cerca',
    row.description ?? 'Vuela a Johannesburgo desde 348€ trayecto',
  ],
];

test('extractImgSrc keeps the whole SRC value, trailing ? included', () => {
  assert.equal(extractImgSrc(IMG_TAG), PIXEL);
  assert.equal(extractImgSrc(PIXEL), PIXEL);
  assert.equal(extractImgSrc('nada'), '');
});

test('parseNativeSheet maps the CM360 tag export columns', () => {
  const { rows, errors } = parseNativeSheet(grid());
  assert.deepEqual(errors, []);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.placementName, PLACEMENT);
  assert.equal(row.placementId, '421530992');
  assert.equal(row.landingUrl, CLICK);
  assert.equal(row.impressionPixel, PIXEL);
  assert.equal(row.title, 'Johannesburgo ahora más cerca');
  assert.deepEqual(row.errors, []);
});

test('parseNativeSheet flags missing columns and over-long texts', () => {
  const noTitle = parseNativeSheet([['Placement Name', 'Click Tag', 'Impression Tag (image)'], [PLACEMENT, CLICK, IMG_TAG]]);
  assert.ok(noTitle.errors.some((e) => e.includes('Title')));
  const long = parseNativeSheet(grid({ title: 'x'.repeat(101) }));
  assert.ok(long.rows[0].errors.some((e) => e.includes('101')));
  const noHeader = parseNativeSheet([['a', 'b'], ['c', 'd']]);
  assert.equal(noHeader.rows.length, 0);
  assert.equal(noHeader.errors.length, 1);
});

test('detectLanguage recognises the example and other markets', () => {
  assert.deepEqual(detectLanguage('Johannesburgo ahora más cerca Vuela a Johannesburgo desde 348€ trayecto'), { language: 'Spanish', confident: true });
  assert.equal(detectLanguage('Johannesburg now closer. Fly to Johannesburg from 348€ one way').language, 'English');
  assert.equal(detectLanguage('Joanesburgo agora mais perto. Voe para Joanesburgo desde 348€').language, 'Portuguese');
  assert.equal(detectLanguage('Johannesburg jetzt näher. Fliegen Sie nach Johannesburg ab 348€').language, 'German');
  assert.deepEqual(detectLanguage('Johannesburg 348€'), { confident: false });
});

test('resolveLanguage: clear text wins, then Drive folder country, then the placement market', () => {
  const es = 'Johannesburgo ahora más cerca Vuela a Johannesburgo desde 348€ trayecto';
  assert.deepEqual(resolveLanguage(es, 'ES', PLACEMENT), { language: 'Spanish', source: 'texto', note: undefined });
  assert.deepEqual(resolveLanguage('Johannesburg 348€', 'ES'), { language: 'Spanish', source: 'carpeta' });
  assert.deepEqual(resolveLanguage('Johannesburg 348€', undefined, `TEST DAVID ${PLACEMENT}`), { language: 'Spanish', source: 'placement' });
  assert.equal(resolveLanguage('Johannesburg now closer. Fly to Johannesburg from 348€', 'ES').note, 'El texto parece English pero el mercado es Spanish.');
  assert.equal(resolveLanguage('Johannesburg 348€', 'CH').language, undefined);
  assert.equal(marketCodeFromPlacement(`TEST DAVID ${PLACEMENT}`), 'ES');
});

test('imageIssues accepts 1000x600 JPEG ≤ 5 MB only', () => {
  const ok = { id: '1', name: '1000x600.jpg', mimeType: 'image/jpeg', bytes: 200_000, width: 1000, height: 600 };
  assert.deepEqual(imageIssues(ok), []);
  assert.equal(imageIssues({ ...ok, width: 300, height: 250 }).length, 1);
  assert.equal(imageIssues({ ...ok, bytes: 6 * 1024 * 1024 }).length, 1);
  assert.equal(imageIssues({ ...ok, mimeType: 'image/webp' }).length, 1);
});

test('creativeNamesFor keeps the placement name, or inserts _vN before the ID', () => {
  assert.deepEqual(creativeNamesFor(PLACEMENT, 1), [PLACEMENT]);
  assert.deepEqual(creativeNamesFor(PLACEMENT, 2), [
    'ae-es_kpi360_ao_2025_nat_prs_quantcast_mobile_gen_1x1_v1_421530992',
    'ae-es_kpi360_ao_2025_nat_prs_quantcast_mobile_gen_1x1_v2_421530992',
  ]);
});

test('campaignRoot cuts the placement name before the strategy token', () => {
  assert.equal(campaignRoot(`TEST DAVID ${PLACEMENT}`), 'TEST DAVID ae-es_kpi360_ao_2025_nat');
  assert.equal(campaignRoot('ae-es_kpi360_johannesburgo_2026_dis_rtg_quantcast_desktop_300x250_1'), 'ae-es_kpi360_johannesburgo_2026_dis');
  assert.equal(campaignRoot('ae-es_kpi360_ao_2025_nat_quantcast_1x1_1'), undefined);
});

test('matchCampaign finds the campaign that contains the root', () => {
  const campaigns = [
    { id: '1', name: 'TEST DAVID ae-es_kpi360_ao_2025_nat' },
    { id: '2', name: 'ae-es_kpi360_ao_2025_nat' },
    { id: '3', name: 'ae-es_kpi360_ao_2025_dis' },
    { id: '4', name: 'ae-ch_kpi360_ao_2025_nat' },
    { id: '5', name: 'ae-es_kpi360_ao_2025_nat_old', state: 'ARCHIVED' },
  ];
  assert.equal(matchCampaign(`TEST DAVID ${PLACEMENT}`, campaigns).match?.id, '1');
  const real = matchCampaign(PLACEMENT, campaigns);
  assert.equal(real.match?.id, '2');
  assert.deepEqual(real.candidates.map((c) => c.id), ['2']);
  assert.equal(matchCampaign('ae-fr_kpi360_x_prs_1x1_1', campaigns).match, undefined);
});

test('matchCampaign ignores the year and picks the campaign of the same strategy', () => {
  const campaigns = [
    { id: 'co', name: 'ae-es_kpi360_procolombia_nat' },
    { id: 'p', name: 'TEST DAVID ae-es_kpi360_ao_2026_nat_prs_quantcast' },
    { id: 'r', name: 'TEST DAVID ae-es_kpi360_ao_2026_nat_rtg_quantcast' },
  ];
  const name = `TEST DAVID ${PLACEMENT}`;
  assert.equal(matchCampaign(name, campaigns).match?.id, 'p');
  assert.equal(matchCampaign(name.replace('_prs_', '_rtg_'), campaigns).match?.id, 'r');
  assert.equal(yearMismatch(name, campaigns[1].name), 'El placement dice 2025 y la campaña 2026.');
  assert.equal(yearMismatch(name, 'TEST DAVID ae-es_kpi360_ao_2025_nat'), undefined);
  // Only the opposite strategy exists: offered, never auto-selected.
  assert.equal(matchCampaign(name, [campaigns[2]]).match, undefined);
  assert.equal(matchCampaign(name, [campaigns[2]]).candidates.length, 1);
});

test('matchAdSet requires the same strategy and device, then most shared tokens', () => {
  const adSets = [
    { id: 'a', name: 'ae-es_kpi360_ao_2025_nat_prs_quantcast_desktop' },
    { id: 'b', name: 'ae-es_kpi360_ao_2025_nat_prs_quantcast_mobile' },
    { id: 'r', name: 'ae-es_kpi360_ao_2025_nat_rtg_quantcast_mobile' },
    { id: 'c', name: 'ae-es_kpi360_ao_2025_nat_prs_quantcast_mobile_audience-extension' },
  ];
  assert.equal(matchAdSet(PLACEMENT, adSets).match?.id, 'b');
  assert.equal(matchAdSet(PLACEMENT.replace('_prs_', '_rtg_'), adSets).match?.id, 'r');
  const tie = matchAdSet(PLACEMENT, [{ id: 'x', name: 'set_mobile_1' }, { id: 'y', name: 'set_mobile_2' }]);
  assert.equal(tie.match, undefined);
  assert.equal(tie.candidates.length, 2);
});

test('audience-extension placements go to the rtg campaign and ad set even when named _prs_', () => {
  const ae = 'TEST DAVID ae-es_kpi360_ao_2025_nat_prs_quantcast_desktop_audience-extension_1x1_421851837';
  assert.equal(placementStrategy(ae), 'rtg');
  assert.equal(placementStrategy(ae.replace('audience-extension', 'audience-extension-ttf')), 'rtg');
  assert.equal(placementStrategy(`TEST DAVID ${PLACEMENT}`), 'prs');
  const campaigns = [
    { id: 'p', name: 'TEST DAVID ae-es_kpi360_ao_2026_nat_prs_quantcast' },
    { id: 'r', name: 'TEST DAVID ae-es_kpi360_ao_2026_nat_rtg_quantcast' },
  ];
  assert.equal(matchCampaign(ae, campaigns).match?.id, 'r');
  const adSets = [
    { id: 'rm', name: 'ae-es_kpi360_ao_2026_nat_rtg_quantcast_mobile' },
    { id: 'rd', name: 'ae-es_kpi360_ao_2026_nat_rtg_quantcast_desktop' },
    { id: 'pd', name: 'ae-es_kpi360_ao_2026_nat_prs_quantcast_desktop' },
  ];
  assert.equal(matchAdSet(ae, adSets).match?.id, 'rd');
});

test('buildAssignments edits each ad set once with all its creatives', () => {
  const jobs = buildAssignments([
    { creativeNames: ['a'], campaignName: 'C', adSetName: 'S1' },
    { creativeNames: ['b', 'c'], campaignName: 'C', adSetName: 'S1' },
    { creativeNames: ['d'], campaignName: 'C', adSetName: 'S2' },
  ], true);
  assert.equal(jobs.length, 2);
  assert.deepEqual(jobs[0], { campaignName: 'C', adSetName: 'S1', creativeNames: ['a', 'b', 'c'], replace: true });
});
