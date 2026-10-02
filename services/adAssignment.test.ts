import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCreativeAssignments } from './adAssignment';

const landing = { defaultLandingPage: false, customClickThroughUrl: 'https://fxj6.aireuropa.com/dynclick/x' };
const current = [
  { creativeId: '10', weight: 1, active: true, id: 'a1', clickThroughUrl: landing },
  { creativeId: '11', weight: 2, active: true, clickThroughUrl: landing },
];

test('replace: the new creatives are the whole rotation and keep the ad landing', () => {
  const next = buildCreativeAssignments({ current, creativeIds: ['20', '21'], mode: 'replace' });
  assert.deepEqual(next.map((a) => [a.creativeId, a.weight, a.clickThroughUrl]), [['20', 1, landing], ['21', 1, landing]]);
  assert.equal(next[0].id, undefined);
});

test('add: current creatives stay and already assigned ones are not duplicated', () => {
  const next = buildCreativeAssignments({ current, creativeIds: ['11', '20'], mode: 'add' });
  assert.deepEqual(next.map((a) => a.creativeId), ['10', '11', '20']);
});

test('sequential rotations get the next sequence numbers instead of weights', () => {
  const seq = [{ creativeId: '10', sequence: 1 }, { creativeId: '11', sequence: 2 }];
  const next = buildCreativeAssignments({ current: seq, rotationType: 'CREATIVE_ROTATION_TYPE_SEQUENTIAL', creativeIds: ['20'], mode: 'add' });
  assert.deepEqual(next.map((a) => [a.creativeId, a.sequence, a.weight]), [['10', 1, undefined], ['11', 2, undefined], ['20', 3, undefined]]);
});

test('an empty ad uses the campaign default landing; Default Ads get the forced landing', () => {
  assert.deepEqual(buildCreativeAssignments({ current: [], creativeIds: ['20'], mode: 'replace' })[0].clickThroughUrl, { defaultLandingPage: true });
  const forced = buildCreativeAssignments({ current, creativeIds: ['20'], mode: 'add', forcedLanding: 'https://www.aireuropa.com/' });
  assert.ok(forced.every((a) => a.clickThroughUrl.customClickThroughUrl === 'https://www.aireuropa.com/'));
});
