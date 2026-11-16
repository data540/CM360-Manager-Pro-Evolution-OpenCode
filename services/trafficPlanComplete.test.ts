import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deviceFromFileName, sizeFromFileName, type DetectedFile } from './creativeDetection';
import type { PlanAd, PlanPlacement } from './trafficPlan';
import { buildCompletePlan, buildPrefixedCreativeName, creativeSetKey, type CompleteOptions, type CompletePlanInput } from './trafficPlanComplete';

const DATE = new Date(2026, 10, 16);

const placement = (id: string, name: string, size: string, extra: Partial<PlanPlacement> = {}): PlanPlacement => ({
  id, name, siteId: 's1', size, compatibility: 'DISPLAY', active: true, ...extra,
});
const ad = (id: string, placementIds: string[], extra: Partial<PlanAd> = {}): PlanAd => ({
  id, name: `ad_${id}`, isDefault: false, active: true, placementIds, ...extra,
});
const file = (name: string): DetectedFile => ({
  id: name, fileName: name, relativePath: `España/${name}`, bytes: 1000, kind: 'image',
  size: sizeFromFileName(name), sizeSource: 'name', sizeFromName: sizeFromFileName(name), sizeMismatch: false,
  device: deviceFromFileName(name),
});

const P300 = placement('p1', 'ae-es_kpi360_navidad_2026_dis_prs_site1_desktop_gen_300x250_1', '300x250');
const P728 = placement('p2', 'ae-es_kpi360_navidad_2026_dis_prs_site1_desktop_gen_728x90_2', '728x90');
const P300_S2 = placement('p3', 'ae-es_kpi360_navidad_2026_dis_prs_site2_desktop_gen_300x250_3', '300x250', { siteId: 's2' });

const options = (extra: Partial<CompleteOptions> = {}): CompleteOptions => ({
  prefix: '', suffix: '', includeDate: false, uploadDate: DATE,
  setAsDefault: true, createMissingDefaultAds: true, defaultMode: 'replace', standardMode: 'add', ...extra,
});

const input = (extra: Partial<CompletePlanInput> = {}): CompletePlanInput => ({
  campaign: { id: 'c1', name: 'ae-es_kpi360_navidad_dis' },
  files: [file('navidad_300x250.jpg'), file('navidad_728x90.jpg')],
  placements: [P300, P728],
  ads: [],
  sites: [{ id: 's1', name: 'Site Uno' }, { id: 's2', name: 'Site Dos' }],
  options: options(),
  ...extra,
});

test('names follow Batch Upload: prefix_file_suffix_date', () => {
  assert.equal(buildPrefixedCreativeName('navidad_300x250.jpg', 'ae-es', 'v2', '16112026'), 'ae-es_navidad_300x250_v2_16112026');
  assert.equal(buildPrefixedCreativeName('navidad 300x250.jpg', '', '', ''), 'navidad_300x250');
  assert.equal(creativeSetKey('navidad_300x250_okdiario.jpg'), 'navidad_okdiario');
});

test('placements without Ads get a standard Ad and a Default Ad created', () => {
  const plan = buildCompletePlan(input());
  assert.equal(plan.creatives.length, 2);
  const creates = plan.actions.filter((a) => a.kind === 'create');
  assert.deepEqual(creates.map((a) => [a.isDefault, a.placementId, a.adName]), [
    [false, 'p1', P300.name],
    [false, 'p2', P728.name],
    [true, 'p1', '300x250 Default Web Ad'],
    [true, 'p2', '728x90 Default Web Ad'],
  ]);
  assert.deepEqual(plan.rows.map((r) => [r.standard.action, r.default.action]), [['create', 'create'], ['create', 'create']]);
});

test('existing Ads are updated, only the missing ones are created', () => {
  const plan = buildCompletePlan(input({
    ads: [ad('a1', ['p1']), ad('d2', ['p2'], { isDefault: true, name: '728x90 Default Web Ad' })],
  }));
  const summary = plan.actions.map((a) => `${a.kind}:${a.isDefault ? 'def' : 'std'}:${a.adId || a.placementId}:${a.mode}`);
  assert.deepEqual(summary, ['update:std:a1:add', 'create:std:p2:add', 'update:def:d2:replace', 'create:def:p1:replace']);
});

test('inactive standard Ads do not count: a new one is created with a warning', () => {
  const plan = buildCompletePlan(input({ files: [file('navidad_300x250.jpg')], placements: [P300], ads: [ad('a1', ['p1'], { active: false })] }));
  assert.equal(plan.actions.find((a) => !a.isDefault)?.kind, 'create');
  assert.ok(plan.issues.some((i) => i.code === 'placement_without_ad'));
});

