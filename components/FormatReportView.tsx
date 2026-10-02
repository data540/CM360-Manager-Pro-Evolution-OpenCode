import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, FolderOpen, Loader2, Play, XCircle } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { detectFile, DetectedFile } from '../services/creativeDetection';
import { buildFormatReport, outletKey, ReportAd, ReportRow, RowStatus } from '../services/formatReport';
import { marketByAdvertiserId } from '../services/markets';
import type { PlanPlacement } from '../services/trafficPlan';
import { readTrafficSheetFile, SheetParseResult } from '../services/trafficSheet';

// Manual outlet → CM360 site choices survive reloads: the sheet's outlet names are not reliably
// the same as the CM360 site names, so the user only has to resolve each outlet once.
const OVERRIDES_KEY = 'format_report_site_overrides';

const readOverrides = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(OVERRIDES_KEY) || '{}') || {};
  } catch {
    return {};
  }
};

const writeOverrides = (overrides: Record<string, string>) => {
  try {
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides));
  } catch {
    // Storage unavailable: the choice only lasts for this session.
  }
};

interface LoadedCampaign {
  campaign: { id: string; name: string };
  placements: PlanPlacement[];
  ads: ReportAd[];
  loadedAt: Date;
}

const STATUS_LABEL: Record<RowStatus, string> = {
  ok: 'OK',
  no_creative: 'Sin creatividad',
  placement_missing: 'Falta placement',
  site_not_found: 'Sitio sin identificar',
};

const STATUS_TONE: Record<RowStatus, string> = {
  ok: 'text-emerald-400',
  no_creative: 'text-amber-400',
  placement_missing: 'text-rose-400',
  site_not_found: 'text-slate-400',
};

const StatusIcon: React.FC<{ status: RowStatus }> = ({ status }) =>
  status === 'ok' ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
    : status === 'placement_missing' ? <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
      : <AlertTriangle className={`w-4 h-4 shrink-0 ${STATUS_TONE[status]}`} />;

const csvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;

const toPlanPlacement = (p: any, siteNames: Record<string, string>): PlanPlacement => ({
  id: String(p.id),
  name: p.name,
  siteId: String(p.siteId),
  siteName: siteNames[p.siteId],
  size: p.size?.width && p.size?.height ? `${p.size.width}x${p.size.height}` : undefined,
  compatibility: p.compatibility || 'DISPLAY',
  // CM360 v5 placements report status in `activeStatus`; there is no `archived` flag any more.
  active: p.activeStatus === 'PLACEMENT_STATUS_ACTIVE',
});

const toReportAd = (ad: any): ReportAd => ({
  id: String(ad.id),
  active: !!ad.active,
  placementIds: (ad.placementAssignments || []).map((pa: any) => String(pa.placementId)).filter(Boolean),
  creativeIds: (ad.creativeRotation?.creativeAssignments || ad.creativeAssignments || [])
    .map((ca: any) => String(ca.creativeId)).filter(Boolean),
});

const chunk = <T,>(items: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));

