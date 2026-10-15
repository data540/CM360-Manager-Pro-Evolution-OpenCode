// Executor for "crear desde cero": creates placements, uploads creatives, creates Default Ads.
// Mirrors trafficExecutor.ts structure; add a step, add a phase.

import { getForcedDefaultAdLanding } from '../constants';
import { readHtml5Size } from './creativeDetection';
import { downloadDriveFile } from './drive';
import type { FullTrafficPlan } from './trafficPlanFull';

export interface FullExecutorContext {
  accessToken: string;
  profileId: string;
  driveToken: string;
  advertiserId: string;
  advertiserName: string;
  campaignId: string;
  /** Used for the placement pricing schedule end date. Falls back to +1 year. */
  campaignEndDate?: string;
}

export type StepStatus = 'pending' | 'running' | 'done' | 'reused' | 'error' | 'skipped';

export interface PlacementStep {
  index: number;
  name: string;
  size: string;
  status: StepStatus;
  placementId?: string;
  message?: string;
}

export interface CreativeStep {
  fileId: string;
  fileName: string;
  creativeName: string;
  status: StepStatus;
  creativeId?: string;
  message?: string;
}

export interface DefaultAdStep {
  placementIndex: number;
  adName: string;
  status: StepStatus;
  adId?: string;
  message?: string;
}

export interface FullExecutionLog {
  placements: PlacementStep[];
  creatives: CreativeStep[];
  defaultAds: DefaultAdStep[];
  finished: boolean;
}

const PROXY_MAX_BYTES = 4 * 1024 * 1024;

const apiError = async (res: Response, fallback: string) => {
  const data = await res.json().catch(() => ({}));
  const detail = data?.error?.errors?.map((e: any) => e?.message).filter(Boolean).join(' | ');
  return detail || data?.error?.message || `${fallback} (HTTP ${res.status})`;
};

const cm = (ctx: FullExecutorContext, path: string, init: RequestInit = {}) =>
  fetch(`/api/cm360/userprofiles/${ctx.profileId}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${ctx.accessToken}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });

const createPlacement = async (
  ctx: FullExecutorContext,
  name: string,
  size: string,
  siteId: string,
  compatibility: string,
): Promise<string> => {
  const [width, height] = size.split('x').map(Number);
  const today = new Date().toISOString().split('T')[0];
  const endDate =
    ctx.campaignEndDate ||
    new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const res = await cm(ctx, 'placements', {
    method: 'POST',
    body: JSON.stringify({
      advertiserId: ctx.advertiserId,
      campaignId: ctx.campaignId,
      name,
      siteId,
      size: { width, height },
      compatibility,
      pricingSchedule: {
        pricingType: 'PRICING_TYPE_CPM',
        startDate: today,
        endDate,
      },
      tagFormats: ['PLACEMENT_TAG_STANDARD'],
      paymentSource: 'PLACEMENT_AGENCY_PAID',
    }),
  });
  if (!res.ok) throw new Error(await apiError(res, 'Error al crear el placement'));
  return String((await res.json()).id);
};

const uploadAsset = async (
  ctx: FullExecutorContext,
  blob: Blob,
  fileName: string,
  assetType: string,
) => {
  const metadata = { assetIdentifier: { type: assetType, name: fileName } };
  const body = () => {
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', blob, fileName);
    return form;
  };
  const path = `upload/dfareporting/v5/userprofiles/${ctx.profileId}/creativeAssets/${ctx.advertiserId}/creativeAssets?uploadType=multipart`;
  const init = () => ({ method: 'POST', headers: { Authorization: `Bearer ${ctx.accessToken}` }, body: body() });
  let res: Response;
  try {
    res = await fetch(`https://dfareporting.googleapis.com/${path}`, init());
  } catch (e) {
    if (blob.size > PROXY_MAX_BYTES) throw e;
    res = await fetch(`/api/cm360-upload/${path}`, init());
  }
  if (!res.ok) throw new Error(await apiError(res, 'Error al subir el archivo'));
  const data = await res.json();
  return (data.assetIdentifier || metadata.assetIdentifier) as { type: string; name: string };
};

const findCreativeByName = async (ctx: FullExecutorContext, name: string): Promise<string | undefined> => {
  const params = new URLSearchParams({ advertiserId: ctx.advertiserId, searchString: name, maxResults: '50' });
  const res = await cm(ctx, `creatives?${params.toString()}`);
  if (!res.ok) return undefined;
  const data = await res.json().catch(() => ({}));
  return (data.creatives || []).find((c: any) => c.name === name && !c.archived)?.id?.toString();
};

