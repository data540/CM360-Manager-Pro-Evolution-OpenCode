import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, Loader2, Play, ShieldCheck, XCircle } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { getGoogleClientId } from '../constants';
import {
  Dv360Advertiser,
  findLinkedDv360Advertisers,
  getDv360Advertiser,
  getDv360Token,
  getRememberedDv360Advertiser,
  listCreativesByIds,
  listDisplayLineItems,
  listInsertionOrders,
  rememberDv360Advertiser,
} from '../services/dv360';
import {
  AuditIssue,
  AuditResult,
  CmPlacementLite,
  DvCreative,
  auditCampaign,
  matchInsertionOrder,
} from '../services/traffickingAudit';

interface AuditRun {
  result: AuditResult;
  advertiser: Dv360Advertiser;
  lineItemNames: Record<string, string>;
  ranAt: Date;
}

const toLite = (p: any, campaignNames: Record<string, string> = {}): CmPlacementLite => ({
  id: String(p.id),
  name: p.name,
  campaignId: String(p.campaignId),
  campaignName: campaignNames[p.campaignId],
  // CM360 v5 placements report status in `activeStatus`; there is no `archived` flag any more.
  archived: p.activeStatus === 'PLACEMENT_STATUS_ARCHIVED' || p.activeStatus === 'PLACEMENT_STATUS_PERMANENTLY_ARCHIVED',
  inactive: p.activeStatus === 'PLACEMENT_STATUS_INACTIVE',
  permanentlyArchived: p.activeStatus === 'PLACEMENT_STATUS_PERMANENTLY_ARCHIVED',
});

const chunk = <T,>(items: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));

const csvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;

const SeverityIcon: React.FC<{ severity: AuditIssue['severity'] }> = ({ severity }) =>
  severity === 'error'
    ? <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
    : <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />;

