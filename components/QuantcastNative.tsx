import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileUp, FolderOpen, Image as ImageIcon, Loader2, LogIn, PencilLine, Play, Search, Square, XCircle } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { getGoogleClientId } from '../constants';
import { getDriveFolder, getDriveToken, listDriveTree } from '../services/drive';
import { isJunkEntry, parseDriveFolderId } from '../services/driveFolders';
import { detectMarketFromFolder } from '../services/markets';
import { listAdSetsWithCreatives, listCampaigns, QcCampaignSummary, QcCampaignWithAdSets } from '../services/quantcast';
import {
  buildAssignments,
  campaignRoot,
  CHANGE_LABELS,
  creativeBelongsToPlacement,
  creativeNamesFor,
  diffNative,
  NativeChanges,
  NativeDiff,
  NativeUpdateJob,
  DriveImage,
  imageIssues,
  LanguageChoice,
  languageForMarket,
  LIMITS,
  matchAdSet,
  matchCampaign,
  NativeCreativeJob,
  NativeRow,
  NativeRunRequest,
  parseNativeSheet,
  placementStrategy,
  QC_LANGUAGES,
  QcLanguage,
  resolveLanguage,
  RunState,
  yearMismatch,
} from '../services/quantcastNative';
import { parseCsv, parseXlsx } from '../services/trafficSheet';

const ACCOUNT_KEY = 'qc_native_account';
const DEFAULT_ACCOUNT = '9964009';

interface RunnerStatus {
  available: boolean;
  session: boolean;
  loginInProgress: boolean;
  run: RunState | null;
}

interface RowOverride {
  include?: boolean;
  language?: QcLanguage;
  campaignId?: string;
  adSetId?: string;
}

interface UpdateRow {
  plan: PlanRow;
  targets: { creativeId: string; name: string; diff: NativeDiff }[];
  problem?: string;
}

interface PlanRow {
  row: NativeRow;
  language?: QcLanguage;
  languageGuessed: boolean;
  languageSource?: LanguageChoice['source'];
  languageNote?: string;
  campaign?: QcCampaignSummary;
  campaignCandidates: QcCampaignSummary[];
  adSet?: QcCampaignWithAdSets['adsets'][number];
  adSetCandidates: QcCampaignWithAdSets['adsets'];
  campaignAuto: boolean;
  adSetAuto: boolean;
  yearNote?: string;
  existing: string[];
  creativeNames: string[];
  blockers: string[];
  alreadyAssigned: boolean;
  include: boolean;
}

const readGrid = async (file: File): Promise<string[][]> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (/\.xlsx$/i.test(file.name)) return parseXlsx(bytes);
  let text = new TextDecoder('utf-8').decode(bytes);
  if (text.includes('�')) text = new TextDecoder('windows-1252').decode(bytes);
  return parseCsv(text);
};