const createCreative = async (
  ctx: FullExecutorContext,
  blob: Blob,
  fileName: string,
  kind: string,
  size: string,
  name: string,
) => {
  const [width, height] = kind === 'video' ? [0, 0] : size.split('x').map(Number);
  const assetType = kind === 'video' ? 'VIDEO' : kind === 'html5' ? 'HTML' : 'HTML_IMAGE';
  const asset = await uploadAsset(ctx, blob, fileName, assetType);
  const type = kind === 'video' ? 'INSTREAM_VIDEO' : 'DISPLAY';
  const role = kind === 'video' && asset.type === 'VIDEO' ? 'PARENT_VIDEO' : 'PRIMARY';
  const res = await cm(ctx, 'creatives', {
    method: 'POST',
    body: JSON.stringify({
      advertiserId: ctx.advertiserId,
      name,
      type,
      size: { width, height },
      active: true,
      creativeAssets: [{ assetIdentifier: { type: asset.type, name: asset.name }, role, size: { width, height } }],
    }),
  });
  if (!res.ok) throw new Error(await apiError(res, 'Error al crear la creatividad'));
  return String((await res.json()).id);
};

const associateWithCampaign = async (ctx: FullExecutorContext, creativeId: string) => {
  const res = await cm(ctx, `campaigns/${ctx.campaignId}/campaignCreativeAssociations`, {
    method: 'POST',
    body: JSON.stringify({ creativeId }),
  });
  if (!res.ok) {
    const message = await apiError(res, 'Error al asociar a la campaña');
    if (!/already|exists|duplicate/i.test(message)) throw new Error(message);
  }
};

