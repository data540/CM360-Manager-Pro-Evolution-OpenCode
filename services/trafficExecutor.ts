// Runs a trafficking plan for one country folder: Drive → CM360 creative → campaign → ads.
// Follows the same CM360 calls as the app's uploadCreative / assignCreativeToAd (validated),
// but with an explicit advertiser (each folder has its own) and a Blob from Drive.

import { getForcedDefaultAdLanding } from '../constants';
import { buildCreativeAssignments } from './adAssignment';
import { readHtml5Size } from './creativeDetection';
import { downloadDriveFile } from './drive';
import type { TrafficPlan } from './trafficPlan';

export interface ExecutorContext {
  accessToken: string;
  profileId: string;
  driveToken: string;
  advertiserId: string;
  advertiserName: string;
  campaignId: string;
}

export type StepStatus = 'pending' | 'running' | 'done' | 'reused' | 'error' | 'skipped';

export interface CreativeStep {
  fileId: string;
  fileName: string;
  creativeName: string;
  status: StepStatus;
  creativeId?: string;
  message?: string;
}

export interface AdStep {
  adId: string;
  adName: string;
  status: StepStatus;
  message?: string;
}

export interface ExecutionLog {
  creatives: CreativeStep[];
  ads: AdStep[];
  finished: boolean;
}

// Bodies above this cannot go through the Vercel rewrite; direct calls have no such limit.
const PROXY_MAX_BYTES = 4 * 1024 * 1024;

const apiError = async (res: Response, fallback: string) => {
  const data = await res.json().catch(() => ({}));
  const detail = data?.error?.errors?.map((e: any) => e?.message).filter(Boolean).join(' | ');
  return detail || data?.error?.message || `${fallback} (HTTP ${res.status})`;
};

const cm = (ctx: ExecutorContext, path: string, init: RequestInit = {}) =>
  fetch(`/api/cm360/userprofiles/${ctx.profileId}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${ctx.accessToken}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  });

/** Uploads straight to Google (no Vercel size limit); falls back to the proxy for small files. */
const uploadAsset = async (ctx: ExecutorContext, blob: Blob, fileName: string, assetType: string) => {
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

/** A creative of this advertiser with exactly this name, so a re-run doesn't duplicate it. */
const findCreativeByName = async (ctx: ExecutorContext, name: string): Promise<string | undefined> => {
  const params = new URLSearchParams({ advertiserId: ctx.advertiserId, searchString: name, maxResults: '50' });
  const res = await cm(ctx, `creatives?${params.toString()}`);
  if (!res.ok) return undefined;
  const data = await res.json().catch(() => ({}));
  return (data.creatives || []).find((c: any) => c.name === name && !c.archived)?.id?.toString();
};

const createCreative = async (ctx: ExecutorContext, blob: Blob, fileName: string, kind: string, size: string, name: string) => {
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

const associateWithCampaign = async (ctx: ExecutorContext, creativeId: string) => {
  const res = await cm(ctx, `campaigns/${ctx.campaignId}/campaignCreativeAssociations`, {
    method: 'POST',
    body: JSON.stringify({ creativeId }),
  });
  if (!res.ok) {
    const message = await apiError(res, 'Error al asociar a la campaña');
    if (!/already|exists|duplicate/i.test(message)) throw new Error(message);
  }
};

const updateAd = async (ctx: ExecutorContext, adId: string, creativeIds: string[], mode: 'replace' | 'add') => {
  const res = await cm(ctx, `ads/${adId}`);
  if (!res.ok) throw new Error(await apiError(res, 'No se pudo leer el anuncio'));
  const ad = await res.json();
  if (String(ad.campaignId) !== String(ctx.campaignId)) throw new Error('El anuncio es de otra campaña.');

  const inRotation = Array.isArray(ad.creativeRotation?.creativeAssignments);
  const assignments = buildCreativeAssignments({
    current: inRotation ? ad.creativeRotation.creativeAssignments : ad.creativeAssignments || [],
    rotationType: ad.creativeRotation?.type,
    creativeIds,
    mode,
    forcedLanding: ad.type === 'AD_SERVING_DEFAULT_AD' ? getForcedDefaultAdLanding(ctx.advertiserName) : null,
  });
  const body = ad.creativeRotation
    ? { id: adId, creativeRotation: { ...ad.creativeRotation, creativeAssignments: assignments } }
    : { id: adId, creativeAssignments: assignments };
  const patch = await cm(ctx, `ads?id=${encodeURIComponent(adId)}`, { method: 'PATCH', body: JSON.stringify(body) });
  if (!patch.ok) throw new Error(await apiError(patch, 'Error al actualizar el anuncio'));

  // CM360 sometimes accepts the update without applying it: check the answer.
  const saved = await patch.json().catch(() => ({}));
  const savedIds = new Set(
    (saved.creativeRotation?.creativeAssignments || saved.creativeAssignments || []).map((a: any) => String(a.creativeId)),
  );
  const missing = creativeIds.filter((id) => !savedIds.has(String(id)));
  if (missing.length) throw new Error(`CM360 aceptó el cambio pero no muestra las creatividades ${missing.join(', ')}.`);
};

export const initialLog = (plan: TrafficPlan): ExecutionLog => ({
  creatives: plan.creatives.map((c) => ({ fileId: c.fileId, fileName: c.fileName, creativeName: c.creativeName, status: 'pending' })),
  ads: plan.adAssignments.map((a) => ({ adId: a.adId, adName: a.adName, status: 'pending' })),
  finished: false,
});

/** Executes the plan step by step, reporting every change through `onLog`. Never throws. */
export const executePlan = async (ctx: ExecutorContext, plan: TrafficPlan, onLog: (log: ExecutionLog) => void) => {
  const log = initialLog(plan);
  const emit = () => onLog({ ...log, creatives: [...log.creatives], ads: [...log.ads] });
  const setCreative = (i: number, patch: Partial<CreativeStep>) => { log.creatives[i] = { ...log.creatives[i], ...patch }; emit(); };
  const setAd = (i: number, patch: Partial<AdStep>) => { log.ads[i] = { ...log.ads[i], ...patch }; emit(); };
  emit();

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
          if (realSize && realSize !== planned.size) {
            throw new Error(`El HTML5 declara ${realSize}, no ${planned.size}: no se sube.`);
          }
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

  for (const [i, assignment] of plan.adAssignments.entries()) {
    const creativeIds = assignment.fileIds.map((id) => creativeIdByFile.get(id)).filter((id): id is string => !!id);
    if (creativeIds.length === 0) {
      setAd(i, { status: 'skipped', message: 'Ninguna de sus creatividades se pudo subir.' });
      continue;
    }
    setAd(i, { status: 'running' });
    try {
      await updateAd(ctx, assignment.adId, creativeIds, assignment.mode);
      const partial = creativeIds.length < assignment.fileIds.length;
      setAd(i, {
        status: 'done',
        message: `${creativeIds.length} creatividad${creativeIds.length === 1 ? '' : 'es'} (${assignment.mode === 'replace' ? 'sustituyen' : 'añadidas'})${partial ? ' · faltan las que fallaron' : ''}`,
      });
    } catch (e: any) {
      setAd(i, { status: 'error', message: e?.message || 'Error desconocido' });
    }
  }

  log.finished = true;
  emit();
  return log;
};
