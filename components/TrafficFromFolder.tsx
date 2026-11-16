import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, FileSpreadsheet, FileText, FolderOpen, Layers, Link2, ListPlus, Loader2, Plus, Rocket, X, XCircle } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { getGoogleClientId } from '../constants';
import type { DetectedFile } from '../services/creativeDetection';
import { getDriveFolder, getDriveToken, listDriveTree } from '../services/drive';
import { CountryGroup, DriveFolderResult, groupDriveFiles, parseDriveFolderId } from '../services/driveFolders';
import { buildTrafficPlan, PlanAd, PlanPlacement, TrafficPlan } from '../services/trafficPlan';
import { executePlan, ExecutionLog, StepStatus } from '../services/trafficExecutor';
import { buildFullTrafficPlan, FullPlannedCreative, FullTrafficPlan, parsePlacementNames } from '../services/trafficPlanFull';
import { executeFullPlan, FullExecutionLog, initialFullLog } from '../services/trafficExecutorFull';
import { buildCompletePlan, buildPrefixedCreativeName, CompleteOptions, CompletePlan, CreativeDates, RowAction } from '../services/trafficPlanComplete';
import { formatDateToken } from '../services/trafficPlan';
import { CompleteExecutionLog, executeCompletePlan, initialCompleteLog } from '../services/trafficExecutorComplete';
import { readTrackingFile, TrackingSheet } from '../services/trackingSheet';
import { MARKETS } from '../services/markets';

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

const TRAFFICKABLE_AD_TYPES = ['AD_SERVING_STANDARD_AD', 'AD_SERVING_DEFAULT_AD'];

interface CmSiteRef { id: string; name: string }

interface CampaignOption { id: string; name: string; startDate?: string; endDate?: string }

interface CampaignData {
  placements: PlanPlacement[];
  ads: PlanAd[];
  sites: CmSiteRef[];
}

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

// ─── Mode A: existing placements ──────────────────────────────────────────────

