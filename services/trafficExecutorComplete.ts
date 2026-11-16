// Executor for "completar Ads": uploads the folder creatives with Batch Upload naming, then updates
// the existing Ads of each placement and creates the missing standard / Default Ads.

import { getForcedDefaultAdLanding } from '../constants';
import { readHtml5Size } from './creativeDetection';
import { downloadDriveFile } from './drive';
import {
  apiError,
  applyCreativeSchedule,
  associateWithCampaign,
  cm,
  createCreative,
  findCreativeByName,
  updateAd,
  type CreativeSchedule,
  type CreativeStep,
  type ExecutorContext,
  type StepStatus,
} from './trafficExecutor';
import type { CompleteAdAction, CompletePlan } from './trafficPlanComplete';

export interface CompleteExecutorContext extends ExecutorContext {
  campaignEndDate?: string;
}

export interface CompleteAdStep {
  key: string;
  kind: 'update' | 'create' | 'landing';
  isDefault: boolean;
  adName: string;
  status: StepStatus;
  adId?: string;
  message?: string;
}

export interface CompleteExecutionLog {
  creatives: CreativeStep[];
  ads: CompleteAdStep[];
  finished: boolean;
}

const AD_TYPE = (isDefault: boolean) => (isDefault ? 'AD_SERVING_DEFAULT_AD' : 'AD_SERVING_STANDARD_AD');

/** An ad of that type already on the placement (e.g. a Default Ad CM360 created on its own). */
const findAdOnPlacement = async (ctx: CompleteExecutorContext, placementId: string, isDefault: boolean) => {
  const params = new URLSearchParams({ campaignIds: ctx.campaignId, placementIds: placementId, type: AD_TYPE(isDefault), maxResults: '50' });
  const res = await cm(ctx, `ads?${params.toString()}`);
  if (!res.ok) return undefined;
  const data = await res.json().catch(() => ({}));
  return (data.ads || []).find((ad: any) =>
    ad.type === AD_TYPE(isDefault) && !ad.archived && (isDefault || ad.active)
    && (ad.placementAssignments || []).some((pa: any) => String(pa.placementId) === String(placementId)),
  ) as { id: string | number; name?: string } | undefined;
};