const TraffickingAudit: React.FC = () => {
  const { accessToken, profileId, selectedAdvertiser, selectedCampaign, campaigns } = useApp();
  const [dvAdvertiserInput, setDvAdvertiserInput] = useState('');
  const [candidates, setCandidates] = useState<Dv360Advertiser[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<AuditRun | null>(null);

  const cmAdvertiserId = selectedAdvertiser?.id;
  useEffect(() => {
    setDvAdvertiserInput(cmAdvertiserId ? getRememberedDv360Advertiser(cmAdvertiserId) || '' : '');
    setCandidates([]);
  }, [cmAdvertiserId]);

  useEffect(() => {
    setRun(null);
    setError(null);
  }, [selectedCampaign?.id]);

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

  const loadCampaignPlacements = async (campaignId: string) => {
    const placements: any[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({ campaignIds: campaignId, maxResults: '1000' });
      if (pageToken) params.set('pageToken', pageToken);
      const data = await cmGet('placements', params);
      placements.push(...(data.placements || []));
      pageToken = data.nextPageToken;
    } while (pageToken);
    return placements.map((p) => toLite(p));
  };

  const loadPlacementsByIds = async (ids: string[]) => {
    const placements: any[] = [];
    for (const group of chunk(ids, 100)) {
      const params = new URLSearchParams({ maxResults: '1000' });
      group.forEach((id) => params.append('ids', id));
      placements.push(...((await cmGet('placements', params)).placements || []));
    }
    const campaignIds = [...new Set(placements.map((p) => String(p.campaignId)))];
    const campaignNames: Record<string, string> = {};
    for (const group of chunk(campaignIds, 100)) {
      const params = new URLSearchParams();
      group.forEach((id) => params.append('ids', id));
      ((await cmGet('campaigns', params)).campaigns || []).forEach((c: any) => { campaignNames[c.id] = c.name; });
    }
    return placements.map((p) => toLite(p, campaignNames));
  };

  const resolveDv360Advertiser = async (token: string): Promise<Dv360Advertiser | null> => {
    const manualId = dvAdvertiserInput.trim();
    if (manualId) return getDv360Advertiser(token, manualId);

    setProgress('Buscando el anunciante de DV360 vinculado…');
    const linked = await findLinkedDv360Advertisers(token, selectedAdvertiser!.id);
    if (linked.length === 1) return linked[0];
    if (linked.length > 1) {
      setCandidates(linked);
      throw new Error('Hay varios anunciantes de DV360 vinculados a este anunciante de CM360. Elige uno y vuelve a ejecutar.');
    }
    throw new Error('No se encontró ningún anunciante de DV360 vinculado a este anunciante de CM360. Introduce su ID a mano.');
  };

  const runAudit = async () => {
    if (!selectedAdvertiser || !selectedCampaign || !accessToken || !profileId) return;
    setError(null);
    setRun(null);
    try {
      setProgress('Conectando con DV360…');
      const token = await getDv360Token(getGoogleClientId());
      const advertiser = await resolveDv360Advertiser(token);
      if (!advertiser) return;
      rememberDv360Advertiser(selectedAdvertiser.id, advertiser.advertiserId);
      setDvAdvertiserInput(advertiser.advertiserId);
      setCandidates([]);

      setProgress('Leyendo Insertion Orders de DV360…');
      const insertionOrders = await listInsertionOrders(token, advertiser.advertiserId);
      const relatedIoIds = insertionOrders
        .filter((io) => matchInsertionOrder(selectedCampaign.name, io.displayName).kind === 'match')
        .map((io) => io.insertionOrderId);

      setProgress('Leyendo line items y creatividades…');
      const lineItems = relatedIoIds.length ? await listDisplayLineItems(token, advertiser.advertiserId, relatedIoIds) : [];
      const creativeIds = [...new Set(lineItems.flatMap((li) => li.creativeIds || []))];
      const creatives: DvCreative[] = creativeIds.length ? await listCreativesByIds(token, advertiser.advertiserId, creativeIds) : [];

      setProgress('Leyendo placements de CM360…');
      const campaignPlacements = await loadCampaignPlacements(selectedCampaign.id);
      const ownIds = new Set(campaignPlacements.map((p) => p.id));
      const foreignIds = [...new Set(creatives
        .map((c) => c.cmPlacementId || c.cmTrackingAd?.cmPlacementId)
        .filter((id): id is string => !!id && !ownIds.has(id)))];
      const foreignPlacements = foreignIds.length ? await loadPlacementsByIds(foreignIds) : [];

      const result = auditCampaign({
        campaign: { id: selectedCampaign.id, name: selectedCampaign.name },
        otherCampaignNames: campaigns.map((c) => c.name),
        campaignPlacements,
        foreignPlacements,
        insertionOrders,
        lineItems,
        creatives,
      });
      setRun({
        result,
        advertiser,
        lineItemNames: Object.fromEntries(lineItems.map((li) => [li.lineItemId, li.displayName])),
        ranAt: new Date(),
      });
    } catch (e: any) {
      setError(e?.message || 'Error desconocido');
    } finally {
      setProgress(null);
    }
  };

  const expectedCoverage = useMemo(
    () => (run ? run.result.coverage.filter((row) => row.expectedInDv360 || row.lineItemIds.length > 0) : []),
    [run],
  );

  const exportCsv = () => {
    if (!run || !selectedCampaign) return;
    const header = ['Severidad', 'Código', 'Mensaje', 'Insertion Order', 'Placement ID', 'Placement', 'Line items'];
    const rows = run.result.issues.map((issue) => [
      issue.severity === 'error' ? 'Error' : 'Aviso',
      issue.code,
      issue.message,
      issue.insertionOrderName || '',
      issue.placementId || '',
      issue.placementName || '',
      issue.lineItemIds.map((id) => run.lineItemNames[id] || id).join(' | '),
    ]);
    const csv = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    link.download = `audit-dv360_${selectedCampaign.name}_${run.ranAt.toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  if (!selectedCampaign) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-500">
        <ShieldCheck className="w-10 h-10 text-slate-700" />
        <p className="text-sm">Selecciona un anunciante y una campaña en la barra lateral para revisarla contra DV360.</p>
      </div>
    );
  }

  const isRunning = progress !== null;
  const lineItemList = (ids: string[]) => ids.map((id) => run?.lineItemNames[id] || id).join('\n');

  return (
    <div className="view-root flex-1 flex flex-col h-full bg-slate-950/40">
      <div className="view-toolbar relative z-40 p-4 border-b border-slate-800 flex flex-wrap items-end justify-between gap-4 bg-slate-900/50 backdrop-blur-sm">
        <div>
          <p className="text-[10px] uppercase font-bold tracking-widest text-slate-500">Audit CM360 ↔ DV360</p>
          <h2 className="text-base font-bold text-slate-100 mt-1">{selectedCampaign.name}</h2>
        </div>

        <div className="flex items-end gap-2">
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Advertiser ID DV360</label>
            {candidates.length > 0 ? (
              <select
                value={dvAdvertiserInput}
                onChange={(e) => setDvAdvertiserInput(e.target.value)}
                className="w-64 bg-slate-950 border border-amber-500/50 rounded-lg py-2 px-3 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
              >
                <option value="">Elige anunciante…</option>
                {candidates.map((a) => (
                  <option key={a.advertiserId} value={a.advertiserId}>{a.displayName} ({a.advertiserId})</option>
                ))}
              </select>
            ) : (
              <input
                value={dvAdvertiserInput}
                onChange={(e) => setDvAdvertiserInput(e.target.value.replace(/\D/g, ''))}
                placeholder="Automático"
                className="w-40 bg-slate-950 border border-slate-800 rounded-lg py-2 px-3 text-sm text-slate-200 focus:outline-none focus:border-blue-500 placeholder:text-slate-600"
              />
            )}
          </div>
          <button
            onClick={runAudit}
            disabled={isRunning}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-4 py-2 text-sm font-bold text-white"
          >
            {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Ejecutar revisión
          </button>
          <button
            onClick={exportCsv}
            disabled={!run || run.result.issues.length === 0}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-300 hover:border-blue-500/50 hover:text-blue-300 disabled:opacity-40"
          >
            <Download className="w-4 h-4" />
            CSV
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {progress && (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin" /> {progress}
          </div>
        )}
        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">{error}</div>
        )}
        {!run && !progress && !error && (
          <p className="text-sm text-slate-500">
            Compara los placements de esta campaña con las creatividades asignadas en los line items Display de DV360.
            Solo lectura: no modifica nada en CM360 ni en DV360.
          </p>
        )}

        {run && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              {[
                { label: 'Errores', value: run.result.counts.errors, tone: run.result.counts.errors ? 'text-rose-400' : 'text-emerald-400' },
                { label: 'Avisos', value: run.result.counts.warnings, tone: run.result.counts.warnings ? 'text-amber-400' : 'text-emerald-400' },
                { label: 'Insertion Orders', value: run.result.ioMatches.length, tone: 'text-slate-100' },
                { label: 'Line items Display', value: run.result.counts.lineItems, tone: 'text-slate-100' },
                {
                  label: 'Placements DV360 asignados',
                  value: `${run.result.coverage.filter((r) => r.expectedInDv360 && r.lineItemIds.length > 0).length}/${run.result.coverage.filter((r) => r.expectedInDv360).length}`,
                  tone: 'text-slate-100',
                },
              ].map((card) => (
                <div key={card.label} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                  <p className="text-[10px] uppercase font-bold tracking-widest text-slate-500">{card.label}</p>
                  <p className={`text-2xl font-bold mt-1 ${card.tone}`}>{card.value}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-500">
              DV360: {run.advertiser.displayName} ({run.advertiser.advertiserId}) · {run.ranAt.toLocaleString()}
            </p>

            <section>
              <h3 className="text-xs uppercase font-bold tracking-widest text-slate-400 mb-2">Insertion Orders</h3>
              <div className="rounded-xl border border-slate-800 overflow-hidden">
                {run.result.ioMatches.length === 0 && <p className="p-4 text-sm text-slate-500">Ningún IO relacionado.</p>}
                {run.result.ioMatches.map(({ io, kind, diffs }) => (
                  <div key={io.insertionOrderId} className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-800 last:border-b-0 text-sm">
                    {kind === 'match'
                      ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      : <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />}
                    <span className="font-mono text-slate-200 break-all">{io.displayName}</span>
                    {kind === 'naming' && (
                      <span className="text-xs text-amber-300">«{diffs[0].expected}» → «{diffs[0].found}»</span>
                    )}
                    <span className="ml-auto text-xs text-slate-500">{io.insertionOrderId}</span>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3 className="text-xs uppercase font-bold tracking-widest text-slate-400 mb-2">
                Incidencias ({run.result.issues.length})
              </h3>
              <div className="rounded-xl border border-slate-800 overflow-hidden">
                {run.result.issues.length === 0 && (
                  <p className="p-4 text-sm text-emerald-400 flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> Sin incidencias.</p>
                )}
                {run.result.issues.map((issue, index) => (
                  <div key={index} className="flex items-start gap-3 px-4 py-3 border-b border-slate-800 last:border-b-0">
                    <SeverityIcon severity={issue.severity} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-slate-200">{issue.message}</p>
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                        {issue.placementName && <span className="font-mono break-all">{issue.placementName}</span>}
                        {issue.insertionOrderName && <span>IO: {issue.insertionOrderName}</span>}
                        {issue.lineItemIds.length > 0 && (
                          <span title={lineItemList(issue.lineItemIds)} className="underline decoration-dotted cursor-help">
                            {issue.lineItemIds.length} line item{issue.lineItemIds.length === 1 ? '' : 's'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3 className="text-xs uppercase font-bold tracking-widest text-slate-400 mb-2">
                Placements de la campaña con «dv360» o asignados en DV360
              </h3>
              <div className="rounded-xl border border-slate-800 overflow-hidden">
                {expectedCoverage.length === 0 && <p className="p-4 text-sm text-slate-500">Ningún placement de DV360 en esta campaña.</p>}
                {expectedCoverage.map(({ placement, lineItemIds, insertionOrderIds }) => (
                  <div key={placement.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-800 last:border-b-0 text-sm">
                    {lineItemIds.length > 0
                      ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      : <XCircle className="w-4 h-4 text-rose-400 shrink-0" />}
                    <span className="font-mono text-slate-200 break-all">{placement.name}</span>
                    <span
                      className="ml-auto text-xs text-slate-500 whitespace-nowrap cursor-help"
                      title={lineItemList(lineItemIds)}
                    >
                      {lineItemIds.length > 0
                        ? `${lineItemIds.length} LI · ${insertionOrderIds.length} IO`
                        : 'Sin asignar'}
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

export default TraffickingAudit;