test('without "poner como Default" no Default Ad is touched; without "crear" only existing ones are', () => {
  const off = buildCompletePlan(input({ options: options({ setAsDefault: false }) }));
  assert.ok(off.actions.every((a) => !a.isDefault));
  assert.ok(off.rows.every((r) => r.default.action === 'off'));

  const noCreate = buildCompletePlan(input({
    ads: [ad('d1', ['p1'], { isDefault: true })],
    options: options({ createMissingDefaultAds: false }),
  }));
  assert.deepEqual(noCreate.actions.filter((a) => a.isDefault).map((a) => a.adId), ['d1']);
  assert.equal(noCreate.rows.find((r) => r.placement.id === 'p2')?.default.action, 'none');
});

test('site selection limits the placements; unmatched files are left out', () => {
  const plan = buildCompletePlan(input({
    files: [file('navidad_300x250.jpg'), file('navidad_160x600.jpg')],
    placements: [P300, P300_S2],
    options: options({ siteIds: new Set(['s2']) }),
  }));
  assert.deepEqual(plan.rows.map((r) => r.placement.id), ['p3']);
  assert.equal(plan.rows[0].siteName, 'Site Dos');
  assert.deepEqual(plan.extraFiles.map((f) => f.fileName), ['navidad_160x600.jpg']);
});

test('an Ad shared by several placements is updated once with all their files', () => {
  const plan = buildCompletePlan(input({ ads: [ad('a1', ['p1', 'p2'])], options: options({ setAsDefault: false }) }));
  assert.equal(plan.actions.length, 1);
  assert.deepEqual(plan.actions[0].fileIds.sort(), ['navidad_300x250.jpg', 'navidad_728x90.jpg']);
});

test('with several files of a size, the Default takes the chosen set and standard Ads take all', () => {
  const files = [file('navidad_300x250_a.jpg'), file('navidad_300x250_b.jpg')];
  const plan = buildCompletePlan(input({ files, placements: [P300], options: options({ defaultSetKey: 'navidad_b' }) }));
  assert.equal(plan.needsSetChoice, true);
  assert.deepEqual(plan.actions.find((a) => !a.isDefault)?.fileIds, ['navidad_300x250_a.jpg', 'navidad_300x250_b.jpg']);
  assert.deepEqual(plan.actions.find((a) => a.isDefault)?.fileIds, ['navidad_300x250_b.jpg']);
});

test('folder and campaign of different markets block the plan', () => {
  const plan = buildCompletePlan(input({ campaign: { id: 'c1', name: 'ae-fr_kpi360_navidad_dis' }, folderMarket: { code: 'ES' } as any }));
  assert.equal(plan.blocked, true);
});

test('creative dates: carried to the plan, wrong ranges block, partial overlaps only warn', () => {
  const campaign = { id: 'c1', name: 'ae-es_kpi360_navidad_dis', startDate: '2026-12-01', endDate: '2027-01-06' };
  const plan = (dates: Record<string, { start?: string; end?: string }>) =>
    buildCompletePlan(input({ campaign, options: options({ creativeDates: dates }) }));

  const ok = plan({ 'navidad_300x250.jpg': { start: '2026-12-10', end: '2026-12-24' } });
  assert.deepEqual(ok.creatives.map((c) => [c.startDate, c.endDate]), [['2026-12-10', '2026-12-24'], [undefined, undefined]]);
  assert.equal(ok.blocked, false);

  const reversed = plan({ 'navidad_300x250.jpg': { start: '2026-12-24', end: '2026-12-10' } });
  assert.equal(reversed.blocked, true);
  assert.match(reversed.issues[0].message, /anterior a la de inicio/);

  const outside = plan({ 'navidad_728x90.jpg': { start: '2027-02-01' } });
  assert.equal(outside.blocked, true);

  const partial = plan({ 'navidad_728x90.jpg': { start: '2026-11-20', end: '2026-12-05' } });
  assert.equal(partial.blocked, false);
  assert.ok(partial.issues.some((i) => i.code === 'creative_dates' && i.severity === 'warning'));
});

test('creative schedule is clamped to the Ad window and rejected when nothing is left', async () => {
  const { applyCreativeSchedule } = await import('./trafficExecutor');
  const assignments = [{ creativeId: '1', active: true }, { creativeId: '2', active: true, startTime: 'old' }];
  const adStart = '2026-12-01T00:00:00.000Z';
  const adEnd = '2027-01-06T23:59:00.000Z';
  const out = applyCreativeSchedule(assignments, {
    '1': { startTime: '2026-11-15T00:00:00.000Z', endTime: '2026-12-24T22:59:59.000Z' },
  }, adStart, adEnd);
  assert.deepEqual([out[0].startTime, out[0].endTime], [adStart, '2026-12-24T22:59:59.000Z']);
  assert.equal(out[1].startTime, 'old', 'creatives without dates are left as they are');
  assert.throws(() => applyCreativeSchedule(assignments, { '1': { startTime: '2027-02-01T00:00:00.000Z' } }, adStart, adEnd), /no caben/);
});

test('no site selected means nothing is trafficked (not "every site")', () => {
  const plan = buildCompletePlan(input({ options: options({ siteIds: new Set() }) }));
  assert.equal(plan.rows.length, 0);
  assert.equal(plan.actions.length, 0);
});
