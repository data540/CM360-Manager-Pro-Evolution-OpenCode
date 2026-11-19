import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brandDayNotes, brandKindOf, isBrandDay, placementSideOf, sideOf, sidesMatch, stripSide } from './brandDay';
import { deviceFromFileName, sizeFromFileName, type DetectedFile } from './creativeDetection';
import { buildTrafficPlan, type PlanPlacement } from './trafficPlan';
import { buildCompletePlan, creativeSetKey } from './trafficPlanComplete';
import { buildFullTrafficPlan, parsePlacementNames } from './trafficPlanFull';

const file = (name: string): DetectedFile => ({
  id: name, fileName: name, relativePath: `España/${name}`, bytes: 1000, kind: 'image',
  size: sizeFromFileName(name), sizeSource: 'name', sizeFromName: sizeFromFileName(name), sizeMismatch: false,
  device: deviceFromFileName(name),
});
const placement = (id: string, name: string, size: string): PlanPlacement => ({
  id, name, siteId: 's1', size, compatibility: 'DISPLAY', active: true,
});

const BD_IZQ = placement('p1', 'oc-es_kpi360_hogar_2026_dis_bd_elpais_desktop_gen_izq_456x1000', '456x1000');
const BD_DCH = placement('p2', 'oc-es_kpi360_hogar_2026_dis_bd_elpais_desktop_gen_dch_456x1000', '456x1000');
const P300 = placement('p3', 'oc-es_kpi360_hogar_2026_dis_prs_elpais_desktop_gen_300x250', '300x250');
const FILES = [file('ocaso_bd_izq_456x1000.jpg'), file('ocaso_bd_dcha_456x1000.jpg'), file('ocaso_300x250.jpg')];

test('side words are found as whole words, in any of their variants', () => {
  for (const n of ['x_izq_456x1000', 'x-iz-456x1000', 'IZQUIERDA 456x1000', 'x_izda.png', 'izq456x1000', 'x_left_456x1000']) {
    assert.equal(sideOf(n), 'left', n);
  }
  for (const n of ['x_dch_456x1000', 'x_dcha', 'x_der_456x1000', 'Derecha 456x1000', 'dch456x1000', 'x_right']) {
    assert.equal(sideOf(n), 'right', n);
  }
  for (const n of ['dermatologia_300x250', 'izar_300x250', 'x_300x250', 'x_izq_dch_456x1000']) {
    assert.equal(sideOf(n), undefined, n);
  }
});

test('short side words count in placements only when they are brand days', () => {
  assert.equal(placementSideOf('ae-at_kpi360_x_dis_prs_der_standard_desktop_gen_300x250'), undefined);
  assert.equal(placementSideOf('ae-at_kpi360_x_dis_bd_der_standard_desktop_gen_der_456x1000'), 'right');
  assert.equal(placementSideOf('ae-es_kpi360_x_dis_prs_elpais_desktop_gen_dch_456x1000'), 'right');
  assert.ok(isBrandDay('x_bd_elpais') && isBrandDay('x_brand_day') && !isBrandDay('x_bdx_elpais'));
});

test('brand week ("bw") works like brand day', () => {
  assert.deepEqual(['x_bw_elpais', 'x_brandweek', 'x_brand_week', 'x_bd_elpais', 'x_brand-day', 'x_bwx'].map(brandKindOf),
    ['week', 'week', 'week', 'day', 'day', undefined]);
  assert.equal(placementSideOf('ae-at_kpi360_x_dis_bw_der_standard_desktop_gen_der_456x1000'), 'right');
  assert.ok(sidesMatch('ocaso_bw_dch_456x1000.jpg', 'oc-es_kpi360_hogar_2026_dis_bw_elpais_desktop_gen_dch_456x1000'));
  const notes = brandDayNotes([{ id: 'p1', name: 'oc-es_kpi360_x_dis_bw_elpais_desktop_gen_izq_456x1000', size: '456x1000' }], []);
  assert.match(notes[0].message, /^Brand week izquierda /);
  assert.match(brandDayNotes([{ id: 'p2', name: 'oc-es_kpi360_x_dis_bw_elpais_456x1000', size: '456x1000' }], [])[0].message, /es un brand week/);
});

test('sides must agree: a sided creative never goes to a plain placement, nor the reverse', () => {
  assert.ok(sidesMatch('a_izq_456x1000.jpg', BD_IZQ.name));
  assert.ok(!sidesMatch('a_dch_456x1000.jpg', BD_IZQ.name));
  assert.ok(!sidesMatch('a_456x1000.jpg', BD_IZQ.name));
  assert.ok(!sidesMatch('a_izq_300x250.jpg', P300.name));
  assert.ok(sidesMatch('a_300x250.jpg', P300.name));
});

test('both halves are one "juego" for the Default Ads', () => {
  assert.equal(stripSide('ocaso_bd_izq_456x1000'), 'ocaso_bd_456x1000');
  assert.equal(creativeSetKey('ocaso_bd_izq_456x1000.jpg'), creativeSetKey('ocaso_bd_dcha_456x1000.jpg'));
});

test('ads plan: each half goes only to its own placement', () => {
  const plan = buildTrafficPlan({
    campaign: { id: 'c1', name: 'oc-es_kpi360_hogar_dis' },
    files: FILES,
    placements: [BD_IZQ, BD_DCH, P300],
    ads: [],
    options: { uploadDate: new Date(2026, 10, 19), mode: 'add', includeDefaultAds: true } as any,
  });
  const byFile = Object.fromEntries(plan.creatives.map((c) => [c.fileId, c.placementIds]));
  assert.deepEqual(byFile['ocaso_bd_izq_456x1000.jpg'], ['p1']);
  assert.deepEqual(byFile['ocaso_bd_dcha_456x1000.jpg'], ['p2']);
  assert.deepEqual(byFile['ocaso_300x250.jpg'], ['p3']);
  assert.deepEqual(plan.creatives.map((c) => c.creativeName).slice(0, 2), [
    'oc-es_kpi360_hogar_dis_456x1000_izq_19112026', 'oc-es_kpi360_hogar_dis_456x1000_dch_19112026',
  ]);
});

