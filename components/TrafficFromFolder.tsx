import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, FolderOpen, Loader2, Rocket, XCircle } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { getGoogleClientId } from '../constants';
import type { DetectedFile } from '../services/creativeDetection';
import { getDriveFolder, getDriveToken, listDriveTree } from '../services/drive';
import { CountryGroup, DriveFolderResult, groupDriveFiles, parseDriveFolderId } from '../services/driveFolders';
import { buildTrafficPlan, PlanAd, PlanPlacement, TrafficPlan } from '../services/trafficPlan';
import { executePlan, ExecutionLog, StepStatus } from '../services/trafficExecutor';

// The Drive link is remembered per browser so the weekly folder doesn't have to be pasted again.
const LAST_LINK_KEY = 'traffic_folder_last_link';

const readLastLink = () => {
  try {
    return localStorage.getItem(LAST_LINK_KEY) || '';
  } catch {
    return '';
  }
};

const formatBytes = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const KIND_LABEL = { image: 'Imagen', html5: 'HTML5', video: 'Vídeo', unsupported: 'No admitido' } as const;

// Only these ad types carry creatives that the folder can feed (no trackers or click trackers).
const TRAFFICKABLE_AD_TYPES = ['AD_SERVING_STANDARD_AD', 'AD_SERVING_DEFAULT_AD'];

interface CampaignOption {
  id: string;
  name: string;
}

interface CampaignData {
  placements: PlanPlacement[];
  ads: PlanAd[];
}

/** Per country folder: chosen campaign and what CM360 returned for it. */
interface GroupState {
  campaignId: string;
  loading?: boolean;
  error?: string;
  data?: CampaignData;
}

const groupKey = (group: CountryGroup) => group.market?.code || `folder:${group.folderName}`;

const toPlanPlacement = (p: any): PlanPlacement => ({
  id: String(p.id),
  name: p.name,
  siteId: String(p.siteId),
  size: p.size?.width && p.size?.height ? `${p.size.width}x${p.size.height}` : undefined,
  compatibility: p.compatibility || 'DISPLAY',
  // CM360 v5 placements report status in `activeStatus`; there is no `archived` flag any more.
  active: p.activeStatus === 'PLACEMENT_STATUS_ACTIVE',
});

const toPlanAd = (ad: any): PlanAd => ({
  id: String(ad.id),
  name: ad.name || `Ad_${ad.id}`,
  isDefault: ad.type === 'AD_SERVING_DEFAULT_AD',
  active: !!ad.active && !ad.archived,
  placementIds: (ad.placementAssignments || []).map((pa: any) => String(pa.placementId)).filter(Boolean),
});

const IssueIcon: React.FC<{ severity: 'error' | 'warning' }> = ({ severity }) =>
  severity === 'error'
    ? <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
    : <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />;

const FileTable: React.FC<{ files: DetectedFile[] }> = ({ files }) => (
  <table className="w-full text-sm">
    <thead className="text-[10px] uppercase tracking-widest text-slate-500">
      <tr className="border-t border-slate-800">
        <th className="text-left px-4 py-2">Archivo</th>
        <th className="text-left px-4 py-2">Tipo</th>
        <th className="text-left px-4 py-2">Tamaño</th>
        <th className="text-left px-4 py-2">Peso</th>
        <th className="text-left px-4 py-2">Avisos</th>
      </tr>
    </thead>
    <tbody>
      {[...files]
        .sort((a, b) => (a.size || '').localeCompare(b.size || '', undefined, { numeric: true }))
        .map((file) => (
          <tr key={file.id} className="border-t border-slate-800">
            <td className="px-4 py-2 font-mono text-slate-200" title={file.relativePath}>{file.fileName}</td>
            <td className="px-4 py-2 text-slate-400">{KIND_LABEL[file.kind]}</td>
            <td className="px-4 py-2 font-mono text-slate-300">
              {file.size || '—'}
              {file.durationSec ? <span className="ml-2 text-xs text-slate-500">{file.durationSec}s</span> : null}
            </td>
            <td className="px-4 py-2 text-xs text-slate-500">{formatBytes(file.bytes)}</td>
            <td className="px-4 py-2 text-xs text-amber-300">
              {file.kind === 'unsupported' && <p>Tipo de archivo no admitido.</p>}
              {file.sizeMismatch && <p>El tamaño real ({file.size}) no coincide con el del nombre ({file.sizeFromName}).</p>}
              {file.kind === 'html5' && file.sizeSource !== 'file' && <p>Tamaño de HTML5 pendiente de leer del zip.</p>}
              {file.kind !== 'unsupported' && !file.size && <p>Sin tamaño detectado.</p>}
            </td>
          </tr>
        ))}
    </tbody>
  </table>
);