const createOrUpdateDefaultAd = async (
  ctx: FullExecutorContext,
  placementId: string,
  adName: string,
  creativeId: string,
  mode: 'replace' | 'add',
): Promise<string> => {
  // Look for an existing Default Ad on this placement.
  const params = new URLSearchParams({
    campaignIds: ctx.campaignId,
    placementIds: placementId,
    type: 'AD_SERVING_DEFAULT_AD',
    maxResults: '10',
  });
  const searchRes = await cm(ctx, `ads?${params.toString()}`);
  const existing = searchRes.ok
    ? ((await searchRes.json()).ads || []).find((ad: any) => ad.type === 'AD_SERVING_DEFAULT_AD')
    : undefined;

  const forcedLanding = getForcedDefaultAdLanding(ctx.advertiserName);
  const clickUrl = forcedLanding
    ? { defaultLandingPage: false, customClickThroughUrl: forcedLanding }
    : { defaultLandingPage: true };

  if (existing) {
    const current: any[] = existing.creativeRotation?.creativeAssignments || [];
    let assignments: any[];
    if (mode === 'replace') {
      assignments = [{ creativeId, active: true, weight: 1, clickThroughUrl: clickUrl }];
    } else {
      const alreadyIn = current.some((a: any) => String(a.creativeId) === String(creativeId));
      assignments = alreadyIn
        ? current
        : [
            ...current.map(({ id: _id, assignmentId: _aid, kind: _k, startTime: _s, endTime: _e, ...rest }: any) => rest),
            { creativeId, active: true, weight: 1, clickThroughUrl: clickUrl },
          ];
    }
    const patch = await cm(ctx, `ads?id=${encodeURIComponent(existing.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ id: existing.id, creativeRotation: { ...existing.creativeRotation, creativeAssignments: assignments } }),
    });
    if (!patch.ok) throw new Error(await apiError(patch, 'Error al actualizar el Default Ad'));
    return String(existing.id);
  }

  // Create a new Default Ad.
  const startTime = new Date(Date.now() + 60_000);
  const endTime = ctx.campaignEndDate
    ? new Date(ctx.campaignEndDate)
    : new Date(startTime.getTime() + 365 * 24 * 60 * 60 * 1000);

  const res = await cm(ctx, 'ads', {
    method: 'POST',
    body: JSON.stringify({
      campaignId: ctx.campaignId,
      advertiserId: ctx.advertiserId,
      name: adName,
      type: 'AD_SERVING_DEFAULT_AD',
      active: true,
      placementAssignments: [{ placementId, active: true }],
      creativeRotation: {
        type: 'CREATIVE_ROTATION_TYPE_RANDOM',
        weightCalculationStrategy: 'WEIGHT_STRATEGY_EQUAL',
        creativeAssignments: [{ creativeId, active: true, weight: 1, clickThroughUrl: clickUrl }],
      },
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
    }),
  });
  if (!res.ok) throw new Error(await apiError(res, 'Error al crear el Default Ad'));
  return String((await res.json()).id);
};

export const initialFullLog = (plan: FullTrafficPlan): FullExecutionLog => ({
  placements: plan.placements.map((p, i) => ({ index: i, name: p.name, size: p.size, status: 'pending' })),
  creatives: plan.creatives.map((c) => ({
    fileId: c.fileId,
    fileName: c.fileName,
    creativeName: c.creativeName,
    status: 'pending',
  })),
  defaultAds: plan.defaultAds.map((d) => ({ placementIndex: d.placementIndex, adName: d.adName, status: 'pending' })),
  finished: false,
});

/** Executes the full plan step by step, reporting every change through `onLog`. Never throws. */
export const executeFullPlan = async (
  ctx: FullExecutorContext,
  plan: FullTrafficPlan,
  defaultAdMode: 'replace' | 'add',
  onLog: (log: FullExecutionLog) => void,
): Promise<FullExecutionLog> => {
  const log = initialFullLog(plan);
  const emit = () =>
    onLog({
      ...log,
      placements: [...log.placements],
      creatives: [...log.creatives],
      defaultAds: [...log.defaultAds],
    });
  const setP = (i: number, patch: Partial<PlacementStep>) => { log.placements[i] = { ...log.placements[i], ...patch }; emit(); };
  const setC = (i: number, patch: Partial<CreativeStep>) => { log.creatives[i] = { ...log.creatives[i], ...patch }; emit(); };
  const setA = (i: number, patch: Partial<DefaultAdStep>) => { log.defaultAds[i] = { ...log.defaultAds[i], ...patch }; emit(); };
  emit();

  // Phase 1: create placements.
  const placementIds: (string | undefined)[] = new Array(plan.placements.length).fill(undefined);
  for (const [i, p] of plan.placements.entries()) {
    if (!p.siteId) {
      setP(i, { status: 'error', message: `Site "${p.siteToken}" no encontrado en CM360.` });
      continue;
    }
    setP(i, { status: 'running', message: 'Creando en CM360…' });
    try {
      const id = await createPlacement(ctx, p.name, p.size, p.siteId, p.compatibility);
      placementIds[i] = id;
      setP(i, { status: 'done', placementId: id });
    } catch (e: any) {
      setP(i, { status: 'error', message: e?.message || 'Error desconocido' });
    }
  }

  // Phase 2: upload creatives.
  const creativeIds: (string | undefined)[] = new Array(plan.creatives.length).fill(undefined);
  for (const [i, planned] of plan.creatives.entries()) {
    setC(i, { status: 'running', message: 'Comprobando si ya existe…' });
    try {
      const existing = await findCreativeByName(ctx, planned.creativeName);
      let creativeId = existing;
      if (!creativeId) {
        setC(i, { message: 'Descargando de Drive…' });
        const blob = await downloadDriveFile(ctx.driveToken, planned.fileId);
        if (planned.kind === 'html5') {
          const realSize = readHtml5Size(new Uint8Array(await blob.arrayBuffer()));
          if (realSize && realSize !== planned.size) {
            throw new Error(`El HTML5 declara ${realSize}, no ${planned.size}: no se sube.`);
          }
        }
        setC(i, { message: 'Subiendo a CM360…' });
        creativeId = await createCreative(ctx, blob, planned.fileName, planned.kind, planned.size, planned.creativeName);
      }
      setC(i, { message: 'Asociando a la campaña…' });
      await associateWithCampaign(ctx, creativeId);
      creativeIds[i] = creativeId;
      setC(i, {
        status: existing ? 'reused' : 'done',
        creativeId,
        message: existing ? 'Ya existía con este nombre: se reutiliza.' : undefined,
      });
    } catch (e: any) {
      setC(i, { status: 'error', message: e?.message || 'Error desconocido' });
    }
  }

  // Phase 3: create / update Default Ads.
  for (const [i, planned] of plan.defaultAds.entries()) {
    const placementId = placementIds[planned.placementIndex];
    const creativeId = creativeIds[planned.creativeIndex];
    if (!placementId) {
      setA(i, { status: 'skipped', message: 'El placement no se pudo crear.' });
      continue;
    }
    if (!creativeId) {
      setA(i, { status: 'skipped', message: 'La creatividad no se pudo subir.' });
      continue;
    }
    setA(i, { status: 'running' });
    try {
      const adId = await createOrUpdateDefaultAd(ctx, placementId, planned.adName, creativeId, defaultAdMode);
      setA(i, { status: 'done', adId });
    } catch (e: any) {
      setA(i, { status: 'error', message: e?.message || 'Error desconocido' });
    }
  }

  log.finished = true;
  emit();
  return log;
};