test('complete plan: Ads and Default Ads per side, no set choice for the pair', () => {
  const plan = buildCompletePlan({
    campaign: { id: 'c1', name: 'oc-es_kpi360_hogar_dis' },
    files: FILES,
    placements: [BD_IZQ, BD_DCH, P300],
    ads: [],
    sites: [{ id: 's1', name: 'El País' }],
    options: {
      prefix: '', suffix: '', includeDate: false, uploadDate: new Date(2026, 10, 19),
      setAsDefault: true, createMissingDefaultAds: true, defaultMode: 'replace', standardMode: 'add',
    },
  });
  assert.equal(plan.needsSetChoice, false);
  const files = (isDefault: boolean, placementId: string) =>
    plan.actions.find((a) => a.isDefault === isDefault && a.placementId === placementId)?.fileIds;
  assert.deepEqual(files(false, 'p1'), ['ocaso_bd_izq_456x1000.jpg']);
  assert.deepEqual(files(true, 'p1'), ['ocaso_bd_izq_456x1000.jpg']);
  assert.deepEqual(files(false, 'p2'), ['ocaso_bd_dcha_456x1000.jpg']);
  assert.deepEqual(files(true, 'p2'), ['ocaso_bd_dcha_456x1000.jpg']);
  assert.ok(!plan.issues.some((i) => i.code === 'brand_day'));
});

test('a missing half is explained: other size of that side, or the size without a side', () => {
  const otherSize = brandDayNotes([BD_IZQ], [file('ocaso_izq_450x1000.jpg')]);
  assert.match(otherSize[0].message, /no hay creatividad izquierda de 456x1000\. Hay creatividad izquierda de 450x1000/);
  const noSide = brandDayNotes([BD_IZQ], [file('ocaso_456x1000.jpg')]);
  assert.match(noSide[0].message, /Hay creatividades de 456x1000, pero sin lado/);
  const unsidedBd = brandDayNotes([placement('p9', 'oc-es_kpi360_x_dis_bd_elpais_desktop_gen_456x1000', '456x1000')], []);
  assert.match(unsidedBd[0].message, /no dice el lado/);
});

test('full plan: halves matched by side, named with it, one Default Ad each', () => {
  const parsed = parsePlacementNames([BD_IZQ.name, BD_DCH.name].join('\n'), [{ id: 's1', name: 'El País' }]);
  assert.deepEqual(parsed.map((p) => p.siteName), ['El País', 'El País']);
  const plan = buildFullTrafficPlan(parsed, FILES.slice(0, 2), {
    campaignName: 'oc-es_kpi360_hogar_dis', uploadDate: new Date(2026, 10, 19),
    createDefaultAds: true, defaultAdMode: 'replace', siteFilter: new Set(),
  });
  assert.deepEqual(plan.creatives.map((c) => [c.creativeName, c.placementIndices]), [
    ['oc-es_kpi360_hogar_dis_456x1000_izq_19112026', [0]],
    ['oc-es_kpi360_hogar_dis_456x1000_dch_19112026', [1]],
  ]);
  assert.deepEqual(plan.defaultAds.map((d) => [d.placementIndex, d.creativeIndex]), [[0, 0], [1, 1]]);
});

test('real case (Godo · La Vanguardia): each half only in the Ads of its own placement', () => {
  const IZQ = placement('461883266', 'ae-es_godo_bf_2026_dis_bd-home_directo_all_lavanguardia-izq_456x1000_461883266', '456x1000');
  const DCH = placement('462140232', 'ae-es_godo_bf_2026_dis_bd-home_directo_all_lavanguardia-dch_456x1000_462140232', '456x1000');
  const ad = (id: string, name: string, placementId: string, isDefault: boolean) => ({ id, name, isDefault, active: true, placementIds: [placementId] });
  for (const prefix of ['', 'test']) {
    const plan = buildCompletePlan({
      campaign: { id: 'c1', name: 'ae-es_godo_bf_dis' },
      files: [file('ae-es_bf_BD-456x1000-izq.jpg'), file('ae-es_bf_BD-456x1000-der.jpg')],
      placements: [IZQ, DCH],
      ads: [
        ad('sI', IZQ.name, IZQ.id, false), ad('dI', '456x1000 Default Web Ad', IZQ.id, true),
        ad('sD', DCH.name, DCH.id, false), ad('dD', '456x1000 Default Web Ad', DCH.id, true),
      ],
      sites: [{ id: 's1', name: 'La Vanguardia' }],
      options: {
        prefix, suffix: '', includeDate: true, uploadDate: new Date(2026, 10, 19),
        setAsDefault: true, createMissingDefaultAds: true, defaultMode: 'replace', standardMode: 'add',
      },
    });
    const byAd = Object.fromEntries(plan.actions.map((a) => [a.adId, a.fileIds]));
    assert.deepEqual(byAd, {
      sI: ['ae-es_bf_BD-456x1000-izq.jpg'], dI: ['ae-es_bf_BD-456x1000-izq.jpg'],
      sD: ['ae-es_bf_BD-456x1000-der.jpg'], dD: ['ae-es_bf_BD-456x1000-der.jpg'],
    });
  }
});