const PlanView: React.FC<{ plan: TrafficPlan; files: DetectedFile[] }> = ({ plan, files }) => {
  const [showIssues, setShowIssues] = useState(false);
  const fileById = new Map<string, DetectedFile>(files.map((f) => [f.id, f]));
  const plannedIds = new Set(plan.creatives.map((c) => c.fileId));
  const unplanned = files.filter((f) => !plannedIds.has(f.id));
  const errors = plan.issues.filter((i) => i.severity === 'error');
  // Agencies send more sizes than the campaign uses: files without a placement are expected,
  // they're listed apart in the table instead of as warnings.
  const warnings = plan.issues.filter((i) => i.severity === 'warning' && i.code !== 'unmatched_file');
  const uncovered = plan.coverage.filter((c) => c.fileIds.length === 0);

  return (
    <div className="border-t border-slate-800 p-4 space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Creatividades a subir', value: plan.creatives.length, tone: 'text-slate-100' },
          { label: 'Anuncios a actualizar', value: plan.adAssignments.length, tone: 'text-slate-100' },
          { label: 'Formatos extra (no se suben)', value: unplanned.length, tone: 'text-sky-300' },
          { label: 'Placements sin creatividad', value: uncovered.length, tone: uncovered.length ? 'text-amber-400' : 'text-emerald-400' },
        ].map((card) => (
          <div key={card.label} className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
            <p className="text-[10px] uppercase font-bold tracking-widest text-slate-500">{card.label}</p>
            <p className={`text-xl font-bold mt-1 ${card.tone}`}>{card.value}</p>
          </div>
        ))}
      </div>

      {errors.length > 0 && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 space-y-1">
          {errors.map((issue, i) => (
            <p key={i} className="flex items-start gap-2 text-sm text-rose-300"><IssueIcon severity="error" /> {issue.message}</p>
          ))}
        </div>
      )}

      <table className="w-full text-sm rounded-lg border border-slate-800 overflow-hidden">
        <thead className="bg-slate-900/60 text-[10px] uppercase tracking-widest text-slate-500">
          <tr>
            <th className="text-left px-3 py-2">Archivo</th>
            <th className="text-left px-3 py-2">Nombre de la creatividad</th>
            <th className="text-left px-3 py-2">Placements</th>
            <th className="text-left px-3 py-2">Anuncios</th>
          </tr>
        </thead>
        <tbody>
          {plan.creatives.map((c) => (
            <tr key={c.fileId} className="border-t border-slate-800">
              <td className="px-3 py-2 font-mono text-slate-300" title={fileById.get(c.fileId)?.relativePath}>{c.fileName}</td>
              <td className="px-3 py-2 font-mono text-slate-100 break-all">{c.creativeName}</td>
              <td className="px-3 py-2 text-slate-400" title={c.placementIds.join('\n')}>{c.placementIds.length}</td>
              <td className="px-3 py-2 text-slate-400" title={c.adIds.join('\n')}>
                {c.adIds.length || <span className="text-amber-400">0</span>}
              </td>
            </tr>
          ))}
          {unplanned.length > 0 && (
            <tr className="border-t border-slate-800 bg-sky-500/5">
              <td colSpan={4} className="px-3 py-1.5 text-[10px] uppercase font-bold tracking-widest text-sky-300/80">
                Formatos extra: sin placement en la campaña, no se suben
              </td>
            </tr>
          )}
          {[...unplanned]
            .sort((a, b) => (a.size || '').localeCompare(b.size || '', undefined, { numeric: true }))
            .map((f) => (
              <tr key={f.id} className="border-t border-slate-800 bg-sky-500/5 text-sky-200/60">
                <td className="px-3 py-2 font-mono">{f.fileName}</td>
                <td className="px-3 py-2 italic text-xs" colSpan={3}>
                  {f.kind === 'unsupported' ? 'Tipo de archivo no admitido' : f.size ? `No hay placements activos de ${f.size}` : 'Sin tamaño detectado'}
                </td>
              </tr>
            ))}
        </tbody>
      </table>

      {warnings.length > 0 && (
        <div className="rounded-lg border border-slate-800">
          <button
            onClick={() => setShowIssues((v) => !v)}
            className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-amber-300 hover:bg-slate-900/60"
          >
            <ChevronDown className={`w-4 h-4 transition-transform ${showIssues ? 'rotate-180' : ''}`} />
            {warnings.length} aviso{warnings.length === 1 ? '' : 's'}
          </button>
          {showIssues && (
            <div className="border-t border-slate-800 p-3 space-y-1">
              {warnings.map((issue, i) => (
                <p key={i} className="flex items-start gap-2 text-xs text-slate-300"><IssueIcon severity="warning" /> {issue.message}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const STEP_STYLE: Record<StepStatus, { label: string; tone: string }> = {
  pending: { label: 'Pendiente', tone: 'text-slate-500' },
  running: { label: 'En curso', tone: 'text-blue-300' },
  done: { label: 'Hecho', tone: 'text-emerald-400' },
  reused: { label: 'Reutilizada', tone: 'text-emerald-300' },
  error: { label: 'Error', tone: 'text-rose-400' },
  skipped: { label: 'Omitido', tone: 'text-slate-400' },
};

const StepBadge: React.FC<{ status: StepStatus }> = ({ status }) => (
  <span className={`inline-flex items-center gap-1 text-xs font-semibold whitespace-nowrap ${STEP_STYLE[status].tone}`}>
    {status === 'running' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
    {STEP_STYLE[status].label}
  </span>
);

interface ExecutionPanelProps {
  plan: TrafficPlan;
  campaignName: string;
  advertiserName: string;
  mode: 'replace' | 'add';
  includeDefaultAds: boolean;
  log?: ExecutionLog;
  confirming: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}

const ExecutionPanel: React.FC<ExecutionPanelProps> = ({ plan, campaignName, advertiserName, mode, includeDefaultAds, log, confirming, onAsk, onCancel, onConfirm }) => {
  const running = !!log && !log.finished;
  const defaultAds = plan.adAssignments.filter((a) => a.isDefault).length;

  if (!log) {
    if (plan.blocked || plan.creatives.length === 0) return null;
    return (
      <div className="border-t border-slate-800 p-4">
        {!confirming ? (
          <button
            onClick={onAsk}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-500 px-4 py-2 text-sm font-bold text-white"
          >
            <Rocket className="w-4 h-4" /> Traficar en CM360…
          </button>
        ) : (
          <div className="rounded-xl border border-blue-500/40 bg-blue-500/10 p-4 space-y-3">
            <p className="text-sm font-bold text-slate-100">Vas a modificar CM360 ({advertiserName}):</p>
            <ul className="text-sm text-slate-300 list-disc pl-5 space-y-1">
              <li>
                Subir <b>{plan.creatives.length}</b> creatividades a {advertiserName} y asociarlas a{' '}
                <span className="font-mono">{campaignName}</span>.
              </li>
              <li>
                Actualizar <b>{plan.adAssignments.length}</b> anuncios
                {defaultAds ? ` (${defaultAds} Default Ads)` : includeDefaultAds ? '' : ' (sin Default Ads)'}: las creatividades
                nuevas <b>{mode === 'replace' ? 'sustituyen a las actuales' : 'se añaden en rotación'}</b>.
              </li>
              <li>Las creatividades que ya existan con el mismo nombre se reutilizan, no se duplican.</li>
            </ul>
            <div className="flex gap-2">
              <button onClick={onConfirm} className="rounded-lg bg-blue-600 hover:bg-blue-500 px-4 py-2 text-sm font-bold text-white">
                Confirmar y ejecutar
              </button>
              <button onClick={onCancel} className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 hover:text-white">
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  const count = (steps: { status: StepStatus }[], ...statuses: StepStatus[]) => steps.filter((s) => statuses.includes(s.status)).length;
  const creativeErrors = count(log.creatives, 'error');
  const adErrors = count(log.ads, 'error');
  return (
    <div className="border-t border-slate-800 p-4 space-y-3">
      <p className="text-sm font-bold text-slate-100 flex flex-wrap items-center gap-2">
        {running ? <Loader2 className="w-4 h-4 animate-spin text-blue-300" /> : <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
        {running ? 'Traficando… no cierres esta pestaña.' : 'Terminado.'}
        <span className="font-normal text-xs text-slate-400">
          Creatividades: {count(log.creatives, 'done', 'reused')}/{log.creatives.length} ok
          {creativeErrors > 0 && <span className="text-rose-400"> · {creativeErrors} con error</span>}
          {' · '}Anuncios: {count(log.ads, 'done')}/{log.ads.length} ok
          {adErrors > 0 && <span className="text-rose-400"> · {adErrors} con error</span>}
        </span>
      </p>
      <div className="grid lg:grid-cols-2 gap-3">
        <div className="rounded-lg border border-slate-800 max-h-80 overflow-auto">
          {log.creatives.map((step) => (
            <div key={step.fileId} className="flex items-start gap-3 px-3 py-2 border-b border-slate-800 last:border-b-0 text-xs">
              <StepBadge status={step.status} />
              <div className="min-w-0">
                <p className="font-mono text-slate-200 break-all">{step.creativeName}</p>
                <p className="text-slate-500">
                  {step.creativeId ? `ID ${step.creativeId}` : step.fileName}
                  {step.message ? ` · ${step.message}` : ''}
                </p>
              </div>
            </div>
          ))}
        </div>
        <div className="rounded-lg border border-slate-800 max-h-80 overflow-auto">
          {log.ads.map((step) => (
            <div key={step.adId} className="flex items-start gap-3 px-3 py-2 border-b border-slate-800 last:border-b-0 text-xs">
              <StepBadge status={step.status} />
              <div className="min-w-0">
                <p className="text-slate-200 break-all">{step.adName}</p>
                <p className="text-slate-500">ID {step.adId}{step.message ? ` · ${step.message}` : ''}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const TrafficFromFolder: React.FC = () => {
  const { accessToken, profileId, selectedCampaign } = useApp();
  const [link, setLink] = useState(readLastLink);
  const [folder, setFolder] = useState<{ name: string; result: DriveFolderResult } | null>(null);
  const [campaignsByAdvertiser, setCampaignsByAdvertiser] = useState<Record<string, CampaignOption[]>>({});
  const [groupStates, setGroupStates] = useState<Record<string, GroupState>>({});
  const [includeDefaultAds, setIncludeDefaultAds] = useState(true);
  const [mode, setMode] = useState<'replace' | 'add'>('replace');
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [execLogs, setExecLogs] = useState<Record<string, ExecutionLog>>({});
  const [confirmKey, setConfirmKey] = useState<string | null>(null);

  const cmGet = async (path: string, params: URLSearchParams) => {
    const res = await fetch(`/api/cm360/userprofiles/${profileId}/${path}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401) throw new Error('La sesión de CM360 ha caducado: cierra sesión y vuelve a entrar.');
      throw new Error(`CM360 ${res.status}: ${data?.error?.message || res.statusText}`);
    }
    return data;
  };

  const listAll = async (path: string, key: string, params: URLSearchParams) => {
    const items: any[] = [];
    let pageToken: string | undefined;
    do {
      if (pageToken) params.set('pageToken', pageToken);
      const data = await cmGet(path, params);
      items.push(...(data[key] || []));
      pageToken = data.nextPageToken;
    } while (pageToken);
    return items;
  };

  const setGroupState = (key: string, patch: Partial<GroupState>) =>
    setGroupStates((prev) => ({ ...prev, [key]: { campaignId: '', ...prev[key], ...patch } }));

  const readFolder = async () => {
    const folderId = parseDriveFolderId(link);
    if (!folderId) {
      setError('No reconozco el enlace: pega el enlace de una carpeta de Google Drive.');
      return;
    }
    setError(null);
    setFolder(null);
    setGroupStates({});
    setExecLogs({});
    setConfirmKey(null);
    try {
      setProgress('Pidiendo acceso a Google Drive…');
      const token = await getDriveToken(getGoogleClientId());
      setProgress('Leyendo la carpeta…');
      const root = await getDriveFolder(token, folderId);
      const result = groupDriveFiles(root.name, await listDriveTree(token, folderId));
      try {
        localStorage.setItem(LAST_LINK_KEY, link.trim());
      } catch {
        // ignore storage errors
      }

      setProgress('Leyendo las campañas de cada país en CM360…');
      const advertiserIds = [...new Set(result.groups.map((g) => g.market?.advertiserId).filter((id): id is string => !!id))];
      const campaignLists: Record<string, CampaignOption[]> = {};
      for (const advertiserId of advertiserIds) {
        const campaigns = await listAll('campaigns', 'campaigns', new URLSearchParams({ advertiserIds: advertiserId, archived: 'false', maxResults: '1000' }));
        campaignLists[advertiserId] = campaigns
          .map((c) => ({ id: String(c.id), name: String(c.name) }))
          .sort((a, b) => a.name.localeCompare(b.name));
      }
      setCampaignsByAdvertiser(campaignLists);
      setFolder({ name: root.name, result });
    } catch (e: any) {
      setError(e?.message || 'Error desconocido');
    } finally {
      setProgress(null);
    }
  };

  const chooseCampaign = async (group: CountryGroup, campaignId: string) => {
    const key = groupKey(group);
    setGroupState(key, { campaignId, data: undefined, error: undefined, loading: !!campaignId });
    if (!campaignId) return;
    try {
      const params = () => new URLSearchParams({ campaignIds: campaignId, maxResults: '1000' });
      const [placements, ads] = await Promise.all([
        listAll('placements', 'placements', params()),
        listAll('ads', 'ads', params()),
      ]);
      setGroupStates((prev) => {
        // Ignore the answer if the user picked another campaign meanwhile.
        if (prev[key]?.campaignId !== campaignId) return prev;
        return {
          ...prev,
          [key]: {
            campaignId,
            data: {
              placements: placements.map(toPlanPlacement),
              ads: ads.filter((ad) => TRAFFICKABLE_AD_TYPES.includes(ad.type)).map(toPlanAd),
            },
          },
        };
      });
    } catch (e: any) {
      setGroupState(key, { loading: false, error: e?.message || 'Error desconocido' });
    }
  };

  // Pre-select the sidebar campaign for its own country, once the folder is read.
  useEffect(() => {
    if (!folder || !selectedCampaign) return;
    const group = folder.result.groups.find((g) => g.market?.advertiserId === String(selectedCampaign.advertiserId));
    if (group && !groupStates[groupKey(group)]?.campaignId) chooseCampaign(group, selectedCampaign.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder]);

  const plans = useMemo(() => {
    const out: Record<string, TrafficPlan> = {};
    if (!folder) return out;
    const uploadDate = new Date();
    folder.result.groups.forEach((group) => {
      const key = groupKey(group);
      const state = groupStates[key];
      const advertiserId = group.market?.advertiserId;
      const campaign = advertiserId && campaignsByAdvertiser[advertiserId]?.find((c) => c.id === state?.campaignId);
      if (!state?.data || !campaign) return;
      out[key] = buildTrafficPlan({
        campaign,
        folderMarket: group.market,
        files: group.files,
        placements: state.data.placements,
        ads: state.data.ads,
        options: { includeDefaultAds, mode, uploadDate },
      });
    });
    return out;
  }, [folder, groupStates, campaignsByAdvertiser, includeDefaultAds, mode]);

  const runExecution = async (group: CountryGroup, plan: TrafficPlan) => {
    const key = groupKey(group);
    const campaignId = groupStates[key]?.campaignId;
    if (!group.market || !campaignId || !accessToken || !profileId) return;
    setConfirmKey(null);
    try {
      const driveToken = await getDriveToken(getGoogleClientId());
      await executePlan(
        {
          accessToken,
          profileId,
          driveToken,
          advertiserId: group.market.advertiserId,
          advertiserName: group.market.advertiserName,
          campaignId,
        },
        plan,
        (log) => setExecLogs((prev) => ({ ...prev, [key]: log })),
      );
    } catch (e: any) {
      setGroupState(key, { error: e?.message || 'Error desconocido' });
    }
  };

  const anyRunning = Object.values<ExecutionLog>(execLogs).some((log) => !log.finished);
  const isRunning = progress !== null;

  return (
    <div className="view-root flex-1 flex flex-col h-full bg-slate-950/40">
      <div className="view-toolbar relative z-40 p-4 border-b border-slate-800 flex flex-wrap items-end justify-between gap-4 bg-slate-900/50 backdrop-blur-sm">
        <div>
          <p className="text-[10px] uppercase font-bold tracking-widest text-slate-500">Traficar desde carpeta de Drive</p>
          <h2 className="text-base font-bold text-slate-100 mt-1">Una carpeta por país → su anunciante → la campaña que elijas</h2>
        </div>

        <div className="flex items-end gap-2">
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Enlace de la carpeta de Google Drive</label>
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') readFolder(); }}
              placeholder="https://drive.google.com/drive/folders/…"
              className="w-[28rem] max-w-full bg-slate-950 border border-slate-800 rounded-lg py-2 px-3 text-sm text-slate-200 focus:outline-none focus:border-blue-500 placeholder:text-slate-600"
            />
          </div>
          <button
            onClick={readFolder}
            disabled={isRunning || anyRunning || !link.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-4 py-2 text-sm font-bold text-white"
          >
            {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderOpen className="w-4 h-4" />}
            Leer carpeta
          </button>
        </div>
      </div>

      {folder && (
        <div className="px-4 py-2.5 border-b border-slate-800 bg-slate-900/30 flex flex-wrap items-center gap-5 text-xs text-slate-400">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={includeDefaultAds} onChange={(e) => setIncludeDefaultAds(e.target.checked)} />
            Incluir Default Ads
          </label>
          <div className="flex items-center gap-3">
            <span>En los anuncios, las creatividades nuevas:</span>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} /> sustituyen a las actuales
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={mode === 'add'} onChange={() => setMode('add')} /> se añaden en rotación
            </label>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {progress && (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin" /> {progress}
          </div>
        )}
        {error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">{error}</div>}
        {!folder && !progress && !error && (
          <p className="text-sm text-slate-500">
            Pega el enlace de la carpeta de creatividades tal como llega (una carpeta por país, a cualquier nivel).
            Cada carpeta se asocia a su anunciante de CM360; elige en cada una la campaña para ver qué creatividad irá a
            qué placements y anuncios. Por ahora solo calcula el plan: no sube nada a CM360.
          </p>
        )}

        {folder && (
          <>
            <p className="text-xs text-slate-500">
              Carpeta «{folder.name}» · {folder.result.groups.reduce((n, g) => n + g.files.length, 0)} archivos
              {folder.result.ignored > 0 && ` · ${folder.result.ignored} archivos de sistema ignorados (__MACOSX, ._*)`}
            </p>
            {folder.result.unknownFolders.length > 0 && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
                Carpetas con archivos que no corresponden a ningún país conocido: {folder.result.unknownFolders.join(', ')}.
              </div>
            )}

            <div className="space-y-4">
              {folder.result.groups.map((group) => {
                const key = groupKey(group);
                const state = groupStates[key];
                const plan = plans[key];
                const campaignOptions = group.market ? campaignsByAdvertiser[group.market.advertiserId] || [] : [];
                return (
                  <section key={key} className={`rounded-xl border overflow-hidden ${plan ? 'border-emerald-500/40' : 'border-slate-800'}`}>
                    <div className="flex flex-wrap items-center gap-3 px-4 py-3 bg-slate-900/60">
                      {group.market
                        ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        : <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />}
                      <span className="text-sm font-bold text-slate-100">{group.folderName || '(raíz de la carpeta)'}</span>
                      <span className="text-xs text-slate-500">
                        {group.market ? group.market.advertiserName : 'País no reconocido: no se puede traficar'}
                        {' · '}{group.files.length} archivo{group.files.length === 1 ? '' : 's'}
                      </span>
                      {group.market && (
                        <div className="ml-auto flex items-center gap-2">
                          {state?.loading && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
                          <select
                            value={state?.campaignId || ''}
                            disabled={!!execLogs[key]}
                            onChange={(e) => chooseCampaign(group, e.target.value)}
                            className="w-80 max-w-full bg-slate-950 border border-slate-700 rounded-lg py-1.5 px-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
                          >
                            <option value="">Elegir campaña de {group.market.advertiserName}…</option>
                            {campaignOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </div>
                      )}
                    </div>
                    {state?.error && <p className="px-4 py-2 text-sm text-rose-300 border-t border-slate-800">{state.error}</p>}
                    {plan ? <PlanView plan={plan} files={group.files} /> : <FileTable files={group.files} />}
                    {plan && group.market && (
                      <ExecutionPanel
                        plan={plan}
                        campaignName={campaignOptions.find((c) => c.id === state?.campaignId)?.name || ''}
                        advertiserName={group.market.advertiserName}
                        mode={mode}
                        includeDefaultAds={includeDefaultAds}
                        log={execLogs[key]}
                        confirming={confirmKey === key}
                        onAsk={() => setConfirmKey(key)}
                        onCancel={() => setConfirmKey(null)}
                        onConfirm={() => runExecution(group, plan)}
                      />
                    )}
                  </section>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default TrafficFromFolder;
