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

test('tracking landing: only the creatives of this run get it, the ones already in rotation keep theirs', () => {
  const tracking = 'https://fxj6.aireuropa.com/dynclick/aireuropa/?ead-publisher=Alkimiads';
  const next = buildCreativeAssignments({ current, creativeIds: ['20'], mode: 'add', newCreativesLanding: tracking });
  assert.deepEqual(next.map((a) => [a.creativeId, a.clickThroughUrl.customClickThroughUrl]), [['10', landing.customClickThroughUrl], ['11', landing.customClickThroughUrl], ['20', tracking]]);
  // A creative of this run that was already in rotation (re-run) does get the tracking URL.
  const rerun = buildCreativeAssignments({ current, creativeIds: ['11'], mode: 'add', newCreativesLanding: tracking });
  assert.deepEqual(rerun.map((a) => a.clickThroughUrl.customClickThroughUrl), [landing.customClickThroughUrl, tracking]);
});