const FormatReportView: React.FC = () => {
  const { accessToken, profileId, selectedAdvertiser, selectedCampaign, campaigns } = useApp();
  const [campaignId, setCampaignId] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [sheet, setSheet] = useState<SheetParseResult | null>(null);
  const [onlyMarketRows, setOnlyMarketRows] = useState(true);
  const [folderName, setFolderName] = useState('');
  const [files, setFiles] = useState<DetectedFile[] | undefined>(undefined);
  const [loaded, setLoaded] = useState<LoadedCampaign | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>(readOverrides);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sheetInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const cmAdvertiserId = selectedAdvertiser?.id;
  const market = cmAdvertiserId ? marketByAdvertiserId(cmAdvertiserId) : undefined;

  useEffect(() => {
    setCampaignId(selectedCampaign && selectedCampaign.advertiserId === cmAdvertiserId ? selectedCampaign.id : '');
    setLoaded(null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmAdvertiserId]);

  // `webkitdirectory` is not in React's input typings.
  useEffect(() => {
    folderInput.current?.setAttribute('webkitdirectory', '');
  }, []);

  const sheetRows = useMemo(() => {
    if (!sheet) return [];
    if (!onlyMarketRows || !market) return sheet.rows;
    return sheet.rows.filter((row) => !row.country || row.country === market.code);
  }, [sheet, onlyMarketRows, market]);
  const hiddenRows = (sheet?.rows.length || 0) - sheetRows.length;

  const report = useMemo(
    () => (loaded && sheetRows.length
      ? buildFormatReport({ sheetRows, placements: loaded.placements, ads: loaded.ads, files, siteOverrides: overrides })
      : null),
    [loaded, sheetRows, files, overrides],
  );

  const sites = useMemo(
    () => (loaded
      ? [...new Map<string, { id: string; name: string }>(
        loaded.placements.map((p) => [p.siteId, { id: p.siteId, name: p.siteName || p.siteId }]),
      ).values()]
        .sort((a, b) => a.name.localeCompare(b.name))
      : []),
    [loaded],
  );

  const onSheetPicked = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setSheetName(file.name);
    setSheet(await readTrafficSheetFile(file));
  };

  const onFolderPicked = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files || []);
    event.target.value = '';
    if (picked.length === 0) return;
    const firstPath = (picked[0] as File & { webkitRelativePath?: string }).webkitRelativePath || '';
    setFolderName(firstPath.split('/')[0] || 'carpeta');
    setProgress(`Analizando ${picked.length} archivo${picked.length === 1 ? '' : 's'} de la carpeta…`);
    try {
      setFiles(await Promise.all(picked.map(detectFile)));
    } finally {
      setProgress(null);
    }
  };

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

  const loadCampaign = async () => {
    const campaign = campaigns.find((c) => c.id === campaignId);
    if (!campaign || !accessToken || !profileId) return;
    setError(null);
    try {
      setProgress('Leyendo placements de CM360…');
      const rawPlacements = await listAll('placements', 'placements', new URLSearchParams({ campaignIds: campaign.id, maxResults: '1000' }));

      setProgress('Leyendo sitios…');
      const siteNames: Record<string, string> = {};
      for (const group of chunk([...new Set(rawPlacements.map((p) => String(p.siteId)))], 100)) {
        const params = new URLSearchParams({ maxResults: '1000' });
        group.forEach((id) => params.append('ids', id));
        ((await cmGet('sites', params)).sites || []).forEach((s: any) => { siteNames[s.id] = s.name; });
      }

      setProgress('Leyendo anuncios…');
      const rawAds = await listAll('ads', 'ads', new URLSearchParams({ campaignIds: campaign.id, maxResults: '1000' }));

      setLoaded({
        campaign: { id: campaign.id, name: campaign.name },
        placements: rawPlacements.map((p) => toPlanPlacement(p, siteNames)),
        ads: rawAds.map(toReportAd),
        loadedAt: new Date(),
      });
    } catch (e: any) {
      setError(e?.message || 'Error desconocido');
    } finally {
      setProgress(null);
    }
  };

  const chooseSite = (outlet: string, siteId: string) => {
    setOverrides((prev) => {
      const next = { ...prev };
      if (siteId) next[outletKey(outlet)] = siteId; else delete next[outletKey(outlet)];
      writeOverrides(next);
      return next;
    });
  };

  const exportCsv = () => {
    if (!report || !loaded) return;
    const header = ['Fila', 'Soporte', 'Formato', 'Campaña hoja', 'Sitio CM360', 'Estado', 'Placements', 'Placements con creatividad', 'En carpeta', 'Avisos', 'URL de clic'];
    const rows = report.rows.map((r) => [
      String(r.sheetRow.rowNumber),
      r.sheetRow.site,
      r.sheetRow.format,
      r.sheetRow.campaign,
      r.siteName || '',
      STATUS_LABEL[r.status],
      r.placementIds.join(' | '),
      r.placementsWithCreative.join(' | '),
      r.inFolder === undefined ? '' : r.inFolder ? 'Sí' : 'No',
      r.sheetRow.warnings.join(' | '),
      r.sheetRow.clickUrl,
    ]);
    const extra = report.notInSheet.map(({ placement, hasCreative }) => [
      '', '', placement.size || placement.compatibility, '', placement.siteName || placement.siteId,
      'No está en la hoja', placement.id, hasCreative ? placement.id : '', '', placement.name, '',
    ]);
    const csv = [header, ...rows, ...extra].map((row) => row.map(csvCell).join(',')).join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    link.download = `formatos-pendientes_${loaded.campaign.name}_${loaded.loadedAt.toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  if (!selectedAdvertiser) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-500">
        <FileSpreadsheet className="w-10 h-10 text-slate-700" />
        <p className="text-sm">Selecciona un anunciante en la barra lateral para revisar los formatos de una campaña.</p>
      </div>
    );
  }

  const isRunning = progress !== null;
  const siteCell = (row: ReportRow) => {
    const chosen = overrides[outletKey(row.sheetRow.site)];
    if (row.status !== 'site_not_found' && !chosen) {
      return <span className="text-slate-200">{row.siteName}</span>;
    }
    const options = row.siteCandidates.length > 1 && !chosen ? row.siteCandidates : sites;
    return (
      <select
        value={chosen || ''}
        onChange={(e) => chooseSite(row.sheetRow.site, e.target.value)}
        className="max-w-[16rem] bg-slate-950 border border-slate-700 rounded-md py-1 px-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
      >
        <option value="">
          {row.siteCandidates.length > 1 ? `Ambiguo: ${row.siteCandidates.length} sitios…` : 'Elegir sitio…'}
        </option>
        {options.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    );
  };

  return (
    <div className="view-root flex-1 flex flex-col h-full bg-slate-950/40">
      <div className="view-toolbar relative z-40 p-4 border-b border-slate-800 flex flex-wrap items-end justify-between gap-4 bg-slate-900/50 backdrop-blur-sm">
        <div>
          <p className="text-[10px] uppercase font-bold tracking-widest text-slate-500">Formatos pendientes · hoja de trafficking ↔ CM360</p>
          <h2 className="text-base font-bold text-slate-100 mt-1">{selectedAdvertiser.name}</h2>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Campaña CM360</label>
            <select
              value={campaignId}
              onChange={(e) => { setCampaignId(e.target.value); setLoaded(null); }}
              className="w-72 bg-slate-950 border border-slate-800 rounded-lg py-2 px-3 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
            >
              <option value="">Elegir campaña…</option>
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <button
            onClick={loadCampaign}
            disabled={isRunning || !campaignId}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-4 py-2 text-sm font-bold text-white"
          >
            {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {loaded ? 'Recargar CM360' : 'Leer CM360'}
          </button>
          <button
            onClick={exportCsv}
            disabled={!report}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-300 hover:border-blue-500/50 hover:text-blue-300 disabled:opacity-40"
          >
            <Download className="w-4 h-4" />
            CSV
          </button>
        </div>
      </div>

      <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/30 flex flex-wrap items-center gap-3 text-sm">
        <input ref={sheetInput} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={onSheetPicked} />
        <input ref={folderInput} type="file" multiple className="hidden" onChange={onFolderPicked} />
        <button
          onClick={() => sheetInput.current?.click()}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:border-blue-500/50 hover:text-blue-300"
        >
          <FileSpreadsheet className="w-4 h-4" />
          {sheetName ? 'Cambiar hoja' : 'Cargar hoja de trafficking (.csv / .xlsx)'}
        </button>
        {sheetName && (
          <span className="text-xs text-slate-400">
            {sheetName} · {sheet?.rows.length || 0} fila{sheet?.rows.length === 1 ? '' : 's'}
          </span>
        )}
        {market && sheet && (
          <label className="flex items-center gap-1.5 text-xs text-slate-400">
            <input type="checkbox" checked={onlyMarketRows} onChange={(e) => setOnlyMarketRows(e.target.checked)} />
            Solo filas de {market.code}{hiddenRows > 0 ? ` (${hiddenRows} de otros países ocultas)` : ''}
          </label>
        )}
        <span className="h-4 w-px bg-slate-800" />
        <button
          onClick={() => folderInput.current?.click()}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:border-blue-500/50 hover:text-blue-300"
        >
          <FolderOpen className="w-4 h-4" />
          {folderName ? 'Cambiar carpeta' : 'Carpeta de creatividades (opcional)'}
        </button>
        {files && (
          <span className="text-xs text-slate-400">
            {folderName} · {files.length} archivo{files.length === 1 ? '' : 's'}
            <button onClick={() => { setFiles(undefined); setFolderName(''); }} className="ml-2 text-slate-500 hover:text-slate-300">quitar</button>
          </span>
        )}
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {progress && (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin" /> {progress}
          </div>
        )}
        {error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">{error}</div>}
        {sheet && sheet.errors.length > 0 && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300 space-y-1">
            {sheet.errors.map((e) => <p key={e}>{e}</p>)}
          </div>
        )}
        {!report && !progress && !error && (
          <p className="text-sm text-slate-500">
            Carga la hoja de trafficking y lee la campaña de CM360 para ver, por soporte y formato, qué placements faltan
            y cuáles no tienen creatividad. Si eliges la carpeta de creatividades, indica también si ya tienes el archivo.
            Solo lectura: no modifica nada en CM360.
          </p>
        )}

        {report && loaded && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              {[
                { label: 'OK', value: report.counts.ok, tone: 'text-emerald-400' },
                { label: 'Sin creatividad', value: report.counts.no_creative, tone: report.counts.no_creative ? 'text-amber-400' : 'text-emerald-400' },
                { label: 'Falta placement', value: report.counts.placement_missing, tone: report.counts.placement_missing ? 'text-rose-400' : 'text-emerald-400' },
                { label: 'Sitio sin identificar', value: report.counts.site_not_found, tone: report.counts.site_not_found ? 'text-slate-300' : 'text-emerald-400' },
                { label: 'Filas con avisos', value: report.counts.rowWarnings, tone: report.counts.rowWarnings ? 'text-amber-400' : 'text-emerald-400' },
              ].map((card) => (
                <div key={card.label} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                  <p className="text-[10px] uppercase font-bold tracking-widest text-slate-500">{card.label}</p>
                  <p className={`text-2xl font-bold mt-1 ${card.tone}`}>{card.value}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-500">
              {loaded.campaign.name} · {loaded.placements.length} placements · {loaded.ads.length} anuncios · {loaded.loadedAt.toLocaleString()}
              {' · '}Los formatos 1x1 se cruzan con placements de vídeo y con placements de display 1x1.
            </p>

            <section>
              <h3 className="text-xs uppercase font-bold tracking-widest text-slate-400 mb-2">Filas de la hoja ({report.rows.length})</h3>
              <div className="rounded-lg border border-slate-800 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-900/60 text-[10px] uppercase tracking-widest text-slate-500">
                    <tr>
                      <th className="text-left px-3 py-2">Soporte</th>
                      <th className="text-left px-3 py-2">Formato</th>
                      <th className="text-left px-3 py-2">Sitio CM360</th>
                      <th className="text-left px-3 py-2">Estado</th>
                      <th className="text-left px-3 py-2">Placements</th>
                      {files && <th className="text-left px-3 py-2">Carpeta</th>}
                      <th className="text-left px-3 py-2">Avisos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map((row) => (
                      <tr key={row.sheetRow.rowNumber} className="border-t border-slate-800 align-top">
                        <td className="px-3 py-2 font-mono text-slate-200">{row.sheetRow.site}</td>
                        <td className="px-3 py-2 font-mono text-slate-300">{row.sheetRow.format}</td>
                        <td className="px-3 py-2">{siteCell(row)}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center gap-1.5 font-semibold ${STATUS_TONE[row.status]}`}>
                            <StatusIcon status={row.status} /> {STATUS_LABEL[row.status]}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-400" title={row.placementIds.join('\n')}>
                          {row.placementIds.length > 0 ? `${row.placementsWithCreative.length}/${row.placementIds.length} con creatividad` : '—'}
                        </td>
                        {files && (
                          <td className="px-3 py-2 text-xs">
                            {row.inFolder ? <span className="text-emerald-400">Sí</span> : <span className="text-rose-400">No</span>}
                          </td>
                        )}
                        <td className="px-3 py-2 text-xs text-amber-300">
                          {row.sheetRow.warnings.map((w) => <p key={w}>{w}</p>)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <h3 className="text-xs uppercase font-bold tracking-widest text-slate-400 mb-2">
                Placements activos que la hoja no pide ({report.notInSheet.length})
              </h3>
              <div className="rounded-lg border border-slate-800 overflow-hidden">
                {report.notInSheet.length === 0 && <p className="p-4 text-sm text-slate-500">Todos los placements activos están en la hoja.</p>}
                {report.notInSheet.map(({ placement, hasCreative }) => (
                  <div key={placement.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-800 last:border-b-0 text-sm">
                    <span className="font-mono text-slate-200 break-all">{placement.name}</span>
                    <span className="ml-auto text-xs text-slate-500 whitespace-nowrap">
                      {placement.siteName || placement.siteId} · {placement.size || placement.compatibility} · {hasCreative ? 'con creatividad' : 'sin creatividad'}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
};

export default FormatReportView;
