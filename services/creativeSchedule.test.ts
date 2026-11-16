import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localDateTimeToIso, scheduleCreativeInAd } from './creativeSchedule';

const ad = (assignments: any[]) => ({
  id: 'a1',
  startTime: '2026-11-01T00:00:00.000Z',
  endTime: '2026-12-31T22:59:00.000Z',
  creativeRotation: { type: 'CREATIVE_ROTATION_TYPE_RANDOM', creativeAssignments: assignments },
});

test('end date goes to the creative assignment only: the Ad and its other creatives keep their dates', () => {
  const end = localDateTimeToIso('2026-11-24', undefined, true);
  const out = scheduleCreativeInAd(ad([
    { creativeId: '1', active: true, startTime: '2026-11-05T00:00:00.000Z' },
    { creativeId: '2', active: true, endTime: '2026-12-20T00:00:00.000Z' },
  ]), '1', { endTime: end })!;
  const [mine, other] = out.creativeRotation.creativeAssignments;
  assert.deepEqual([mine.startTime, mine.endTime], ['2026-11-05T00:00:00.000Z', end], 'existing start kept, new end set');
  assert.equal(other.endTime, '2026-12-20T00:00:00.000Z');
  assert.equal(out.clamped, false);
});

test('a date outside the Ad is adjusted to it (no 12049), and a creative not in the Ad is skipped', () => {
  const out = scheduleCreativeInAd(ad([{ creativeId: '1' }]), '1', { endTime: '2027-02-01T22:59:59.000Z' })!;
  assert.equal(out.creativeRotation.creativeAssignments[0].endTime, '2026-12-31T22:59:00.000Z');
  assert.equal(out.clamped, true);
  assert.equal(scheduleCreativeInAd(ad([{ creativeId: '9' }]), '1', { endTime: '2026-11-24T22:59:59.000Z' }), undefined);
  assert.throws(() => scheduleCreativeInAd(ad([{ creativeId: '1' }]), '1', { endTime: '2026-10-01T00:00:00.000Z' }), /no caben/);
});

test('local dates: the end covers the whole day', () => {
  const end = new Date(localDateTimeToIso('2026-11-24', undefined, true));
  assert.deepEqual([end.getDate(), end.getHours(), end.getMinutes()], [24, 23, 59]);
  const start = new Date(localDateTimeToIso('2026-11-24', '08:30'));
  assert.deepEqual([start.getDate(), start.getHours(), start.getMinutes()], [24, 8, 30]);
});