const api = async (path: string, body?: unknown) => {
  const res = await fetch(`/api/qc-native/${path}`, body === undefined
    ? undefined
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Error ${res.status}`);
  return data;
};

const StepIcon: React.FC<{ status: string }> = ({ status }) => {
  if (status === 'running') return <Loader2 className="w-4 h-4 animate-spin text-blue-400" />;
  if (status === 'done') return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
  if (status === 'error') return <XCircle className="w-4 h-4 text-rose-400" />;
  if (status === 'skipped') return <AlertTriangle className="w-4 h-4 text-amber-400" />;
  return <span className="w-4 h-4 rounded-full border border-slate-600 inline-block" />;
};

const QuantcastNative: React.FC = () => {
  const { accessToken } = useApp();
  const [accountId, setAccountId] = useState(() => {
    try { return localStorage.getItem(ACCOUNT_KEY) || DEFAULT_ACCOUNT; } catch { return DEFAULT_ACCOUNT; }
  });
  const [advertiser, setAdvertiser] = useState('Air Europa');
  const [replace, setReplace] = useState(true);
  const [sheet, setSheet] = useState<{ fileName: string; rows: NativeRow[]; errors: string[] } | null>(null);
  const [driveLink, setDriveLink] = useState('');
  const [images, setImages] = useState<(DriveImage & { issues: string[]; enabled: boolean })[] | null>(null);
  const [folderMarket, setFolderMarket] = useState<string | undefined>();
  const [qcCampaigns, setQcCampaigns] = useState<QcCampaignSummary[] | null>(null);
  const [qcDetails, setQcDetails] = useState<Record<string, QcCampaignWithAdSets>>({});
  const [overrides, setOverrides] = useState<Record<number, RowOverride>>({});
  const [mode, setMode] = useState<'upload' | 'update'>('upload');
  const [updateSkip, setUpdateSkip] = useState<Set<string>>(new Set());
  const [runner, setRunner] = useState<RunnerStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      setRunner(await api('status'));
    } catch {
      setRunner({ available: false, session: false, loginInProgress: false, run: null });
    }
  }, []);

  useEffect(() => { void refreshStatus(); }, [refreshStatus]);

  const running = runner?.run?.status === 'running';
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => void refreshStatus(), 1500);
    return () => window.clearInterval(timer);
  }, [running, refreshStatus]);

  const withBusy = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(null);
    }
  };

  const loadSheet = (file: File) => withBusy('Leyendo el archivo…', async () => {
    const parsed = parseNativeSheet(await readGrid(file));
    setSheet({ fileName: file.name, ...parsed });
    setOverrides({});
  });

  const loadImages = () => withBusy('Leyendo la carpeta de Drive…', async () => {
    const folderId = parseDriveFolderId(driveLink);
    if (!folderId) throw new Error('No reconozco el enlace: pega el enlace de una carpeta de Google Drive.');
    const token = await getDriveToken(getGoogleClientId());
    const root = await getDriveFolder(token, folderId);
    const entries = (await listDriveTree(token, folderId))
      .filter((e) => e.mimeType.startsWith('image/') && !isJunkEntry(e))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (entries.length === 0) throw new Error('La carpeta no tiene imágenes.');
    const folderNames = [root.name, ...entries.flatMap((e) => e.path)];
    setFolderMarket(folderNames.map(detectMarketFromFolder).find(Boolean)?.code);
    setImages(entries.map((e) => {
      const image: DriveImage = { id: e.id, name: e.name, mimeType: e.mimeType, bytes: e.bytes, width: e.image?.width, height: e.image?.height };
      const issues = imageIssues(image);
      return { ...image, issues, enabled: issues.length === 0 };
    }));
  });

  const ensureDetails = useCallback(async (ids: string[]) => {
    const missing = ids.filter((id) => !qcDetails[id]);
    if (!missing.length || !accessToken) return;
    const { campaigns } = await listAdSetsWithCreatives(accessToken, missing);
    setQcDetails((prev) => ({ ...prev, ...Object.fromEntries(campaigns.map((c) => [c.id, c])) }));
  }, [accessToken, qcDetails]);

  const loadQuantcast = () => withBusy('Buscando campañas y ad sets en Quantcast…', async () => {
    if (!accessToken) throw new Error('Inicia sesión en la app con Google para consultar Quantcast.');
    if (!sheet) return;
    try { localStorage.setItem(ACCOUNT_KEY, accountId); } catch { /* ignore */ }
    const campaigns = await listCampaigns(accessToken, accountId);
    setQcCampaigns(campaigns);
    const ids = new Set<string>();
    sheet.rows.forEach((r) => matchCampaign(r.placementName, campaigns).candidates.slice(0, 3).forEach((c) => ids.add(c.id)));
    const { campaigns: details } = await listAdSetsWithCreatives(accessToken, [...ids]);
    setQcDetails(Object.fromEntries(details.map((c) => [c.id, c])));
  });

  const enabledImages = useMemo(() => (images || []).filter((i) => i.enabled), [images]);

  const plan: PlanRow[] = useMemo(() => (sheet?.rows || []).map((row) => {
    const o = overrides[row.rowNumber] || {};
    const choice = resolveLanguage(`${row.title} ${row.description}`, folderMarket, row.placementName);
    const language = o.language || choice.language;
    const campaignMatch = qcCampaigns ? matchCampaign(row.placementName, qcCampaigns) : { candidates: [] as QcCampaignSummary[] };
    const campaignId = o.campaignId ?? campaignMatch.match?.id;
    const campaign = qcCampaigns?.find((c) => c.id === campaignId);
    const detail = campaignId ? qcDetails[campaignId] : undefined;
    const adSetMatch = detail ? matchAdSet(row.placementName, detail.adsets) : { candidates: [] as QcCampaignWithAdSets['adsets'] };
    const adSetId = o.adSetId ?? adSetMatch.match?.id;
    const adSet = detail?.adsets.find((a) => a.id === adSetId);
    // Quantcast keeps removed assignments with state DELETED; only the live ones count (same rule as the audit).
    const existing = (adSet?.creativeAssignments || [])
      .filter((a) => !['CREATIVE_ASSIGNMENT_STATE_DELETED', 'CREATIVE_ASSIGNMENT_STATE_UNSPECIFIED'].includes(a.state))
      .map((a) => a.creative?.name || a.creativeId);
    const creativeNames = creativeNamesFor(row.placementName, enabledImages.length);
    const alreadyAssigned = creativeNames.some((n) => existing.includes(n));

    const blockers = [...row.errors];
    if (!campaignRoot(row.placementName)) blockers.push('El nombre no lleva _prs_ ni _rtg_: no se puede sacar la campaña.');
    if (!language) blockers.push('Elige el idioma.');
    if (mode === 'upload' && enabledImages.length === 0) blockers.push('Sin imágenes válidas.');
    if (qcCampaigns && !campaign) blockers.push('Elige la campaña de Quantcast.');
    if (campaign && detail && !adSet) blockers.push('Elige el ad set.');
    if (!qcCampaigns) blockers.push('Falta buscar en Quantcast.');
    return {
      row,
      language,
      languageGuessed: !o.language && (!choice.language || !!choice.note),
      languageSource: o.language ? undefined : choice.source,
      languageNote: o.language ? undefined : choice.note,
      campaign,
      campaignCandidates: campaignMatch.candidates.length ? campaignMatch.candidates : qcCampaigns || [],
      adSet,
      adSetCandidates: adSetMatch.candidates.length ? adSetMatch.candidates : detail?.adsets || [],
      campaignAuto: !!campaign && !o.campaignId,
      adSetAuto: !!adSet && !o.adSetId,
      yearNote: campaign ? yearMismatch(row.placementName, campaign.name) : undefined,
      existing,
      creativeNames,
      blockers,
      alreadyAssigned,
      include: blockers.length === 0 && (o.include ?? !alreadyAssigned),
    };
  }), [sheet, overrides, qcCampaigns, qcDetails, enabledImages, folderMarket, mode]);

  const selected = plan.filter((p) => p.include);

  // Update mode: the creatives of each placement that are live in its ad set, compared with the file.
  const updatePlan: UpdateRow[] = useMemo(() => {
    if (mode !== 'update' || !qcCampaigns) return [];
    return plan.map((p) => {
      const targets = (p.adSet?.creativeAssignments || [])
        .filter((a) => !['CREATIVE_ASSIGNMENT_STATE_DELETED', 'CREATIVE_ASSIGNMENT_STATE_UNSPECIFIED'].includes(a.state))
        .filter((a) => a.creative && creativeBelongsToPlacement(a.creative.name, p.row.placementName))
        .map((a) => ({
          creativeId: a.creative!.id,
          name: a.creative!.name,
          diff: diffNative({
            title: p.row.title,
            description: p.row.description,
            advertiser: advertiser.trim(),
            landingUrl: p.row.landingUrl,
            impressionPixel: p.row.impressionPixel,
            language: p.language,
          }, { language: a.creative!.language, native: a.creative!.native }),
        }));
      const problem = p.row.errors.length ? p.row.errors.join(' ')
        : !p.adSet ? (p.blockers.find((b) => /campaña|ad set|_prs_/.test(b)) || 'Sin ad set.')
        : targets.length === 0 ? 'Ninguna creatividad de este placement está asociada al ad set.' : undefined;
      return { plan: p, targets, problem };
    });
  }, [mode, qcCampaigns, plan, advertiser]);

  const selectedUpdates: NativeUpdateJob[] = updatePlan.flatMap((u) => u.targets
    .filter((t) => Object.keys(t.diff.changes).length > 0 && !updateSkip.has(t.creativeId))
    .map((t) => ({ creativeId: t.creativeId, name: t.name, changes: t.diff.changes })));

  const setOverride = (rowNumber: number, patch: RowOverride) =>
    setOverrides((prev) => ({ ...prev, [rowNumber]: { ...prev[rowNumber], ...patch } }));

  const login = () => withBusy('Se ha abierto Chrome: inicia sesión en Quantcast y espera a que cargue la lista de campañas…', async () => {
    await api('login', { accountId });
    await refreshStatus();
  });

  const run = (dryRun: boolean) => withBusy(dryRun ? 'Lanzando la prueba…' : 'Lanzando la subida…', async () => {
    if (!selected.length) return;
    const creatives: NativeCreativeJob[] = selected.flatMap((p) => p.creativeNames.map((name, i) => ({
      name,
      title: p.row.title,
      description: p.row.description,
      advertiser: advertiser.trim(),
      landingUrl: p.row.landingUrl,
      impressionPixel: p.row.impressionPixel,
      language: p.language!,
      image: { fileId: enabledImages[i].id, fileName: enabledImages[i].name },
    })));
    const assignments = buildAssignments(
      selected.map((p) => ({ creativeNames: p.creativeNames, campaignName: p.campaign!.name, adSetName: p.adSet!.name })),
      replace,
    );
    if (!dryRun) {
      const ok = window.confirm(
        `Se van a crear ${creatives.length} creatividad(es) nativas en Quantcast y a editar ${assignments.length} ad set(s)` +
        `${replace ? ', SUSTITUYENDO las creatividades que tengan ahora' : ', añadiéndolas a las actuales'}. ¿Continuar?`,
      );
      if (!ok) return;
    }
    const driveToken = await getDriveToken(getGoogleClientId());
    const request: NativeRunRequest = { accountId, driveToken, dryRun, creatives, assignments };
    await api('run', request);
    await refreshStatus();
  });

  const runUpdates = (dryRun: boolean) => withBusy(dryRun ? 'Lanzando la prueba…' : 'Lanzando la actualización…', async () => {
    if (!selectedUpdates.length) return;
    if (!dryRun) {
      const fields = selectedUpdates.reduce((n, u) => n + Object.keys(u.changes).length, 0);
      if (!window.confirm(`Se van a editar ${selectedUpdates.length} creatividad(es) en Quantcast (${fields} campo(s) en total). ¿Continuar?`)) return;
    }
    const request: NativeRunRequest = { accountId, driveToken: '', dryRun, creatives: [], assignments: [], updates: selectedUpdates };
    await api('run', request);
    await refreshStatus();
  });

  const stop = () => withBusy('Deteniendo…', async () => {
    await api('stop', {});
    await refreshStatus();
  });

  const advertiserTooLong = advertiser.trim().length > LIMITS.advertiser;
  const canRun = runner?.available && runner.session && !running && selected.length > 0 && !advertiserTooLong && !busy;
  const canUpdate = runner?.available && runner.session && !running && selectedUpdates.length > 0 && !advertiserTooLong && !busy;

  return (
    <div className="view-root flex-1 flex flex-col h-full bg-slate-950/40 overflow-y-auto">
      <div className="view-toolbar p-4 border-b border-slate-800 flex flex-wrap items-end justify-between gap-4 bg-slate-900/50">
        <div>
          <p className="text-[10px] uppercase font-bold tracking-widest text-slate-500">Quantcast · creatividades nativas</p>
          <h2 className="text-base font-bold text-slate-100 mt-1">Quantcast Nativa</h2>
        </div>
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Account ID Quantcast</label>
            <input value={accountId} onChange={(e) => setAccountId(e.target.value.replace(/\D/g, ''))}
              className="w-32 bg-slate-950 border border-slate-800 rounded-lg py-2 px-3 text-sm text-slate-200 focus:outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Advertiser</label>
            <input value={advertiser} onChange={(e) => setAdvertiser(e.target.value)}
              className={`w-40 bg-slate-950 border rounded-lg py-2 px-3 text-sm text-slate-200 focus:outline-none focus:border-blue-500 ${advertiserTooLong ? 'border-rose-500' : 'border-slate-800'}`} />
          </div>
          <div className="text-xs">
            {runner === null ? <span className="text-slate-500">Comprobando runner…</span>
              : !runner.available ? <span className="text-amber-400">Solo funciona en local (npm run dev)</span>
              : (
                <div className="flex items-center gap-2">
                  <span className={runner.session ? 'text-emerald-400' : 'text-amber-400'}>
                    {runner.session ? 'Sesión de Quantcast guardada' : 'Sin sesión de Quantcast'}
                  </span>
                  <button onClick={login} disabled={!!busy || running || runner.loginInProgress}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 font-semibold text-slate-300 hover:border-blue-500/50 disabled:opacity-40">
                    <LogIn className="w-4 h-4" /> {runner.session ? 'Renovar sesión' : 'Iniciar sesión en Quantcast'}
                  </button>
                </div>
              )}
          </div>
        </div>
      </div>

      {(busy || error) && (
        <div className={`mx-4 mt-4 rounded-lg px-4 py-3 text-sm ${error ? 'bg-rose-500/10 text-rose-300 border border-rose-500/30' : 'bg-blue-500/10 text-blue-200 border border-blue-500/30'}`}>
          {error || <span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />{busy}</span>}
        </div>
      )}

      <div className="px-4 pt-4">
        <div className="inline-flex rounded-xl border border-slate-700 overflow-hidden">
          <button onClick={() => setMode('upload')} disabled={running}
            className={`flex items-center gap-2 px-5 py-2.5 text-sm font-semibold transition-all disabled:opacity-50 ${mode === 'upload' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800'}`}>
            <FileUp className="w-4 h-4" /> Subir nuevas creatividades
          </button>
          <div className="w-px bg-slate-700 shrink-0" />
          <button onClick={() => setMode('update')} disabled={running}
            className={`flex items-center gap-2 px-5 py-2.5 text-sm font-semibold transition-all disabled:opacity-50 ${mode === 'update' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800'}`}>
            <PencilLine className="w-4 h-4" /> Actualizar existentes
          </button>
        </div>
        {mode === 'update' && (
          <p className="text-xs text-slate-500 mt-2">
            Compara el archivo con lo que hay en Quantcast (Title, Description, Advertiser, Landing URL, Impression Tracker e idioma)
            y edita solo lo que sea distinto, en las creatividades del placement asociadas a su ad set.
          </p>
        )}
      </div>

      <div className={`grid gap-4 p-4 ${mode === 'upload' ? 'md:grid-cols-2' : ''}`}>
        <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2"><FileUp className="w-4 h-4" />1. Archivo de tags de CM360</h3>
          <p className="text-xs text-slate-500 mt-1">CSV o XLSX con Placement Name, Click Tag, Impression Tag (image), Title y Description.</p>
          <input type="file" accept=".csv,.xlsx" onChange={(e) => e.target.files?.[0] && loadSheet(e.target.files[0])}
            className="mt-3 text-xs text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-slate-200" />
          {sheet && (
            <div className="mt-3 text-xs">
              <p className="text-slate-300">{sheet.fileName}: <b>{sheet.rows.length}</b> fila(s)</p>
              {sheet.errors.map((e) => <p key={e} className="text-rose-400 mt-1">{e}</p>)}
            </div>
          )}
        </section>

        {mode === 'upload' && <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2"><FolderOpen className="w-4 h-4" />2. Imágenes (Drive, 1000x600)</h3>
          <div className="flex gap-2 mt-3">
            <input value={driveLink} onChange={(e) => setDriveLink(e.target.value)} placeholder="Enlace de la carpeta de Drive"
              className="flex-1 bg-slate-950 border border-slate-800 rounded-lg py-2 px-3 text-sm text-slate-200 focus:outline-none focus:border-blue-500 placeholder:text-slate-600" />
            <button onClick={loadImages} disabled={!driveLink.trim() || !!busy}
              className="rounded-lg bg-slate-800 hover:bg-slate-700 px-3 py-2 text-sm font-semibold text-slate-200 disabled:opacity-40">Leer</button>
          </div>
          {images && (
            <p className="mt-3 text-xs text-slate-400">
              País de la carpeta: {folderMarket
                ? <b className="text-slate-200">{folderMarket}{languageForMarket(folderMarket) ? ` → ${languageForMarket(folderMarket)}` : ' (idioma según el texto)'}</b>
                : <span className="text-slate-500">no reconocido (se usará el texto o el ae-xx del placement)</span>}
            </p>
          )}
          {images && (
            <ul className="mt-2 space-y-1 text-xs">
              {images.map((img) => (
                <li key={img.id} className="flex items-start gap-2">
                  <input type="checkbox" checked={img.enabled} disabled={img.issues.length > 0}
                    onChange={() => setImages((prev) => prev!.map((i) => (i.id === img.id ? { ...i, enabled: !i.enabled } : i)))} />
                  <ImageIcon className="w-3.5 h-3.5 text-slate-500 mt-0.5" />
                  <span className="text-slate-300">{img.name}</span>
                  {img.issues.length > 0 && <span className="text-rose-400">{img.issues.join(' ')}</span>}
                </li>
              ))}
              {enabledImages.length > 1 && (
                <li className="text-sky-300 pt-1">Con {enabledImages.length} imágenes se crea una creatividad por imagen y placement (nombre con _v1, _v2… antes del ID).</li>
              )}
            </ul>
          )}
        </section>}
      </div>

      {sheet && sheet.rows.length > 0 && (
        <section className="mx-4 mb-4 rounded-xl border border-slate-800 bg-slate-900/40">
          <div className="flex flex-wrap items-center gap-3 p-4 border-b border-slate-800">
            <h3 className="text-sm font-bold text-slate-200">3. Plan</h3>
            <button onClick={loadQuantcast} disabled={!!busy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:border-blue-500/50 disabled:opacity-40">
              <Search className="w-3.5 h-3.5" /> {qcCampaigns ? 'Volver a buscar en Quantcast' : 'Buscar campañas en Quantcast'}
            </button>
            {mode === 'upload' && (
              <label className="flex items-center gap-2 text-xs text-slate-300 ml-auto">
                <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
                Sustituir las creatividades actuales del ad set
              </label>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-slate-500">
                <tr className="border-b border-slate-800">
                  {mode === 'upload' && <th className="p-2"></th>}
                  <th className="p-2 text-left">{mode === 'upload' ? 'Creatividad' : 'Placement'}</th>
                  <th className="p-2 text-left">Title / Description</th>
                  <th className="p-2 text-left">Idioma</th>
                  <th className="p-2 text-left">Campaña Quantcast</th>
                  <th className="p-2 text-left">Ad set</th>
                  <th className="p-2 text-left">Estado</th>
                </tr>
              </thead>
              <tbody>
                {plan.map((p) => (
                  <tr key={p.row.rowNumber} className="border-b border-slate-800/60 align-top">
                    {mode === 'upload' && (
                      <td className="p-2">
                        <input type="checkbox" checked={p.include} disabled={p.blockers.length > 0}
                          onChange={(e) => setOverride(p.row.rowNumber, { include: e.target.checked })} />
                      </td>
                    )}
                    <td className="p-2 font-mono text-slate-300 max-w-xs break-all">
                      {mode === 'upload' ? p.creativeNames.map((n) => <div key={n}>{n}</div>) : p.row.placementName}
                    </td>
                    <td className="p-2 max-w-xs">
                      <div className="text-slate-200">{p.row.title} <span className="text-slate-600">({p.row.title.length})</span></div>
                      <div className="text-slate-400">{p.row.description} <span className="text-slate-600">({p.row.description.length})</span></div>
                    </td>
                    <td className="p-2">
                      <select value={p.language || ''} onChange={(e) => setOverride(p.row.rowNumber, { language: e.target.value as QcLanguage })}
                        className={`bg-slate-950 border rounded px-1.5 py-1 text-slate-200 ${p.languageGuessed ? 'border-amber-500' : 'border-slate-700'}`}>
                        <option value="">—</option>
                        {QC_LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
                      </select>
                      {p.languageSource && <div className="text-slate-500 mt-1">por {p.languageSource}</div>}
                      {p.languageNote && <div className="text-amber-400 mt-1 max-w-[10rem]">{p.languageNote}</div>}
                    </td>
                    <td className="p-2">
                      {qcCampaigns ? (
                        <select value={p.campaign?.id || ''}
                          className={`bg-slate-950 border rounded px-1.5 py-1 text-slate-200 max-w-[16rem] ${p.campaignAuto ? 'border-emerald-500' : 'border-slate-700'}`}
                          onChange={(e) => {
                            setOverride(p.row.rowNumber, { campaignId: e.target.value, adSetId: undefined });
                            void ensureDetails([e.target.value]).catch((err) => setError(err?.message || String(err)));
                          }}>
                          <option value="">—</option>
                          {p.campaignCandidates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      ) : <span className="text-slate-600">—</span>}
                      {p.campaignAuto && <div className="text-emerald-400 mt-1">auto · revisa</div>}
                      {p.yearNote && <div className="text-amber-400 mt-1">{p.yearNote}</div>}
                      {campaignRoot(p.row.placementName) && (
                        <div className="text-slate-500 mt-1 font-mono break-all">raíz: {campaignRoot(p.row.placementName)}</div>
                      )}
                      {placementStrategy(p.row.placementName) && (
                        <div className="text-slate-500 font-mono">
                          estrategia: {placementStrategy(p.row.placementName)}
                          {/audience-extension/i.test(p.row.placementName) && <span className="text-sky-300"> (audience-extension)</span>}
                        </div>
                      )}
                    </td>
                    <td className="p-2">
                      {p.campaign ? (
                        <select value={p.adSet?.id || ''}
                          className={`bg-slate-950 border rounded px-1.5 py-1 text-slate-200 max-w-[16rem] ${p.adSetAuto ? 'border-emerald-500' : 'border-slate-700'}`}
                          onChange={(e) => setOverride(p.row.rowNumber, { adSetId: e.target.value })}>
                          <option value="">—</option>
                          {p.adSetCandidates.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                      ) : <span className="text-slate-600">—</span>}
                      {p.adSetAuto && <div className="text-emerald-400 mt-1">auto · revisa</div>}
                      {p.adSet && <div className="text-slate-500 mt-1">{p.existing.length} creatividad(es) asignadas ahora</div>}
                    </td>
                    <td className="p-2 space-y-0.5">
                      {p.blockers.map((b) => <div key={b} className="text-rose-400">{b}</div>)}
                      {p.row.warnings.map((w) => <div key={w} className="text-amber-400">{w}</div>)}
                      {mode === 'upload' && p.alreadyAssigned && <div className="text-sky-300">Ya está asignada en el ad set.</div>}
                      {mode === 'upload' && p.blockers.length === 0 && !p.alreadyAssigned && <div className="text-emerald-400">Lista</div>}
                      {mode === 'update' && p.blockers.length === 0 && <div className="text-emerald-400">Localizada</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {mode === 'upload' && <div className="flex flex-wrap items-center gap-3 p-4">
            <span className="text-xs text-slate-400">{selected.length} de {plan.length} fila(s) seleccionadas</span>
            <button onClick={() => run(true)} disabled={!canRun}
              className="ml-auto inline-flex items-center gap-2 rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 hover:border-blue-500/50 disabled:opacity-40">
              <Play className="w-4 h-4" /> Prueba (rellena sin guardar)
            </button>
            <button onClick={() => run(false)} disabled={!canRun}
              className="inline-flex items-center gap-2 rounded-lg bg-violet-600 hover:bg-violet-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">
              <Play className="w-4 h-4" /> Subir y asociar en Quantcast
            </button>
          </div>}
        </section>
      )}

      {mode === 'update' && sheet && sheet.rows.length > 0 && qcCampaigns && (
        <section className="mx-4 mb-4 rounded-xl border border-slate-800 bg-slate-900/40">
          <div className="p-4 border-b border-slate-800">
            <h3 className="text-sm font-bold text-slate-200">4. Cambios detectados</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-slate-500">
                <tr className="border-b border-slate-800">
                  <th className="p-2"></th>
                  <th className="p-2 text-left">Creatividad en Quantcast</th>
                  <th className="p-2 text-left">Campo</th>
                  <th className="p-2 text-left">Ahora en Quantcast</th>
                  <th className="p-2 text-left">Nuevo (archivo)</th>
                </tr>
              </thead>
              <tbody>
                {updatePlan.map((u) => (
                  <React.Fragment key={u.plan.row.rowNumber}>
                    {u.problem && (
                      <tr className="border-b border-slate-800/60">
                        <td className="p-2" />
                        <td className="p-2 font-mono text-slate-400 break-all">{u.plan.row.placementName}</td>
                        <td className="p-2 text-amber-400" colSpan={3}>{u.problem}</td>
                      </tr>
                    )}
                    {u.targets.map((t) => {
                      const keys = Object.keys(t.diff.changes) as (keyof NativeChanges)[];
                      const checked = keys.length > 0 && !updateSkip.has(t.creativeId);
                      const rows = keys.length ? keys : [null];
                      return rows.map((key, i) => (
                        <tr key={`${t.creativeId}-${key ?? 'none'}`} className={`align-top ${i === rows.length - 1 ? 'border-b border-slate-800/60' : ''}`}>
                          {i === 0 && (
                            <>
                              <td className="p-2" rowSpan={rows.length}>
                                <input type="checkbox" checked={checked} disabled={keys.length === 0}
                                  onChange={() => setUpdateSkip((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(t.creativeId)) next.delete(t.creativeId); else next.add(t.creativeId);
                                    return next;
                                  })} />
                              </td>
                              <td className="p-2 font-mono text-slate-300 break-all max-w-xs" rowSpan={rows.length}>
                                {t.name}
                                <div className="text-slate-600">ID {t.creativeId}</div>
                                {t.diff.notes.map((n) => <div key={n} className="text-amber-400 font-sans">{n}</div>)}
                              </td>
                            </>
                          )}
                          {key ? (
                            <>
                              <td className="p-2 text-slate-300 whitespace-nowrap">{CHANGE_LABELS[key]}</td>
                              <td className="p-2 text-rose-300/80 break-all max-w-sm">{t.diff.before[key] || <span className="text-slate-600">(vacío)</span>}</td>
                              <td className="p-2 text-emerald-300 break-all max-w-sm">{String(t.diff.changes[key])}</td>
                            </>
                          ) : (
                            <td className="p-2 text-slate-500" colSpan={3}>Sin cambios: coincide con el archivo.</td>
                          )}
                        </tr>
                      ));
                    })}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-3 p-4">
            <span className="text-xs text-slate-400">{selectedUpdates.length} creatividad(es) a editar</span>
            <button onClick={() => runUpdates(true)} disabled={!canUpdate}
              className="ml-auto inline-flex items-center gap-2 rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 hover:border-blue-500/50 disabled:opacity-40">
              <Play className="w-4 h-4" /> Prueba (cambia sin guardar)
            </button>
            <button onClick={() => runUpdates(false)} disabled={!canUpdate}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">
              <PencilLine className="w-4 h-4" /> Aplicar cambios en Quantcast
            </button>
          </div>
        </section>
      )}

      {runner?.run && (
        <section className="mx-4 mb-6 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-bold text-slate-200">
              Ejecución {runner.run.dryRun ? '(prueba)' : ''} · {runner.run.status === 'running' ? 'en marcha' : runner.run.status === 'finished' ? 'terminada' : runner.run.status === 'stopped' ? 'detenida' : 'fallida'}
            </h3>
            {running && (
              <button onClick={stop} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 px-3 py-1.5 text-xs font-semibold text-rose-300">
                <Square className="w-3.5 h-3.5" /> Detener
              </button>
            )}
          </div>
          {runner.run.error && <p className="text-xs text-rose-400 mt-2">{runner.run.error}</p>}
          {!!runner.run.popupsClosed && (
            <p className="text-xs text-slate-500 mt-2">Pop-ups de feedback cerrados automáticamente: {runner.run.popupsClosed}</p>
          )}
          <ul className="mt-3 space-y-2">
            {runner.run.steps.map((s) => (
              <li key={s.id} className="flex items-start gap-2 text-xs">
                <StepIcon status={s.status} />
                <div className="flex-1">
                  <div className="font-mono text-slate-300 break-all">{s.kind === 'assignment' ? 'Asociar: ' : s.kind === 'update' ? 'Editar: ' : 'Subir: '}{s.label}</div>
                  {s.message && <div className="text-slate-500">{s.message}</div>}
                </div>
                {s.screenshot && (
                  <a className="text-blue-400 hover:text-blue-300 shrink-0" target="_blank" rel="noreferrer"
                    href={`/api/qc-native/screenshot?run=${encodeURIComponent(runner.run!.runId)}&file=${encodeURIComponent(s.screenshot)}`}>
                    captura
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};

export default QuantcastNative;
