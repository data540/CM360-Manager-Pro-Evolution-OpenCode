import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, FileText, FolderOpen, Loader2, Rocket, XCircle } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { getGoogleClientId } from '../constants';
import type { DetectedFile } from '../services/creativeDetection';
import { getDriveFolder, getDriveToken, listDriveTree } from '../services/drive';
import { CountryGroup, DriveFolderResult, groupDriveFiles, parseDriveFolderId } from '../services/driveFolders';
import { buildTrafficPlan, PlanAd, PlanPlacement, TrafficPlan } from '../services/trafficPlan';
import { executePlan, ExecutionLog, StepStatus } from '../services/trafficExecutor';
import { buildFullTrafficPlan, FullPlannedCreative, FullTrafficPlan, parsePlacementNames } from '../services/trafficPlanFull';
import { executeFullPlan, FullExecutionLog, initialFullLog } from '../services/trafficExecutorFull';

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

interface CampaignOption { id: string; name: string; endDate?: string }

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

// ─── Main component ────────────────────────────────────────────────────────────

const TrafficFromFolder: React.FC = () => {
  const { accessToken, profileId, selectedCampaign } = useApp();
  const [link, setLink] = useState(readLastLink);
  const [folder, setFolder] = useState<{ name: string; result: DriveFolderResult } | null>(null);
  const [campaignsByAdvertiser, setCampaignsByAdvertiser] = useState<Record<string, CampaignOption[]>>({});
  const [groupStates, setGroupStates] = useState<Record<string, GroupState>>({});

  // Global options (Mode A)
  const [trafficMode, setTrafficMode] = useState<'existing' | 'create'>('existing');
  const [includeDefaultAds, setIncludeDefaultAds] = useState(true);
  const [mode, setMode] = useState<'replace' | 'add'>('replace');

  // Mode B per-group state
  const [placementTexts, setPlacementTexts] = useState<Record<string, string>>({});
  const [siteFilters, setSiteFilters] = useState<Record<string, Set<string>>>({});
  const [createDefaultAdsB, setCreateDefaultAdsB] = useState<Record<string, boolean>>({});
  const [defaultAdModesB, setDefaultAdModesB] = useState<Record<string, 'replace' | 'add'>>({});

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
    setConfirmKey(null);
    setFullConfirmKey(null);
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
          .map((c) => ({ id: String(c.id), name: String(c.name), endDate: c.endDate }))
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
    Object.values<FullExecutionLog>(fullExecLogs).some((log) => !log.finished);
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
          {/* Mode toggle */}
          <div className="flex items-center gap-3 border-r border-slate-700 pr-5">
            <span className="text-slate-500 font-bold uppercase tracking-wider text-[10px]">Modo:</span>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                checked={trafficMode === 'existing'}
                disabled={anyRunning}
                onChange={() => { setTrafficMode('existing'); setConfirmKey(null); setFullConfirmKey(null); }}
              />
              Reutilizar placements existentes
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                checked={trafficMode === 'create'}
                disabled={anyRunning}
                onChange={() => { setTrafficMode('create'); setConfirmKey(null); setFullConfirmKey(null); }}
              />
              Crear desde cero
            </label>
          </div>

          {/* Mode A options */}
          {trafficMode === 'existing' && (
            <>
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
            </>
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
                  <section key={key} className={`rounded-xl border overflow-hidden ${(planA || planB) ? 'border-emerald-500/40' : 'border-slate-800'}`}>
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
                            disabled={!!(execLogs[key] || fullExecLogs[key])}
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
