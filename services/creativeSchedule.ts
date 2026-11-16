// Start / end date of a creative, edited from Creatives → Edit. In CM360 a creative has no dates
// of its own: they live on its assignment inside each Ad's rotation. Changing the Ad's
// start/end instead (what this used to do) moved every creative of the Ad and failed with
// 12049 ("The end date for the creative is not within the date range of its associated ad")
// whenever another creative of the Ad had later dates.

import { applyCreativeSchedule, type CreativeSchedule } from './trafficExecutor';

/** `YYYY-MM-DD` (+ `HH:mm`) in the user's local time → RFC 3339. End dates cover the whole day. */
export const localDateTimeToIso = (date: string, time?: string, endOfDay = false) =>
  new Date(`${date}T${time ? `${time}:00` : endOfDay ? '23:59:59' : '00:00:00'}`).toISOString();

export interface CreativeScheduleResult {
  updatedAds: number;
  /** Default Ads are never scheduled: they must always have something to serve. */
  skippedDefaultAds: number;
  /** Ads where the requested date was moved to fit the Ad's own window. */
  clampedAds: string[];
  errors: string[];
}

/**
 * The new rotation of `ad` with `creativeId` scheduled, or undefined when the creative is not in it.
 * Exported for tests; throws when the dates leave no time inside the Ad.
 */
export const scheduleCreativeInAd = (ad: any, creativeId: string, window: CreativeSchedule[string]) => {
  const rotation = ad.creativeRotation;
  const assignments: any[] = Array.isArray(rotation?.creativeAssignments) ? rotation.creativeAssignments : [];
  if (!assignments.some((a) => String(a.creativeId) === String(creativeId))) return undefined;
  const next = applyCreativeSchedule(assignments, { [String(creativeId)]: window }, ad.startTime, ad.endTime);
  const mine = next.find((a) => String(a.creativeId) === String(creativeId));
  const clamped = (!!window.startTime && mine?.startTime !== window.startTime) || (!!window.endTime && mine?.endTime !== window.endTime);
  return { creativeRotation: { ...rotation, creativeAssignments: next }, clamped };
};

export const scheduleCreativeInAds = async (params: {
  profileId: string;
  accessToken: string;
  creativeId: string;
  startTime?: string;
  endTime?: string;
}): Promise<CreativeScheduleResult> => {
  const { profileId, accessToken, creativeId } = params;
  const headers = { Authorization: `Bearer ${accessToken}` };
  const result: CreativeScheduleResult = { updatedAds: 0, skippedDefaultAds: 0, clampedAds: [], errors: [] };

  const ads: any[] = [];
  let pageToken: string | undefined;
  do {
    const qs = new URLSearchParams({ creativeIds: creativeId, archived: 'false', maxResults: '100' });
    if (pageToken) qs.set('pageToken', pageToken);
    const res = await fetch(`/api/cm360/userprofiles/${profileId}/ads?${qs.toString()}`, { headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      result.errors.push(data?.error?.message || `No se pudieron leer los Ads de la creatividad ${creativeId}.`);
      return result;
    }
    ads.push(...(data.ads || []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  const window = { startTime: params.startTime, endTime: params.endTime };
  for (const ad of ads.filter((a) => !a.archived)) {
    if (ad.type === 'AD_SERVING_DEFAULT_AD') {
      result.skippedDefaultAds++;
      continue;
    }
    try {
      const scheduled = scheduleCreativeInAd(ad, creativeId, window);
      if (!scheduled) continue;
      const res = await fetch(`/api/cm360/userprofiles/${profileId}/ads?id=${encodeURIComponent(ad.id)}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: ad.id, creativeRotation: scheduled.creativeRotation }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error?.message || `HTTP ${res.status}`);
      }
      result.updatedAds++;
      if (scheduled.clamped) result.clampedAds.push(ad.name || String(ad.id));
    } catch (e: any) {
      result.errors.push(`${ad.name || ad.id}: ${e?.message || 'error'}`);
    }
  }
  if (result.updatedAds === 0 && result.errors.length === 0) {
    result.errors.push('La creatividad no está en ningún Ad estándar: las fechas se aplican a su asignación dentro de cada Ad.');
  }
  return result;
};
