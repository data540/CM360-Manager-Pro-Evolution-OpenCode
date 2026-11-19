import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractSizeFromName, parsePlacementNames } from './trafficPlanFull';

const SITES = [{ id: '9', name: 'KPI360 Direct' }, { id: '1', name: 'DV360' }, { id: '2', name: 'Quantcast' }, { id: '3', name: 'Seedtag' }, { id: '4', name: 'El País' }];

test('size is read from names that use underscores', () => {
  assert.equal(extractSizeFromName('ae-es_kpi360_black-friday_2026_dis_prs_dv360_desktop_gen_728x90'), '728x90');
  assert.equal(extractSizeFromName('oc-es_kpi360_decesos_2027_dis_prs_dv360_desktop_gen_300x250_441002401'), '300x250');
  assert.equal(extractSizeFromName('banner-970x250.png'), '970x250');
  assert.equal(extractSizeFromName('sin_tamano'), undefined);
});

test('the site is the word that is a CM360 site, not the concept', () => {
  const parsed = parsePlacementNames([
    'oc-es_kpi360_decesos-primavera_2027_dis_prs_dv360_desktop_gen_728x90',
    'oc-es_kpi360_decesos-primavera_2027_dis_prs_seedtag_mobile_gen_300x250',
    'ae-es_kpi360_black-friday_2026_dis_rtg_quantcast_mobile_gen_320x50',
    'ae-es_kpi360_black-friday_2026_dis_prs_elpais_desktop_gen_300x600',
    'ae-es_kpi360_black-friday_2026_dis_prs_desconocido_desktop_gen_300x250',
  ].join('\n'), SITES);
  assert.deepEqual(parsed.map((p) => [p.size, p.siteName, !!p.siteUnknown]), [
    ['728x90', 'DV360', false],
    ['300x250', 'Seedtag', false],
    ['320x50', 'Quantcast', false],
    ['300x600', 'El País', false],
    ['300x250', undefined, true],
  ]);
});
