// Builds an ad's new creative rotation when the folder trafficking assigns its creatives.
// Same rules as the app's single-creative assignment (assignCreativeToAd), but for several
// creatives at once, so each ad gets exactly one update per run.

export interface AssignmentInput {
  /** `creativeRotation.creativeAssignments` (or top-level `creativeAssignments`) as CM360 returns it. */
  current: any[];
  rotationType?: string;
  creativeIds: string[];
  mode: 'replace' | 'add';
  /** Fixed landing for Default Ads of some advertisers (Air Europa → aireuropa.com). */
  forcedLanding?: string | null;
}

// Output-only or per-entry fields that collide when an assignment is copied.
const OUTPUT_ONLY = ['id', 'assignmentId', 'kind', 'startTime', 'endTime'];

export const buildCreativeAssignments = ({ current, rotationType, creativeIds, mode, forcedLanding }: AssignmentInput): any[] => {
  const existing = current.filter((a) => a?.creativeId).map((a) => ({ ...a, active: a.active !== false }));
  const sequential = rotationType === 'CREATIVE_ROTATION_TYPE_SEQUENTIAL';
  // New entries copy the first current one: it carries the ad's click-through (landing) setup.
  const template = { ...(existing[0] || {}) };
  OUTPUT_ONLY.forEach((field) => delete template[field]);
  if (!template.clickThroughUrl) template.clickThroughUrl = { defaultLandingPage: true };

  const kept = mode === 'replace' ? [] : existing;
  const keptIds = new Set(kept.map((a) => String(a.creativeId)));
  let nextSequence = Math.max(0, ...kept.map((a) => Number(a.sequence)).filter((n) => Number.isFinite(n)));

  const added = creativeIds
    .filter((id) => !keptIds.has(String(id)))
    .map((creativeId) => {
      const entry: any = { ...template, creativeId, active: true };
      if (sequential) {
        entry.sequence = ++nextSequence;
        delete entry.weight;
      } else {
        if (!entry.weight || Number(entry.weight) <= 0) entry.weight = 1;
        delete entry.sequence;
      }
      return entry;
    });

  const next = [...kept, ...added];
  return forcedLanding
    ? next.map((a) => ({ ...a, clickThroughUrl: { defaultLandingPage: false, customClickThroughUrl: forcedLanding } }))
    : next;
};