const PlanView: React.FC<{ plan: TrafficPlan; files: DetectedFile[] }> = ({ plan, files }) => {
  const [showIssues, setShowIssues] = useState(false);
  const fileById = new Map<string, DetectedFile>(files.map((f) => [f.id, f]));
  const plannedIds = new Set(plan.creatives.map((c) => c.fileId));
  const unplanned = files.filter((f) => !plannedIds.has(f.id));
  const errors = plan.issues.filter((i) => i.severity === 'error');
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

// ─── Mode B: create from scratch ──────────────────────────────────────────────

const FullPlanView: React.FC<{ plan: FullTrafficPlan }> = ({ plan }) => {
  const unknownSites = plan.placements.filter((p) => p.siteUnknown);
  const creativeBySize = new Map<string, FullPlannedCreative>(plan.creatives.map((c) => [c.size, c]));

  return (
    <div className="border-t border-slate-800 p-4 space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Placements a crear', value: plan.placements.length, tone: 'text-slate-100' },
          { label: 'Creatividades a subir', value: plan.creatives.length, tone: 'text-slate-100' },
          { label: 'Default Ads', value: plan.defaultAds.length, tone: 'text-slate-100' },
          { label: 'Archivos sin placement', value: plan.extraFiles.length, tone: plan.extraFiles.length ? 'text-sky-300' : 'text-emerald-400' },
        ].map((card) => (
          <div key={card.label} className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
            <p className="text-[10px] uppercase font-bold tracking-widest text-slate-500">{card.label}</p>
            <p className={`text-xl font-bold mt-1 ${card.tone}`}>{card.value}</p>
          </div>
        ))}
      </div>

      {unknownSites.length > 0 && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 space-y-1">
          <p className="text-xs font-bold text-rose-300">
            {unknownSites.length} placement{unknownSites.length > 1 ? 's' : ''} con site no reconocido en CM360. No se podrán crear.
          </p>
          {unknownSites.slice(0, 5).map((p) => (
            <p key={p.name} className="text-xs text-rose-200 font-mono">{p.name}</p>
          ))}
          {unknownSites.length > 5 && <p className="text-xs text-rose-400">… y {unknownSites.length - 5} más</p>}
        </div>
      )}

      <table className="w-full text-sm rounded-lg border border-slate-800 overflow-hidden">
        <thead className="bg-slate-900/60 text-[10px] uppercase tracking-widest text-slate-500">
          <tr>
            <th className="text-left px-3 py-2">Placement</th>
            <th className="text-left px-3 py-2">Formato</th>
            <th className="text-left px-3 py-2">Site</th>
            <th className="text-left px-3 py-2">Creatividad</th>
            <th className="text-left px-3 py-2">Default Ad</th>
          </tr>
        </thead>
        <tbody>
          {plan.placements.map((p, i) => {
            const creative = creativeBySize.get(p.size);
            const hasDefaultAd = plan.defaultAds.some((d) => d.placementIndex === i);
            return (
              <tr key={i} className="border-t border-slate-800">
                <td className="px-3 py-2 font-mono text-slate-200 break-all text-xs">{p.name}</td>
                <td className="px-3 py-2 font-mono text-slate-300">{p.size}</td>
                <td className="px-3 py-2 text-xs">
                  {p.siteUnknown
                    ? <span className="text-rose-400">{p.siteToken} (sin resolver)</span>
                    : <span className="text-emerald-300">{p.siteName}</span>}
                </td>
                <td className="px-3 py-2 font-mono text-slate-400 text-xs">
                  {creative ? creative.fileName : <span className="text-amber-400">Sin archivo</span>}
                </td>
                <td className="px-3 py-2 text-xs">
                  {hasDefaultAd ? <span className="text-emerald-400">✓</span> : <span className="text-slate-600">—</span>}
                </td>
              </tr>
            );
          })}
          {plan.extraFiles.length > 0 && (
            <tr className="border-t border-slate-800 bg-sky-500/5">
              <td colSpan={5} className="px-3 py-1.5 text-[10px] uppercase font-bold tracking-widest text-sky-300/80">
                Archivos sin placement de ese tamaño en la lista — no se subirán
              </td>
            </tr>
          )}
          {plan.extraFiles.map((f) => (
            <tr key={f.id} className="border-t border-slate-800 bg-sky-500/5 text-sky-200/60">
              <td className="px-3 py-2 font-mono text-xs">{f.fileName}</td>
              <td className="px-3 py-2 font-mono text-xs">{f.size || '—'}</td>
              <td colSpan={3} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ─── Shared step badge ─────────────────────────────────────────────────────────

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

// ─── Mode A execution panel ────────────────────────────────────────────────────

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
              <li>Subir <b>{plan.creatives.length}</b> creatividades a {advertiserName} y asociarlas a <span className="font-mono">{campaignName}</span>.</li>
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
                <p className="text-slate-500">{step.creativeId ? `ID ${step.creativeId}` : step.fileName}{step.message ? ` · ${step.message}` : ''}</p>
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

// ─── Mode B execution panel ────────────────────────────────────────────────────

interface FullExecutionPanelProps {
  plan: FullTrafficPlan;
  campaignName: string;
  advertiserName: string;
  defaultAdMode: 'replace' | 'add';
  log?: FullExecutionLog;
  confirming: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}

const FullExecutionPanel: React.FC<FullExecutionPanelProps> = ({ plan, campaignName, advertiserName, defaultAdMode, log, confirming, onAsk, onCancel, onConfirm }) => {
  const running = !!log && !log.finished;
  const canCreate = plan.placements.some((p) => !p.siteUnknown);

  if (!log) {
    if (!canCreate || plan.creatives.length === 0) return null;
    return (
      <div className="border-t border-slate-800 p-4">
        {!confirming ? (
          <button
            onClick={onAsk}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 hover:bg-violet-500 px-4 py-2 text-sm font-bold text-white"
          >
            <Rocket className="w-4 h-4" /> Crear en CM360 desde cero…
          </button>
        ) : (
          <div className="rounded-xl border border-violet-500/40 bg-violet-500/10 p-4 space-y-3">
            <p className="text-sm font-bold text-slate-100">Vas a crear en CM360 ({advertiserName}) — campaña <span className="font-mono">{campaignName}</span>:</p>
            <ul className="text-sm text-slate-300 list-disc pl-5 space-y-1">
              <li>Crear <b>{plan.placements.filter((p) => !p.siteUnknown).length}</b> placements nuevos.</li>
              <li>Subir <b>{plan.creatives.length}</b> creatividades y asociarlas a la campaña.</li>
              {plan.defaultAds.length > 0 && (
                <li>
                  Crear / actualizar <b>{plan.defaultAds.length}</b> Default Ads.
                  Las creatividades {defaultAdMode === 'replace' ? 'sustituyen a las actuales' : 'se añaden en rotación'}.
                </li>
              )}
              <li>Las creatividades que ya existan con el mismo nombre se reutilizan.</li>
            </ul>
            <div className="flex gap-2">
              <button onClick={onConfirm} className="rounded-lg bg-violet-600 hover:bg-violet-500 px-4 py-2 text-sm font-bold text-white">
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

  const count = (steps: { status: StepStatus }[], ...statuses: StepStatus[]) =>
    steps.filter((s) => statuses.includes(s.status)).length;
  const pErrors = count(log.placements, 'error');
  const cErrors = count(log.creatives, 'error');
  const aErrors = count(log.defaultAds, 'error');

  return (
    <div className="border-t border-slate-800 p-4 space-y-3">
      <p className="text-sm font-bold text-slate-100 flex flex-wrap items-center gap-2">
        {running ? <Loader2 className="w-4 h-4 animate-spin text-blue-300" /> : <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
        {running ? 'Creando… no cierres esta pestaña.' : 'Terminado.'}
        <span className="font-normal text-xs text-slate-400">
          Placements: {count(log.placements, 'done')}/{log.placements.length} ok
          {pErrors > 0 && <span className="text-rose-400"> · {pErrors} error</span>}
          {' · '}Creatividades: {count(log.creatives, 'done', 'reused')}/{log.creatives.length} ok
          {cErrors > 0 && <span className="text-rose-400"> · {cErrors} error</span>}
          {log.defaultAds.length > 0 && <>
            {' · '}Default Ads: {count(log.defaultAds, 'done')}/{log.defaultAds.length} ok
            {aErrors > 0 && <span className="text-rose-400"> · {aErrors} error</span>}
          </>}
        </span>
      </p>
      <div className="grid lg:grid-cols-3 gap-3">
        <div className="rounded-lg border border-slate-800 max-h-72 overflow-auto">
          <p className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-slate-500 font-bold border-b border-slate-800">Placements</p>
          {log.placements.map((step) => (
            <div key={step.index} className="flex items-start gap-2 px-3 py-2 border-b border-slate-800 last:border-b-0 text-xs">
              <StepBadge status={step.status} />
              <div className="min-w-0">
                <p className="font-mono text-slate-200 break-all">{step.name}</p>
                <p className="text-slate-500">{step.placementId ? `ID ${step.placementId}` : step.message || ''}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="rounded-lg border border-slate-800 max-h-72 overflow-auto">
          <p className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-slate-500 font-bold border-b border-slate-800">Creatividades</p>
          {log.creatives.map((step) => (
            <div key={step.fileId} className="flex items-start gap-2 px-3 py-2 border-b border-slate-800 last:border-b-0 text-xs">
              <StepBadge status={step.status} />
              <div className="min-w-0">
                <p className="font-mono text-slate-200 break-all">{step.creativeName}</p>
                <p className="text-slate-500">{step.creativeId ? `ID ${step.creativeId}` : step.fileName}{step.message ? ` · ${step.message}` : ''}</p>
              </div>
            </div>
          ))}
        </div>
        {log.defaultAds.length > 0 && (
          <div className="rounded-lg border border-slate-800 max-h-72 overflow-auto">
            <p className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-slate-500 font-bold border-b border-slate-800">Default Ads</p>
            {log.defaultAds.map((step, i) => (
              <div key={i} className="flex items-start gap-2 px-3 py-2 border-b border-slate-800 last:border-b-0 text-xs">
                <StepBadge status={step.status} />
                <div className="min-w-0">
                  <p className="text-slate-200">{step.adName}</p>
                  <p className="text-slate-500">{step.adId ? `ID ${step.adId}` : step.message || ''}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Mode C: complete Ads / Default Ads ────────────────────────────────────────

const ROW_ACTION_LABEL: Record<RowAction, { label: string; tone: string }> = {
  update: { label: 'Actualizar', tone: 'text-sky-300' },
  create: { label: 'Crear', tone: 'text-emerald-300' },
  landing: { label: 'Solo landing', tone: 'text-fuchsia-300' },
  none: { label: 'Sin Default', tone: 'text-amber-400' },
  off: { label: '—', tone: 'text-slate-600' },
};

const RowActionCell: React.FC<{ action: RowAction; adNames: string[] }> = ({ action, adNames }) => (
  <td className="px-3 py-2 text-xs" title={adNames.join('\n')}>
    <span className={`font-semibold ${ROW_ACTION_LABEL[action].tone}`}>{ROW_ACTION_LABEL[action].label}</span>
    {adNames.length > 0 && <span className="block text-slate-500 break-all">{adNames.length === 1 ? adNames[0] : `${adNames.length} Ads`}</span>}
  </td>
);

interface CompletePlanViewProps {
  plan: CompletePlan;
  files: DetectedFile[];
  campaign?: CampaignOption;
  dates: Record<string, CreativeDates>;
  onDates?: (next: Record<string, CreativeDates>) => void;
}

const CompletePlanView: React.FC<CompletePlanViewProps> = ({ plan, files, campaign, dates, onDates }) => {
  const [showIssues, setShowIssues] = useState(false);
  const [bulk, setBulk] = useState<CreativeDates>({});
  const setDate = (fileId: string, field: keyof CreativeDates, value: string) =>
    onDates?.({ ...dates, [fileId]: { ...dates[fileId], [field]: value || undefined } });
  const applyBulk = () =>
    onDates?.(Object.fromEntries(plan.creatives.map((c) => [c.fileId, { ...dates[c.fileId], ...(bulk.start ? { start: bulk.start } : {}), ...(bulk.end ? { end: bulk.end } : {}) }])));
  const dateInput = 'bg-slate-950 border border-slate-700 rounded-md py-1 px-1.5 text-xs text-slate-200 focus:outline-none focus:border-teal-500 disabled:opacity-50 [color-scheme:dark]';
  const creativeByFile = new Map<string, CompletePlan['creatives'][number]>(plan.creatives.map((c) => [c.fileId, c]));
  const count = (pred: (a: CompletePlan['actions'][number]) => boolean) => plan.actions.filter(pred).length;
  const errors = plan.issues.filter((i) => i.severity === 'error');
  const warnings = plan.issues.filter((i) => i.severity === 'warning');
  const fileName = new Map(files.map((f) => [f.id, f.fileName]));
  const hasLandings = plan.rows.some((r) => r.landing);

  return (
    <div className="border-t border-slate-800 p-4 space-y-4">
      <div className={`grid grid-cols-2 gap-3 ${hasLandings ? 'lg:grid-cols-6' : 'lg:grid-cols-5'}`}>
        {[
          { label: 'Creatividades a subir', value: plan.creatives.length, tone: 'text-slate-100' },
          { label: 'Ads a crear', value: count((a) => a.kind === 'create' && !a.isDefault), tone: 'text-emerald-300' },
          { label: 'Ads a actualizar', value: count((a) => a.kind === 'update' && !a.isDefault), tone: 'text-sky-300' },
          { label: 'Default Ads crear / actualizar', value: `${count((a) => a.kind === 'create' && a.isDefault)} / ${count((a) => a.kind === 'update' && a.isDefault)}`, tone: 'text-slate-100' },
          { label: 'Placements sin creatividad', value: plan.uncovered.length, tone: plan.uncovered.length ? 'text-amber-400' : 'text-emerald-400' },
          ...(hasLandings ? [{ label: 'Ads con landing de tracking', value: count((a) => !!a.clickUrl), tone: 'text-fuchsia-300' }] : []),
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

      {plan.creatives.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span className="text-[10px] uppercase font-bold tracking-widest text-slate-500">Fechas de las creatividades</span>
            <span className="text-slate-500">
              Vacío = mientras dure el Ad{campaign?.startDate || campaign?.endDate ? ` (campaña ${campaign?.startDate || '…'} → ${campaign?.endDate || '…'})` : ''}.
            </span>
            <span className="ml-auto flex items-center gap-1.5">
              Todas:
              <input type="date" disabled={!onDates} value={bulk.start || ''} min={campaign?.startDate} max={campaign?.endDate}
                onChange={(e) => setBulk((b) => ({ ...b, start: e.target.value || undefined }))} className={dateInput} />
              →
              <input type="date" disabled={!onDates} value={bulk.end || ''} min={campaign?.startDate} max={campaign?.endDate}
                onChange={(e) => setBulk((b) => ({ ...b, end: e.target.value || undefined }))} className={dateInput} />
              <button onClick={applyBulk} disabled={!onDates || (!bulk.start && !bulk.end)}
                className="rounded-md border border-slate-700 px-2 py-1 font-semibold text-slate-300 hover:text-white disabled:opacity-40">Aplicar</button>
              <button onClick={() => onDates?.({})} disabled={!onDates || Object.keys(dates).length === 0}
                className="rounded-md px-2 py-1 text-slate-500 hover:text-slate-200 disabled:opacity-40">Quitar fechas</button>
            </span>
          </div>
          <table className="w-full text-sm rounded-lg border border-slate-800 overflow-hidden">
            <thead className="bg-slate-900/60 text-[10px] uppercase tracking-widest text-slate-500">
              <tr>
                <th className="text-left px-3 py-2">Archivo</th>
                <th className="text-left px-3 py-2">Nombre de la creatividad</th>
                <th className="text-left px-3 py-2">Tamaño</th>
                <th className="text-left px-3 py-2">Placements</th>
                <th className="text-left px-3 py-2">Inicio</th>
                <th className="text-left px-3 py-2">Fin</th>
              </tr>
            </thead>
            <tbody>
              {plan.creatives.map((c) => {
                const wrong = plan.issues.some((i) => i.code === 'creative_dates' && i.severity === 'error' && i.fileId === c.fileId);
                return (
                  <tr key={c.fileId} className={`border-t border-slate-800 ${wrong ? 'bg-rose-500/10' : ''}`}>
                    <td className="px-3 py-2 font-mono text-slate-300">{c.fileName}</td>
                    <td className="px-3 py-2 font-mono text-slate-100 break-all">{c.creativeName}</td>
                    <td className="px-3 py-2 font-mono text-slate-400">{c.size}</td>
                    <td className="px-3 py-2 text-slate-400">{c.placementIds.length}</td>
                    <td className="px-3 py-1.5">
                      <input type="date" disabled={!onDates} value={dates[c.fileId]?.start || ''} min={campaign?.startDate} max={campaign?.endDate}
                        onChange={(e) => setDate(c.fileId, 'start', e.target.value)} className={dateInput} />
                    </td>
                    <td className="px-3 py-1.5">
                      <input type="date" disabled={!onDates} value={dates[c.fileId]?.end || ''} min={dates[c.fileId]?.start || campaign?.startDate} max={campaign?.endDate}
                        onChange={(e) => setDate(c.fileId, 'end', e.target.value)} className={dateInput} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {plan.rows.length > 0 && (
        <table className="w-full text-sm rounded-lg border border-slate-800 overflow-hidden">
          <thead className="bg-slate-900/60 text-[10px] uppercase tracking-widest text-slate-500">
            <tr>
              <th className="text-left px-3 py-2">Placement</th>
              <th className="text-left px-3 py-2">Site</th>
              <th className="text-left px-3 py-2">Creatividades</th>
              <th className="text-left px-3 py-2">Ad estándar</th>
              <th className="text-left px-3 py-2">Default Ad</th>
              {hasLandings && <th className="text-left px-3 py-2">Landing (tracking)</th>}
            </tr>
          </thead>
          <tbody>
            {plan.rows.map((row) => (
              <tr key={row.placement.id} className="border-t border-slate-800">
                <td className="px-3 py-2 font-mono text-slate-200 break-all text-xs">{row.placement.name}</td>
                <td className="px-3 py-2 text-xs text-slate-400">{row.siteName || row.placement.siteId}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-400" title={row.fileIds.map((id) => fileName.get(id)).join('\n')}>
                  {row.fileIds.length === 0 ? '—' : row.fileIds.length === 1 ? creativeByFile.get(row.fileIds[0])?.fileName : `${row.fileIds.length} archivos`}
                </td>
                <RowActionCell action={row.standard.action} adNames={row.standard.adNames} />
                <RowActionCell action={row.default.action} adNames={row.default.adNames} />
                {hasLandings && (
                  <td className="px-3 py-2 text-xs max-w-[16rem]" title={row.landing?.url}>
                    {row.landing ? (
                      <>
                        <span className="font-semibold text-fuchsia-300">{row.landing.support}</span>
                        <span className="block text-slate-500 truncate">{row.landing.url}</span>
                      </>
                    ) : <span className="text-slate-600">—</span>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {plan.extraFiles.length > 0 && (
        <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-3 text-xs text-sky-200/70 space-y-0.5">
          <p className="text-[10px] uppercase font-bold tracking-widest text-sky-300/80">Sin placement en los sites elegidos — no se suben</p>
          {plan.extraFiles.map((f) => <p key={f.id} className="font-mono">{f.fileName}{f.size ? ` · ${f.size}` : ''}</p>)}
        </div>
      )}

      {(warnings.length > 0 || plan.uncovered.length > 0) && (
        <div className="rounded-lg border border-slate-800">
          <button
            onClick={() => setShowIssues((v) => !v)}
            className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-amber-300 hover:bg-slate-900/60"
          >
            <ChevronDown className={`w-4 h-4 transition-transform ${showIssues ? 'rotate-180' : ''}`} />
            {warnings.length + plan.uncovered.length} aviso{warnings.length + plan.uncovered.length === 1 ? '' : 's'}
          </button>
          {showIssues && (
            <div className="border-t border-slate-800 p-3 space-y-1">
              {warnings.map((issue, i) => (
                <p key={i} className="flex items-start gap-2 text-xs text-slate-300"><IssueIcon severity="warning" /> {issue.message}</p>
              ))}
              {plan.uncovered.map((p) => (
                <p key={p.id} className="flex items-start gap-2 text-xs text-slate-300">
                  <IssueIcon severity="warning" /> Ninguna creatividad de la carpeta encaja con {p.name}{p.size ? ` (${p.size})` : ''}.
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

interface CompleteExecutionPanelProps {
  plan: CompletePlan;
  campaignName: string;
  advertiserName: string;
  options: Pick<CompleteOptions, 'standardMode' | 'defaultMode'>;
  log?: CompleteExecutionLog;
  confirming: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}

const CompleteExecutionPanel: React.FC<CompleteExecutionPanelProps> = ({ plan, campaignName, advertiserName, options, log, confirming, onAsk, onCancel, onConfirm }) => {
  const running = !!log && !log.finished;
  const n = (isDefault: boolean, kind: 'create' | 'update' | 'landing') => plan.actions.filter((a) => a.isDefault === isDefault && a.kind === kind).length;
  const withLanding = plan.actions.filter((a) => a.clickUrl).length;

  if (!log) {
    if (plan.blocked || plan.actions.length === 0) return null;
    return (
      <div className="border-t border-slate-800 p-4">
        {!confirming ? (
          <button onClick={onAsk} className="inline-flex items-center gap-2 rounded-lg bg-teal-600 hover:bg-teal-500 px-4 py-2 text-sm font-bold text-white">
            <Rocket className="w-4 h-4" /> Completar en CM360…
          </button>
        ) : (
          <div className="rounded-xl border border-teal-500/40 bg-teal-500/10 p-4 space-y-3">
            <p className="text-sm font-bold text-slate-100">Vas a modificar CM360 ({advertiserName}) — campaña <span className="font-mono">{campaignName}</span>:</p>
            <ul className="text-sm text-slate-300 list-disc pl-5 space-y-1">
              {plan.creatives.length > 0 && <li>Subir <b>{plan.creatives.length}</b> creatividades y asociarlas a la campaña (las que ya existan con el mismo nombre se reutilizan).</li>}
              {n(false, 'create') > 0 && <li>Crear <b>{n(false, 'create')}</b> Ads estándar (uno por placement, con el nombre del placement).</li>}
              {n(false, 'update') > 0 && (
                <li>Actualizar <b>{n(false, 'update')}</b> Ads estándar: las creatividades {options.standardMode === 'replace' ? 'sustituyen a las actuales' : 'se añaden en rotación'}.</li>
              )}
              {n(false, 'landing') > 0 && <li>Cambiar solo la landing de <b>{n(false, 'landing')}</b> Ads existentes.</li>}
              {plan.creatives.some((c) => c.startDate || c.endDate) && (
                <li>
                  <b>{plan.creatives.filter((c) => c.startDate || c.endDate).length}</b> creatividades con fechas propias en sus Ads estándar
                  (los Default Ads no se programan).
                </li>
              )}
              {withLanding > 0 && <li>En <b>{withLanding}</b> Ads estándar, todas sus creatividades llevarán la <b>URL de clic del archivo de tracking</b>.</li>}
              {n(true, 'create') > 0 && <li>Crear <b>{n(true, 'create')}</b> Default Ads donde faltan.</li>}
              {n(true, 'update') > 0 && (
                <li>Poner como Default en <b>{n(true, 'update')}</b> Default Ads: {options.defaultMode === 'replace' ? 'sustituyen a las actuales' : 'se añaden en rotación'}.</li>
              )}
            </ul>
            <div className="flex gap-2">
              <button onClick={onConfirm} className="rounded-lg bg-teal-600 hover:bg-teal-500 px-4 py-2 text-sm font-bold text-white">Confirmar y ejecutar</button>
              <button onClick={onCancel} className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 hover:text-white">Cancelar</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  const count = (steps: { status: StepStatus }[], ...statuses: StepStatus[]) => steps.filter((s) => statuses.includes(s.status)).length;
  const cErrors = count(log.creatives, 'error');
  const aErrors = count(log.ads, 'error');
  return (
    <div className="border-t border-slate-800 p-4 space-y-3">
      <p className="text-sm font-bold text-slate-100 flex flex-wrap items-center gap-2">
        {running ? <Loader2 className="w-4 h-4 animate-spin text-blue-300" /> : <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
        {running ? 'Completando… no cierres esta pestaña.' : 'Terminado.'}
        <span className="font-normal text-xs text-slate-400">
          Creatividades: {count(log.creatives, 'done', 'reused')}/{log.creatives.length} ok
          {cErrors > 0 && <span className="text-rose-400"> · {cErrors} con error</span>}
          {' · '}Ads: {count(log.ads, 'done')}/{log.ads.length} ok
          {aErrors > 0 && <span className="text-rose-400"> · {aErrors} con error</span>}
        </span>
      </p>
      <div className="grid lg:grid-cols-2 gap-3">
        <div className="rounded-lg border border-slate-800 max-h-80 overflow-auto">
          <p className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-slate-500 font-bold border-b border-slate-800">Creatividades</p>
          {log.creatives.map((step) => (
            <div key={step.fileId} className="flex items-start gap-3 px-3 py-2 border-b border-slate-800 last:border-b-0 text-xs">
              <StepBadge status={step.status} />
              <div className="min-w-0">
                <p className="font-mono text-slate-200 break-all">{step.creativeName}</p>
                <p className="text-slate-500">{step.creativeId ? `ID ${step.creativeId}` : step.fileName}{step.message ? ` · ${step.message}` : ''}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="rounded-lg border border-slate-800 max-h-80 overflow-auto">
          <p className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-slate-500 font-bold border-b border-slate-800">Ads y Default Ads</p>
          {log.ads.map((step) => (
            <div key={step.key} className="flex items-start gap-3 px-3 py-2 border-b border-slate-800 last:border-b-0 text-xs">
              <StepBadge status={step.status} />
              <div className="min-w-0">
                <p className="text-slate-200 break-all">
                  <span className="text-slate-500">{step.isDefault ? 'Default · ' : ''}{step.kind === 'create' ? 'Crear · ' : step.kind === 'landing' ? 'Landing · ' : 'Actualizar · '}</span>
                  {step.adName}
                </p>
                <p className="text-slate-500">{step.adId ? `ID ${step.adId}` : ''}{step.message ? `${step.adId ? ' · ' : ''}${step.message}` : ''}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ─── Main component ────────────────────────────────────────────────────────────

const TrafficFromFolder: React.FC = () => {
  const { accessToken, profileId, selectedCampaign } = useApp();
  const [link, setLink] = useState(readLastLink);
  const [folder, setFolder] = useState<{ name: string; result: DriveFolderResult } | null>(null);
  const [campaignsByAdvertiser, setCampaignsByAdvertiser] = useState<Record<string, CampaignOption[]>>({});
  const [groupStates, setGroupStates] = useState<Record<string, GroupState>>({});

  // Global options (Mode A)
  const [trafficMode, setTrafficMode] = useState<'existing' | 'create' | 'complete'>('existing');
  const [includeDefaultAds, setIncludeDefaultAds] = useState(true);
  const [mode, setMode] = useState<'replace' | 'add'>('replace');

  // Mode B per-group state
  const [placementTexts, setPlacementTexts] = useState<Record<string, string>>({});
  const [siteFilters, setSiteFilters] = useState<Record<string, Set<string>>>({});
  const [createDefaultAdsB, setCreateDefaultAdsB] = useState<Record<string, boolean>>({});
  const [defaultAdModesB, setDefaultAdModesB] = useState<Record<string, 'replace' | 'add'>>({});

  // Mode C (complete Ads / Default Ads): global options as in Creatives → Batch Upload, sites and
  // "juego" per country.
  const [namingPrefix, setNamingPrefix] = useState('');
  const [namingSuffix, setNamingSuffix] = useState('');
  const [includeDateC, setIncludeDateC] = useState(true);
  const [setAsDefaultC, setSetAsDefaultC] = useState(true);
  const [createMissingDefaultC, setCreateMissingDefaultC] = useState(true);
  const [defaultModeC, setDefaultModeC] = useState<'replace' | 'add'>('replace');
  const [standardModeC, setStandardModeC] = useState<'replace' | 'add'>('add');
  const [siteSelectionsC, setSiteSelectionsC] = useState<Record<string, Set<string>>>({});
  const [defaultSetKeysC, setDefaultSetKeysC] = useState<Record<string, string>>({});
  const [creativeDatesC, setCreativeDatesC] = useState<Record<string, Record<string, CreativeDates>>>({});
  const [completeExecLogs, setCompleteExecLogs] = useState<Record<string, CompleteExecutionLog>>({});
  const [completeConfirmKey, setCompleteConfirmKey] = useState<string | null>(null);
  const [tracking, setTracking] = useState<{ fileName: string; sheet: TrackingSheet } | null>(null);
  const [trackingError, setTrackingError] = useState<string | null>(null);
  const [showTrackingSkipped, setShowTrackingSkipped] = useState(false);

  const loadTrackingFile = async (file?: File) => {
    if (!file) return;
    setTrackingError(null);
    try {
      const sheet = await readTrackingFile(file, new Set(MARKETS.map((m) => m.code)));
      if (sheet.rules.length === 0) throw new Error('No hay ninguna fila con soporte y URL de clic (por redirección).');
      setTracking({ fileName: file.name, sheet });
    } catch (e: any) {
      setTracking(null);
      setTrackingError(`No se pudo leer ${file.name}: ${e?.message || 'formato no reconocido'}`);
    }
  };

  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Mode A execution
  const [execLogs, setExecLogs] = useState<Record<string, ExecutionLog>>({});
  const [confirmKey, setConfirmKey] = useState<string | null>(null);

  // Mode B execution
  const [fullExecLogs, setFullExecLogs] = useState<Record<string, FullExecutionLog>>({});
  const [fullConfirmKey, setFullConfirmKey] = useState<string | null>(null);

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
    setFullExecLogs({});
    setCompleteExecLogs({});
    setSiteSelectionsC({});
    setDefaultSetKeysC({});
    setCreativeDatesC({});
    setConfirmKey(null);
    setFullConfirmKey(null);
    setCompleteConfirmKey(null);
    try {
      setProgress('Pidiendo acceso a Google Drive…');
      const token = await getDriveToken(getGoogleClientId());
      setProgress('Leyendo la carpeta…');
      const root = await getDriveFolder(token, folderId);
      const result = groupDriveFiles(root.name, await listDriveTree(token, folderId));
      try { localStorage.setItem(LAST_LINK_KEY, link.trim()); } catch { /* ignore */ }

      setProgress('Leyendo las campañas de cada país en CM360…');
      const advertiserIds = [...new Set(result.groups.map((g) => g.market?.advertiserId).filter((id): id is string => !!id))];
      const campaignLists: Record<string, CampaignOption[]> = {};
      for (const advertiserId of advertiserIds) {
        const campaigns = await listAll(
          'campaigns',
          'campaigns',
          new URLSearchParams({ advertiserIds: advertiserId, archived: 'false', maxResults: '1000' }),
        );
        campaignLists[advertiserId] = campaigns
          .map((c) => ({ id: String(c.id), name: String(c.name), startDate: c.startDate, endDate: c.endDate }))
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
    const advertiserId = group.market?.advertiserId;
    try {
      const params = () => new URLSearchParams({ campaignIds: campaignId, maxResults: '1000' });
      const [placements, ads, rawSites] = await Promise.all([
        listAll('placements', 'placements', params()),
        listAll('ads', 'ads', params()),
        advertiserId
          ? listAll('sites', 'sites', new URLSearchParams({ advertiserId, maxResults: '1000' }))
          : Promise.resolve([]),
      ]);
      setGroupStates((prev) => {
        if (prev[key]?.campaignId !== campaignId) return prev;
        return {
          ...prev,
          [key]: {
            campaignId,
            data: {
              placements: placements.map(toPlanPlacement),
              ads: ads.filter((ad) => TRAFFICKABLE_AD_TYPES.includes(ad.type)).map(toPlanAd),
              sites: rawSites.map((s: any) => ({ id: String(s.id), name: s.name || '' })),
            },
          },
        };
      });
    } catch (e: any) {
      setGroupState(key, { loading: false, error: e?.message || 'Error desconocido' });
    }
  };

  useEffect(() => {
    if (!folder || !selectedCampaign) return;
    const group = folder.result.groups.find((g) => g.market?.advertiserId === String(selectedCampaign.advertiserId));
    if (group && !groupStates[groupKey(group)]?.campaignId) chooseCampaign(group, selectedCampaign.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder]);

  // Mode A plans
  const plans = useMemo(() => {
    const out: Record<string, TrafficPlan> = {};
    if (!folder || trafficMode !== 'existing') return out;
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
  }, [folder, groupStates, campaignsByAdvertiser, includeDefaultAds, mode, trafficMode]);

  // Mode B plans
  const fullPlans = useMemo(() => {
    const out: Record<string, FullTrafficPlan> = {};
    if (!folder || trafficMode !== 'create') return out;
    const uploadDate = new Date();
    folder.result.groups.forEach((group) => {
      const key = groupKey(group);
      const state = groupStates[key];
      const advertiserId = group.market?.advertiserId;
      const campaign = advertiserId && campaignsByAdvertiser[advertiserId]?.find((c) => c.id === state?.campaignId);
      if (!state?.data || !campaign) return;
      const text = placementTexts[key] || '';
      if (!text.trim()) return;
      const parsedPlacements = parsePlacementNames(text, state.data.sites);
      out[key] = buildFullTrafficPlan(parsedPlacements, group.files, {
        campaignName: campaign.name,
        uploadDate,
        createDefaultAds: createDefaultAdsB[key] ?? true,
        defaultAdMode: defaultAdModesB[key] || 'replace',
        siteFilter: siteFilters[key] || new Set(),
      });
    });
    return out;
  }, [folder, groupStates, campaignsByAdvertiser, placementTexts, siteFilters, createDefaultAdsB, defaultAdModesB, trafficMode]);

  // Mode C plans
  const completePlans = useMemo(() => {
    const out: Record<string, CompletePlan> = {};
    if (!folder || trafficMode !== 'complete') return out;
    const uploadDate = new Date();
    folder.result.groups.forEach((group) => {
      const key = groupKey(group);
      const state = groupStates[key];
      const advertiserId = group.market?.advertiserId;
      const campaign = advertiserId && campaignsByAdvertiser[advertiserId]?.find((c) => c.id === state?.campaignId);
      if (!state?.data || !campaign) return;
      out[key] = buildCompletePlan({
        campaign,
        folderMarket: group.market,
        files: group.files,
        placements: state.data.placements,
        ads: state.data.ads,
        sites: state.data.sites,
        options: {
          prefix: namingPrefix,
          suffix: namingSuffix,
          includeDate: includeDateC,
          uploadDate,
          siteIds: siteSelectionsC[key],
          setAsDefault: setAsDefaultC,
          createMissingDefaultAds: setAsDefaultC && createMissingDefaultC,
          defaultMode: defaultModeC,
          standardMode: standardModeC,
          defaultSetKey: defaultSetKeysC[key],
          trackingRules: tracking?.sheet.rules,
          creativeDates: creativeDatesC[key],
        },
      });
    });
    return out;
  }, [folder, groupStates, campaignsByAdvertiser, trafficMode, namingPrefix, namingSuffix, includeDateC, siteSelectionsC,
    setAsDefaultC, createMissingDefaultC, defaultModeC, standardModeC, defaultSetKeysC, tracking, creativeDatesC]);

  const runCompleteExecution = async (group: CountryGroup, plan: CompletePlan) => {
    const key = groupKey(group);
    const campaignId = groupStates[key]?.campaignId;
    const advertiserId = group.market?.advertiserId;
    if (!group.market || !advertiserId || !campaignId || !accessToken || !profileId) return;
    setCompleteConfirmKey(null);
    setCompleteExecLogs((prev) => ({ ...prev, [key]: initialCompleteLog(plan) }));
    try {
      const driveToken = await getDriveToken(getGoogleClientId());
      await executeCompletePlan(
        {
          accessToken,
          profileId,
          driveToken,
          advertiserId,
          advertiserName: group.market.advertiserName,
          campaignId,
          campaignEndDate: campaignsByAdvertiser[advertiserId]?.find((c) => c.id === campaignId)?.endDate,
        },
        plan,
        (log) => setCompleteExecLogs((prev) => ({ ...prev, [key]: log })),
      );
    } catch (e: any) {
      setGroupState(key, { error: e?.message || 'Error desconocido' });
    }
  };

  const runExecution = async (group: CountryGroup, plan: TrafficPlan) => {
    const key = groupKey(group);
    const campaignId = groupStates[key]?.campaignId;
    if (!group.market || !campaignId || !accessToken || !profileId) return;
    setConfirmKey(null);
    try {
      const driveToken = await getDriveToken(getGoogleClientId());
      await executePlan(
        { accessToken, profileId, driveToken, advertiserId: group.market.advertiserId, advertiserName: group.market.advertiserName, campaignId },
        plan,
        (log) => setExecLogs((prev) => ({ ...prev, [key]: log })),
      );
    } catch (e: any) {
      setGroupState(key, { error: e?.message || 'Error desconocido' });
    }
  };

  const runFullExecution = async (group: CountryGroup, plan: FullTrafficPlan) => {
    const key = groupKey(group);
    const campaignId = groupStates[key]?.campaignId;
    const advertiserId = group.market?.advertiserId;
    if (!advertiserId || !campaignId || !accessToken || !profileId) return;
    setFullConfirmKey(null);

    const campaignEndDate = campaignsByAdvertiser[advertiserId]?.find((c) => c.id === campaignId)?.endDate;

    // Optimistically show pending log immediately so the UI updates.
    setFullExecLogs((prev) => ({ ...prev, [key]: initialFullLog(plan) }));

    try {
      const driveToken = await getDriveToken(getGoogleClientId());
      await executeFullPlan(
        {
          accessToken,
          profileId,
          driveToken,
          advertiserId,
          advertiserName: group.market!.advertiserName,
          campaignId,
          campaignEndDate,
        },
        plan,
        defaultAdModesB[key] || 'replace',
        (log) => setFullExecLogs((prev) => ({ ...prev, [key]: log })),
      );
    } catch (e: any) {
      setGroupState(key, { error: e?.message || 'Error desconocido' });
    }
  };

  const anyRunning =
    Object.values<ExecutionLog>(execLogs).some((log) => !log.finished) ||
    Object.values<FullExecutionLog>(fullExecLogs).some((log) => !log.finished) ||
    Object.values<CompleteExecutionLog>(completeExecLogs).some((log) => !log.finished);
  const switchMode = (next: 'existing' | 'create' | 'complete') => {
    setTrafficMode(next);
    setConfirmKey(null);
    setFullConfirmKey(null);
    setCompleteConfirmKey(null);
  };
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
        <div className="border-b border-slate-800 bg-slate-900/40">
          {/* ── Mode selector ── */}
          <div className="px-4 py-3 flex flex-wrap items-center gap-3">
            <span className="text-[10px] uppercase font-bold tracking-widest text-slate-500 shrink-0 mr-1">Modo de tráfico</span>
            <div className="flex rounded-xl border border-slate-700 overflow-hidden">
              <button
                onClick={() => switchMode('existing')}
                disabled={anyRunning}
                className={`flex items-center gap-2 px-5 py-2.5 text-sm font-semibold transition-all disabled:opacity-50 ${
                  trafficMode === 'existing'
                    ? 'bg-blue-600 text-white shadow-inner'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800'
                }`}
              >
                <Layers className="w-4 h-4" />
                Reutilizar placements existentes
              </button>
              <div className="w-px bg-slate-700 shrink-0" />
              <button
                onClick={() => switchMode('create')}
                disabled={anyRunning}
                className={`flex items-center gap-2 px-5 py-2.5 text-sm font-semibold transition-all disabled:opacity-50 ${
                  trafficMode === 'create'
                    ? 'bg-violet-600 text-white shadow-inner'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800'
                }`}
              >
                <Plus className="w-4 h-4" />
                Crear desde cero
              </button>
              <div className="w-px bg-slate-700 shrink-0" />
              <button
                onClick={() => switchMode('complete')}
                disabled={anyRunning}
                className={`flex items-center gap-2 px-5 py-2.5 text-sm font-semibold transition-all disabled:opacity-50 ${
                  trafficMode === 'complete'
                    ? 'bg-teal-600 text-white shadow-inner'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800'
                }`}
              >
                <ListPlus className="w-4 h-4" />
                Completar Ads y Default Ads
              </button>
            </div>
            {trafficMode === 'existing' && (
              <span className="text-xs text-slate-500 hidden lg:block">Asigna creatividades de Drive a placements y anuncios existentes en la campaña.</span>
            )}
            {trafficMode === 'create' && (
              <span className="text-xs text-slate-500 hidden lg:block">Crea placements nuevos, sube creatividades y genera Default Ads desde cero.</span>
            )}
            {trafficMode === 'complete' && (
              <span className="text-xs text-slate-500 hidden lg:block">Los placements ya existen: sube las creatividades y crea los Ads y Default Ads que falten (como Batch Upload).</span>
            )}
          </div>

          {/* ── Mode C sub-options (same as Creatives → Batch Upload) ── */}
          {trafficMode === 'complete' && (
            <div className="px-4 pb-3 pt-2.5 border-t border-slate-800/60 space-y-2.5 text-xs text-slate-400">
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Prefix</label>
                  <input
                    value={namingPrefix}
                    onChange={(e) => setNamingPrefix(e.target.value)}
                    disabled={anyRunning}
                    placeholder="Prefix text..."
                    className="w-56 bg-slate-950 border border-slate-700 rounded-lg py-1.5 px-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-teal-500 placeholder:text-slate-600"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Suffix</label>
                  <input
                    value={namingSuffix}
                    onChange={(e) => setNamingSuffix(e.target.value)}
                    disabled={anyRunning}
                    placeholder="Suffix text..."
                    className="w-56 bg-slate-950 border border-slate-700 rounded-lg py-1.5 px-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-teal-500 placeholder:text-slate-600"
                  />
                </div>
                <label className="flex items-center gap-1.5 cursor-pointer select-none pb-1.5">
                  <input type="checkbox" checked={includeDateC} onChange={(e) => setIncludeDateC(e.target.checked)} />
                  Añadir fecha
                </label>
                <p className="pb-1.5 text-slate-500">
                  Ejemplo: <span className="font-mono text-slate-300">
                    {buildPrefixedCreativeName('banner_300x250.zip', namingPrefix, namingSuffix, includeDateC ? formatDateToken(new Date()) : '')}
                  </span>
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-5">
                <span className="text-slate-500">Auto-match por tamaño</span>
                <div className="flex items-center gap-3">
                  <span>Ads estándar existentes:</span>
                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input type="radio" checked={standardModeC === 'add'} onChange={() => setStandardModeC('add')} /> se añaden en rotación
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input type="radio" checked={standardModeC === 'replace'} onChange={() => setStandardModeC('replace')} /> sustituyen a las actuales
                  </label>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-5">
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input type="checkbox" checked={setAsDefaultC} onChange={(e) => setSetAsDefaultC(e.target.checked)} />
                  Poner como Default
                </label>
                <label className={`flex items-center gap-1.5 cursor-pointer select-none ${setAsDefaultC ? '' : 'opacity-40'}`}>
                  <input
                    type="checkbox"
                    disabled={!setAsDefaultC}
                    checked={setAsDefaultC && createMissingDefaultC}
                    onChange={(e) => setCreateMissingDefaultC(e.target.checked)}
                  />
                  Crear Default Ads donde falten
                </label>
                <div className={`flex items-center gap-3 ${setAsDefaultC ? '' : 'opacity-40'}`}>
                  <span>Default Ads:</span>
                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input type="radio" disabled={!setAsDefaultC} checked={defaultModeC === 'replace'} onChange={() => setDefaultModeC('replace')} /> sustituyen a las actuales
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input type="radio" disabled={!setAsDefaultC} checked={defaultModeC === 'add'} onChange={() => setDefaultModeC('add')} /> se añaden en rotación
                  </label>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <span className="flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-widest text-slate-500">
                  <Link2 className="w-3.5 h-3.5" /> Landings
                </span>
                <label className={`inline-flex items-center gap-2 rounded-lg border border-fuchsia-500/40 bg-fuchsia-500/10 hover:bg-fuchsia-500/20 px-3 py-1.5 text-xs font-semibold text-fuchsia-200 ${anyRunning ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}>
                  <FileSpreadsheet className="w-4 h-4" />
                  {tracking ? 'Cambiar archivo de tracking' : 'Subir archivo de tracking (.xlsx)'}
                  <input
                    type="file"
                    accept=".xlsx,.csv"
                    className="hidden"
                    onChange={(e) => { loadTrackingFile(e.target.files?.[0]); e.target.value = ''; }}
                  />
                </label>
                {tracking && (
                  <>
                    <span className="text-slate-300">
                      <span className="font-mono">{tracking.fileName}</span>
                      {tracking.sheet.sheetName && <span className="text-slate-500"> (hoja «{tracking.sheet.sheetName}»)</span>}
                      {' · '}{tracking.sheet.rules.length} URL{tracking.sheet.rules.length === 1 ? '' : 's'}
                      {' · '}soportes: {[...new Set(tracking.sheet.rules.map((r) => r.support))].join(', ')}
                      {' · '}países: {[...new Set(tracking.sheet.rules.map((r) => r.country).filter(Boolean))].join(', ')}
                    </span>
                    {tracking.sheet.skipped.length > 0 && (
                      <button onClick={() => setShowTrackingSkipped((v) => !v)} className="text-amber-300 hover:underline">
                        {tracking.sheet.skipped.length} fila{tracking.sheet.skipped.length === 1 ? '' : 's'} con avisos
                      </button>
                    )}
                    <button onClick={() => setTracking(null)} disabled={anyRunning} title="Quitar archivo" className="text-slate-500 hover:text-slate-200">
                      <X className="w-4 h-4" />
                    </button>
                  </>
                )}
                {!tracking && !trackingError && (
                  <span className="text-slate-500">Opcional: la «URL de clic (por redirección)» de cada soporte y país pasa a ser la landing de sus Ads.</span>
                )}
                {trackingError && <span className="text-rose-300">{trackingError}</span>}
              </div>
              {tracking && showTrackingSkipped && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 space-y-0.5">
                  {tracking.sheet.skipped.map((sk) => <p key={sk.row} className="text-amber-200/80">{sk.reason}</p>)}
                </div>
              )}
            </div>
          )}

          {/* ── Mode A sub-options ── */}
          {trafficMode === 'existing' && (
            <div className="px-4 pb-3 flex flex-wrap items-center gap-5 text-xs text-slate-400 border-t border-slate-800/60 pt-2.5">
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input type="checkbox" checked={includeDefaultAds} onChange={(e) => setIncludeDefaultAds(e.target.checked)} />
                Incluir Default Ads
              </label>
              <div className="flex items-center gap-3">
                <span>Creatividades nuevas:</span>
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} /> sustituyen a las actuales
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input type="radio" checked={mode === 'add'} onChange={() => setMode('add')} /> se añaden en rotación
                </label>
              </div>
            </div>
          )}
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
            qué placements y anuncios.
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
                const planA = plans[key];
                const planB = fullPlans[key];
                const planC = completePlans[key];
                const campaignOptions = group.market ? campaignsByAdvertiser[group.market.advertiserId] || [] : [];

                // Mode B local state helpers
                const placementText = placementTexts[key] || '';
                const doDefaultAdsB = createDefaultAdsB[key] ?? true;
                const defaultAdModeB = defaultAdModesB[key] || 'replace';
                const siteFilter = siteFilters[key] || new Set<string>();

                // Unique site tokens detected from parsed placements for the site filter UI
                const detectedSiteTokens = planB
                  ? [...new Set(planB.placements.map((p) => p.siteToken).filter(Boolean))]
                  : [];

                return (
                  <section key={key} className={`rounded-xl border overflow-hidden ${(planA || planB || planC) ? 'border-emerald-500/40' : 'border-slate-800'}`}>
                    {/* Group header */}
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
                            disabled={!!(execLogs[key] || fullExecLogs[key] || completeExecLogs[key])}
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

                    {/* Mode A content */}
                    {trafficMode === 'existing' && (
                      <>
                        {planA ? <PlanView plan={planA} files={group.files} /> : <FileTable files={group.files} />}
                        {planA && group.market && (
                          <ExecutionPanel
                            plan={planA}
                            campaignName={campaignOptions.find((c) => c.id === state?.campaignId)?.name || ''}
                            advertiserName={group.market.advertiserName}
                            mode={mode}
                            includeDefaultAds={includeDefaultAds}
                            log={execLogs[key]}
                            confirming={confirmKey === key}
                            onAsk={() => setConfirmKey(key)}
                            onCancel={() => setConfirmKey(null)}
                            onConfirm={() => runExecution(group, planA)}
                          />
                        )}
                      </>
                    )}

                    {/* Mode C content */}
                    {trafficMode === 'complete' && !state?.data && <FileTable files={group.files} />}
                    {trafficMode === 'complete' && state?.data && (() => {
                      // No entry = every site (also ones added later); a Set = exactly those, possibly none.
                      const siteSelection = siteSelectionsC[key];
                      const siteNames = new Map<string, string>(state.data.sites.map((s) => [s.id, s.name]));
                      const campaignSiteIds = [...new Set<string>(state.data.placements.filter((p) => p.active).map((p) => p.siteId))]
                        .sort((a, b) => (siteNames.get(a) || a).localeCompare(siteNames.get(b) || b));
                      const toggleSite = (siteId: string, checked: boolean) =>
                        setSiteSelectionsC((prev) => {
                          const next = new Set(prev[key] ?? campaignSiteIds);
                          if (checked) next.add(siteId); else next.delete(siteId);
                          const { [key]: _current, ...rest } = prev;
                          return campaignSiteIds.every((id) => next.has(id)) ? rest : { ...rest, [key]: next };
                        });
                      return (
                        <>
                          {!completeExecLogs[key] && (
                            <div className="border-t border-slate-800 px-4 py-3 space-y-2.5">
                              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                                <span className="text-[10px] uppercase font-bold tracking-widest text-slate-500">Sites</span>
                                {campaignSiteIds.length === 0 && <span className="text-xs text-amber-400">La campaña no tiene placements activos.</span>}
                                {campaignSiteIds.map((siteId) => (
                                  <label key={siteId} className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer select-none">
                                    <input
                                      type="checkbox"
                                      checked={!siteSelection || siteSelection.has(siteId)}
                                      onChange={(e) => toggleSite(siteId, e.target.checked)}
                                    />
                                    {siteNames.get(siteId) || `Site ${siteId}`}
                                  </label>
                                ))}
                                {siteSelection?.size === 0 && campaignSiteIds.length > 0 && (
                                  <span className="text-xs text-amber-400">Elige al menos un site para traficar.</span>
                                )}
                              </div>
                              {planC && setAsDefaultC && planC.needsSetChoice && planC.sets.length > 1 && (
                                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                                  <span className="text-[10px] uppercase font-bold tracking-widest text-slate-500">Juego para el Default</span>
                                  <select
                                    value={defaultSetKeysC[key] || planC.sets[0].key}
                                    onChange={(e) => setDefaultSetKeysC((prev) => ({ ...prev, [key]: e.target.value }))}
                                    className="max-w-full bg-slate-950 border border-slate-700 rounded-lg py-1 px-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-teal-500"
                                  >
                                    {planC.sets.map((s) => (
                                      <option key={s.key} value={s.key}>{s.key} ({s.sizes.join(', ')})</option>
                                    ))}
                                  </select>
                                  <span className="text-slate-500">Hay varios archivos del mismo tamaño: los Ads estándar los rotan todos, el Default lleva los de este juego.</span>
                                </div>
                              )}
                            </div>
                          )}
                          {planC && (
                            <CompletePlanView
                              plan={planC}
                              files={group.files}
                              campaign={campaignOptions.find((c) => c.id === state?.campaignId)}
                              dates={creativeDatesC[key] || {}}
                              onDates={completeExecLogs[key] ? undefined : (next) => setCreativeDatesC((prev) => ({ ...prev, [key]: next }))}
                            />
                          )}
                          {group.market && (planC || completeExecLogs[key]) && (
                            <CompleteExecutionPanel
                              plan={planC || { creatives: [], actions: [], rows: [], extraFiles: [], uncovered: [], sets: [], needsSetChoice: false, issues: [], blocked: true }}
                              campaignName={campaignOptions.find((c) => c.id === state?.campaignId)?.name || ''}
                              advertiserName={group.market.advertiserName}
                              options={{ standardMode: standardModeC, defaultMode: defaultModeC }}
                              log={completeExecLogs[key]}
                              confirming={completeConfirmKey === key}
                              onAsk={() => setCompleteConfirmKey(key)}
                              onCancel={() => setCompleteConfirmKey(null)}
                              onConfirm={() => planC && runCompleteExecution(group, planC)}
                            />
                          )}
                        </>
                      );
                    })()}

                    {/* Mode B content */}
                    {trafficMode === 'create' && state?.data && !fullExecLogs[key] && (
                      <div className="border-t border-slate-800 p-4 space-y-4">
                        {/* Textarea for placement names */}
                        <div>
                          <label className="flex items-center gap-1.5 text-[10px] uppercase font-bold text-slate-500 mb-1.5">
                            <FileText className="w-3.5 h-3.5" />
                            Nombres de placements a crear (uno por línea)
                          </label>
                          <textarea
                            value={placementText}
                            onChange={(e) => setPlacementTexts((prev) => ({ ...prev, [key]: e.target.value }))}
                            placeholder={`ae-es_kpi360_quantcast_2026_dis_prs_gen_desktop_300x250\nae-es_kpi360_quantcast_2026_dis_prs_gen_desktop_728x90\n…`}
                            rows={6}
                            className="w-full bg-slate-950 border border-slate-700 rounded-lg py-2 px-3 text-xs font-mono text-slate-200 focus:outline-none focus:border-blue-500 placeholder:text-slate-600 resize-y"
                          />
                          {planB && (
                            <p className="mt-1 text-xs text-slate-500">
                              {planB.placements.length} placement{planB.placements.length !== 1 ? 's' : ''} detectado{planB.placements.length !== 1 ? 's' : ''}.
                              {planB.placements.some((p) => p.siteUnknown) && (
                                <span className="ml-1 text-rose-400">
                                  {planB.placements.filter((p) => p.siteUnknown).length} sin site reconocido.
                                </span>
                              )}
                            </p>
                          )}
                        </div>

                        {/* Default Ads options */}
                        {planB && planB.placements.length > 0 && (
                          <div className="space-y-2">
                            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={doDefaultAdsB}
                                onChange={(e) => setCreateDefaultAdsB((prev) => ({ ...prev, [key]: e.target.checked }))}
                              />
                              Crear Default Ads
                            </label>

                            {doDefaultAdsB && (
                              <>
                                {/* Site filter */}
                                {detectedSiteTokens.length > 1 && (
                                  <div className="pl-5 space-y-1">
                                    <p className="text-[10px] uppercase text-slate-500 font-bold tracking-wide">
                                      Crear Default Ad solo para los sites:
                                    </p>
                                    <div className="flex flex-wrap gap-3">
                                      {detectedSiteTokens.map((token) => (
                                        <label key={token} className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                                          <input
                                            type="checkbox"
                                            checked={siteFilter.size === 0 || siteFilter.has(token)}
                                            onChange={(e) => {
                                              setSiteFilters((prev) => {
                                                const current = prev[key] || new Set(detectedSiteTokens);
                                                const next = new Set(current);
                                                if (e.target.checked) next.add(token); else next.delete(token);
                                                // If all are checked, store empty set (means "all")
                                                const allChecked = detectedSiteTokens.every((t) => next.has(t));
                                                return { ...prev, [key]: allChecked ? new Set() : next };
                                              });
                                            }}
                                          />
                                          {token}
                                        </label>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Replace / add mode */}
                                <div className="pl-5 flex items-center gap-3 text-xs text-slate-400">
                                  <span>Las creatividades del Default Ad:</span>
                                  <label className="flex items-center gap-1.5">
                                    <input
                                      type="radio"
                                      checked={defaultAdModeB === 'replace'}
                                      onChange={() => setDefaultAdModesB((prev) => ({ ...prev, [key]: 'replace' }))}
                                    />
                                    sustituyen a las actuales
                                  </label>
                                  <label className="flex items-center gap-1.5">
                                    <input
                                      type="radio"
                                      checked={defaultAdModeB === 'add'}
                                      onChange={() => setDefaultAdModesB((prev) => ({ ...prev, [key]: 'add' }))}
                                    />
                                    se añaden en rotación
                                  </label>
                                </div>
                              </>
                            )}
                          </div>
                        )}

                        {/* Full plan preview */}
                        {planB && planB.placements.length > 0 && (
                          <FullPlanView plan={planB} />
                        )}
                      </div>
                    )}

                    {/* Mode B file table when no text pasted yet */}
                    {trafficMode === 'create' && state?.data && !placementText.trim() && !fullExecLogs[key] && (
                      <FileTable files={group.files} />
                    )}

                    {/* Mode B execute */}
                    {trafficMode === 'create' && planB && group.market && (
                      <FullExecutionPanel
                        plan={planB}
                        campaignName={campaignOptions.find((c) => c.id === state?.campaignId)?.name || ''}
                        advertiserName={group.market.advertiserName}
                        defaultAdMode={defaultAdModeB}
                        log={fullExecLogs[key]}
                        confirming={fullConfirmKey === key}
                        onAsk={() => setFullConfirmKey(key)}
                        onCancel={() => setFullConfirmKey(null)}
                        onConfirm={() => runFullExecution(group, planB)}
                      />
                    )}

                    {/* Mode B: show log even without plan (execution already started) */}
                    {trafficMode === 'create' && fullExecLogs[key] && !planB && group.market && (
                      <FullExecutionPanel
                        plan={{ placements: [], creatives: [], defaultAds: [], extraFiles: [] }}
                        campaignName=""
                        advertiserName={group.market.advertiserName}
                        defaultAdMode={defaultAdModeB}
                        log={fullExecLogs[key]}
                        confirming={false}
                        onAsk={() => {}}
                        onCancel={() => {}}
                        onConfirm={() => {}}
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