const createAd = async (ctx: CompleteExecutorContext, action: CompleteAdAction, creativeIds: string[], schedule?: CreativeSchedule) => {
  const startTime = new Date(Date.now() + 60_000);
  const proposedEnd = ctx.campaignEndDate ? new Date(`${ctx.campaignEndDate}T23:59:00`) : null;
  const endTime = proposedEnd && proposedEnd.getTime() > startTime.getTime()
    ? proposedEnd
    : new Date(startTime.getTime() + 30 * 24 * 60 * 60 * 1000);
  const forcedLanding = action.clickUrl || (action.isDefault ? getForcedDefaultAdLanding(ctx.advertiserName) : null);
  const clickThroughUrl = forcedLanding
    ? { defaultLandingPage: false, customClickThroughUrl: forcedLanding }
    : { defaultLandingPage: true };

  const body: Record<string, unknown> = {
    campaignId: ctx.campaignId,
    advertiserId: ctx.advertiserId,
    name: action.adName,
    active: true,
    type: AD_TYPE(action.isDefault),
    placementAssignments: [{ placementId: action.placementId, active: true }],
    creativeRotation: {
      type: 'CREATIVE_ROTATION_TYPE_RANDOM',
      weightCalculationStrategy: 'WEIGHT_STRATEGY_EQUAL',
      creativeAssignments: applyCreativeSchedule(
        creativeIds.map((creativeId) => ({ creativeId, active: true, weight: 1, clickThroughUrl })),
        action.isDefault ? undefined : schedule,
        startTime.toISOString(),
        endTime.toISOString(),
      ),
    },
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
  };
  if (!action.isDefault) body.deliverySchedule = { priority: 'AD_PRIORITY_01', impressionRatio: '1' };

  const res = await cm(ctx, 'ads', { method: 'POST', body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await apiError(res, action.isDefault ? 'Error al crear el Default Ad' : 'Error al crear el Ad'));
  return String((await res.json()).id);
};

export const initialCompleteLog = (plan: CompletePlan): CompleteExecutionLog => ({
  creatives: plan.creatives.map((c) => ({ fileId: c.fileId, fileName: c.fileName, creativeName: c.creativeName, status: 'pending' })),
  ads: plan.actions.map((a) => ({ key: a.key, kind: a.kind, isDefault: a.isDefault, adName: a.adName, adId: a.adId, status: 'pending' })),
  finished: false,
});

/** Executes the plan step by step, reporting every change through `onLog`. Never throws. */
export const executeCompletePlan = async (
  ctx: CompleteExecutorContext,
  plan: CompletePlan,
  onLog: (log: CompleteExecutionLog) => void,
) => {
  const log = initialCompleteLog(plan);
  const emit = () => onLog({ ...log, creatives: [...log.creatives], ads: [...log.ads] });
  const setCreative = (i: number, patch: Partial<CreativeStep>) => { log.creatives[i] = { ...log.creatives[i], ...patch }; emit(); };
  const setAd = (i: number, patch: Partial<CompleteAdStep>) => { log.ads[i] = { ...log.ads[i], ...patch }; emit(); };
  emit();

  // Phase 1: upload (or reuse by name) every matched creative and associate it to the campaign.
  const creativeIdByFile = new Map<string, string>();
  for (const [i, planned] of plan.creatives.entries()) {
    setCreative(i, { status: 'running', message: 'Comprobando si ya existe…' });
    try {
      const existing = await findCreativeByName(ctx, planned.creativeName);
      let creativeId = existing;
      if (!creativeId) {
        setCreative(i, { message: 'Descargando de Drive…' });
        const blob = await downloadDriveFile(ctx.driveToken, planned.fileId);
        if (planned.kind === 'html5') {
          const realSize = readHtml5Size(new Uint8Array(await blob.arrayBuffer()));
          if (realSize && realSize !== planned.size) throw new Error(`El HTML5 declara ${realSize}, no ${planned.size}: no se sube.`);
        }
        setCreative(i, { message: 'Subiendo a CM360…' });
        creativeId = await createCreative(ctx, blob, planned.fileName, planned.kind, planned.size, planned.creativeName);
      }
      setCreative(i, { message: 'Asociando a la campaña…' });
      await associateWithCampaign(ctx, creativeId);
      creativeIdByFile.set(planned.fileId, creativeId);
      setCreative(i, {
        status: existing ? 'reused' : 'done',
        creativeId,
        message: existing ? 'Ya existía con este nombre: se reutiliza.' : undefined,
      });
    } catch (e: any) {
      setCreative(i, { status: 'error', message: e?.message || 'Error desconocido' });
    }
  }

  // Creative serving windows (standard Ads only: Default Ads must always have something to serve).
  const schedule: CreativeSchedule = {};
  plan.creatives.forEach((c) => {
    const creativeId = creativeIdByFile.get(c.fileId);
    if (!creativeId || (!c.startDate && !c.endDate)) return;
    schedule[creativeId] = {
      startTime: c.startDate ? new Date(`${c.startDate}T00:00:00`).toISOString() : undefined,
      endTime: c.endDate ? new Date(`${c.endDate}T23:59:59`).toISOString() : undefined,
    };
  });
  const scheduleFor = (action: CompleteAdAction) => (action.isDefault ? undefined : schedule);

  // Phase 2: update existing Ads, create the missing ones.
  for (const [i, action] of plan.actions.entries()) {
    if (action.kind === 'landing') {
      setAd(i, { status: 'running' });
      try {
        await updateAd(ctx, action.adId!, [], 'add', action.clickUrl);
        setAd(i, { status: 'done', message: 'Landing actualizada con la URL de tracking.' });
      } catch (e: any) {
        setAd(i, { status: 'error', message: e?.message || 'Error desconocido' });
      }
      continue;
    }
    const creativeIds = action.fileIds.map((id) => creativeIdByFile.get(id)).filter((id): id is string => !!id);
    if (creativeIds.length === 0) {
      setAd(i, { status: 'skipped', message: 'Ninguna de sus creatividades se pudo subir.' });
      continue;
    }
    const partial = creativeIds.length < action.fileIds.length ? ' · faltan las que fallaron' : '';
    setAd(i, { status: 'running' });
    try {
      if (action.kind === 'update') {
        await updateAd(ctx, action.adId!, creativeIds, action.mode, action.clickUrl, scheduleFor(action));
        setAd(i, { status: 'done', message: `${creativeIds.length} creatividad${creativeIds.length === 1 ? '' : 'es'} (${action.mode === 'replace' ? 'sustituyen' : 'añadidas'})${partial}` });
        continue;
      }
      // Re-check: a re-run, or CM360 itself after the campaign association, may have created it.
      const existing = await findAdOnPlacement(ctx, action.placementId!, action.isDefault);
      if (existing) {
        const adId = String(existing.id);
        await updateAd(ctx, adId, creativeIds, action.isDefault ? 'replace' : action.mode, action.clickUrl, scheduleFor(action));
        setAd(i, { status: 'done', adId, adName: existing.name || action.adName, message: `Ya existía: actualizado${partial}` });
        continue;
      }
      const adId = await createAd(ctx, action, creativeIds, scheduleFor(action));
      setAd(i, { status: 'done', adId, message: `${action.clickUrl ? 'Landing de tracking · ' : ''}Creado con ${creativeIds.length} creatividad${creativeIds.length === 1 ? '' : 'es'}${partial}` });
    } catch (e: any) {
      setAd(i, { status: 'error', message: e?.message || 'Error desconocido' });
    }
  }

  log.finished = true;
  emit();
  return log;
};
