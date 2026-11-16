import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchCampaigns } from './campaignSearch';

const C = [
  { id: '1', name: 'ae-es_kpi360_black-friday_dis', endDate: '2026-12-01' },
  { id: '2', name: 'ae-es_kpi360_black-friday_nat', endDate: '2026-12-01' },
  { id: '3', name: 'ae-es_kpi360_navidad-canarias_dis', endDate: '2027-01-06' },
  { id: '4', name: 'ae-es_kpi360_verano_dis', endDate: '2026-08-31' },
  { id: '5', name: 'ae-es_kpi360_Campaña_Tráfico_dis', endDate: '2026-12-31' },
];
const TODAY = '2026-11-16';
const ids = (q: string) => searchCampaigns(C, q, TODAY).map((c) => c.id);

test('every word must appear, in any order, ignoring separators, case and accents', () => {
  assert.deepEqual(ids('black friday dis'), ['1']);
  assert.deepEqual(ids('DIS friday'), ['1']);
  assert.deepEqual(ids('blackfriday'), ['1', '2']);
  assert.deepEqual(ids('campana trafico'), ['5']);
  assert.deepEqual(ids('canarias nat'), []);
});

test('empty search lists all, running campaigns first and ended ones last', () => {
  assert.deepEqual(ids(''), ['1', '2', '5', '3', '4']);
  assert.deepEqual(ids('dis'), ['1', '5', '3', '4']);
});
