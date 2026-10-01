import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, CheckCircle2, Download, Loader2, Play, ShieldCheck, XCircle } from 'lucide-react';
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

interface CampaignAuditRun {
  campaign: { id: string; name: string };
  result: AuditResult;
}

interface MultiAuditRun {
  advertiser: Dv360Advertiser;
  lineItemNames: Record<string, string>;
  ranAt: Date;
  campaignRuns: CampaignAuditRun[];
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
  const [campaignFilter, setCampaignFilter] = useState('');
  const [selectedCampaignIds, setSelectedCampaignIds] = useState<Set<string>>(new Set());
  const [expandedCampaignIds, setExpandedCampaignIds] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [multiRun, setMultiRun] = useState<MultiAuditRun | null>(null);

  const cmAdvertiserId = selectedAdvertiser?.id;
  useEffect(() => {
    setDvAdvertiserInput(cmAdvertiserId ? getRememberedDv360Advertiser(cmAdvertiserId) || '' : '');
    setCandidates([]);
    setMultiRun(null);
    setError(null);
    setExpandedCampaignIds(new Set());
    // Pre-select the campaign chosen in the sidebar, when it belongs to this advertiser.
    setSelectedCampaignIds(
      selectedCampaign && selectedCampaign.advertiserId === cmAdvertiserId ? new Set([selectedCampaign.id]) : new Set(),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmAdvertiserId]);

  const filteredCampaigns = useMemo(
    () => campaigns.filter((c) => c.name.toLowerCase().includes(campaignFilter.toLowerCase())),
    [campaigns, campaignFilter],
  );

  const toggleCampaign = (id: string) => {
    setSelectedCampaignIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleExpanded = (id: string) => {
    setExpandedCampaignIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
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

  /** Placements of several campaigns in one call: CM360 accepts repeated `campaignIds`. */
  const loadPlacementsForCampaigns = async (campaignIds: string[]) => {
    const placements: any[] = [];
    for (const group of chunk(campaignIds, 100)) {
      let pageToken: string | undefined;
      do {
        const params = new URLSearchParams({ maxResults: '1000' });
        group.forEach((id) => params.append('campaignIds', id));
        if (pageToken) params.set('pageToken', pageToken);
        const data = await cmGet('placements', params);
        placements.push(...(data.placements || []));
        pageToken = data.nextPageToken;
      } while (pageToken);
    }
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
    const targetCampaigns = campaigns.filter((c) => selectedCampaignIds.has(c.id));
    if (!selectedAdvertiser || !accessToken || !profileId || targetCampaigns.length === 0) return;
    setError(null);
    setMultiRun(null);
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
      const relatedIoIds = [...new Set<string>(
        targetCampaigns.flatMap((camp) =>
          insertionOrders
            .filter((io) => matchInsertionOrder(camp.name, io.displayName).kind === 'match')
            .map((io) => io.insertionOrderId),
        ),
      )];

      setProgress('Leyendo line items y creatividades…');
      const lineItems = relatedIoIds.length ? await listDisplayLineItems(token, advertiser.advertiserId, relatedIoIds) : [];
      const creativeIds = [...new Set(lineItems.flatMap((li) => li.creativeIds || []))];
      const creatives: DvCreative[] = creativeIds.length ? await listCreativesByIds(token, advertiser.advertiserId, creativeIds) : [];

      setProgress(`Leyendo placements de ${targetCampaigns.length} campaña${targetCampaigns.length === 1 ? '' : 's'} de CM360…`);
      const allPlacements = await loadPlacementsForCampaigns(targetCampaigns.map((c) => c.id));
      const ownIds = new Set(allPlacements.map((p) => p.id));
      const foreignIds = [...new Set(creatives
        .map((c) => c.cmPlacementId || c.cmTrackingAd?.cmPlacementId)
        .filter((id): id is string => !!id && !ownIds.has(id)))];
      const trulyForeignPlacements = foreignIds.length ? await loadPlacementsByIds(foreignIds) : [];

      const otherCampaignNames = campaigns.map((c) => c.name);
      const campaignRuns: CampaignAuditRun[] = targetCampaigns.map((camp) => {
        const ownPlacements = allPlacements.filter((p) => p.campaignId === camp.id);
        // Placements of the OTHER selected campaigns count as "foreign" too, in case a creative
        // in this campaign's IOs actually points to one of them.
        const siblingPlacements = allPlacements.filter((p) => p.campaignId !== camp.id);
        const result = auditCampaign({
          campaign: { id: camp.id, name: camp.name },
          otherCampaignNames,
          campaignPlacements: ownPlacements,
          foreignPlacements: [...siblingPlacements, ...trulyForeignPlacements],
          insertionOrders,
          lineItems,
          creatives,
        });
        return { campaign: { id: camp.id, name: camp.name }, result };
      });

      setMultiRun({
        advertiser,
        lineItemNames: Object.fromEntries(lineItems.map((li) => [li.lineItemId, li.displayName])),
        ranAt: new Date(),
        campaignRuns,
      });
      setExpandedCampaignIds(new Set(campaignRuns.filter((r) => r.result.counts.errors > 0).map((r) => r.campaign.id)));
    } catch (e: any) {
      setError(e?.message || 'Error desconocido');
    } finally {
      setProgress(null);
    }
  };

  const totals = useMemo(() => {
    if (!multiRun) return null;
    return multiRun.campaignRuns.reduce(
      (acc, r) => ({
        errors: acc.errors + r.result.counts.errors,
        warnings: acc.warnings + r.result.counts.warnings,
        lineItems: acc.lineItems + r.result.counts.lineItems,
        issues: acc.issues + r.result.issues.length,
      }),
      { errors: 0, warnings: 0, lineItems: 0, issues: 0 },
    );
  }, [multiRun]);

  const exportCsv = () => {
    if (!multiRun || !totals || totals.issues === 0) return;
    const header = ['Campaña', 'Severidad', 'Código', 'Mensaje', 'Insertion Order', 'Placement ID', 'Placement', 'Line items'];
    const rows = multiRun.campaignRuns.flatMap(({ campaign, result }) =>
      result.issues.map((issue) => [
        campaign.name,
        issue.severity === 'error' ? 'Error' : 'Aviso',
        issue.code,
        issue.message,
        issue.insertionOrderName || '',
        issue.placementId || '',
        issue.placementName || '',
        issue.lineItemIds.map((id) => multiRun.lineItemNames[id] || id).join(' | '),
      ]),
    );
    const csv = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const label = multiRun.campaignRuns.length === 1
      ? multiRun.campaignRuns[0].campaign.name
      : `${multiRun.campaignRuns.length}-campanas`;
    link.download = `audit-dv360_${label}_${multiRun.ranAt.toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  if (!selectedAdvertiser) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-500">
        <ShieldCheck className="w-10 h-10 text-slate-700" />
        <p className="text-sm">Selecciona un anunciante en la barra lateral para revisar sus campañas contra DV360.</p>
      </div>
    );
  }

  const isRunning = progress !== null;
  const lineItemList = (ids: string[]) => ids.map((id) => multiRun?.lineItemNames[id] || id).join('\n');

  return (
    <div className="view-root flex-1 flex flex-col h-full bg-slate-950/40">
      <div className="view-toolbar relative z-40 p-4 border-b border-slate-800 flex flex-wrap items-end justify-between gap-4 bg-slate-900/50 backdrop-blur-sm">
        <div>
          <p className="text-[10px] uppercase font-bold tracking-widest text-slate-500">Audit CM360 ↔ DV360</p>
          <h2 className="text-base font-bold text-slate-100 mt-1">
            {selectedAdvertiser.name} · {selectedCampaignIds.size} campaña{selectedCampaignIds.size === 1 ? '' : 's'} seleccionada{selectedCampaignIds.size === 1 ? '' : 's'}
          </h2>
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
            disabled={isRunning || selectedCampaignIds.size === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-4 py-2 text-sm font-bold text-white"
          >
            {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Ejecutar revisión
          </button>
          <button
            onClick={exportCsv}
            disabled={!totals || totals.issues === 0}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-300 hover:border-blue-500/50 hover:text-blue-300 disabled:opacity-40"
          >
            <Download className="w-4 h-4" />
            CSV
          </button>
        </div>
      </div>

      <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/30">
        <div className="flex items-center gap-2 mb-2">
          <label className="text-[10px] uppercase font-bold tracking-widest text-slate-500">Campañas a revisar</label>
          <span className="text-xs text-slate-500">({selectedCampaignIds.size}/{campaigns.length})</span>
          <div className="ml-auto flex items-center gap-3">
            <input
              value={campaignFilter}
              onChange={(e) => setCampaignFilter(e.target.value)}
              placeholder="Buscar campaña…"
              className="bg-slate-950 border border-slate-800 rounded-lg py-1 px-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500 placeholder:text-slate-600 w-48"
            />
            <button
              onClick={() => setSelectedCampaignIds(new Set(filteredCampaigns.map((c) => c.id)))}
              className="text-xs font-semibold text-blue-400 hover:text-blue-300"
            >
              Todas
            </button>
            <button
              onClick={() => setSelectedCampaignIds(new Set())}
              className="text-xs font-semibold text-slate-500 hover:text-slate-300"
            >
              Ninguna
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
          {filteredCampaigns.length === 0 && <p className="text-xs text-slate-600 italic">Sin campañas para este anunciante.</p>}
          {filteredCampaigns.map((c) => {
            const checked = selectedCampaignIds.has(c.id);
            return (
              <button
                key={c.id}
                onClick={() => toggleCampaign(c.id)}
                className={`px-2.5 py-1 rounded-full text-xs font-mono border transition-colors ${
                  checked
                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                    : 'border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-300'
                }`}
              >
                {c.name}
              </button>
            );
          })}
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
        {!multiRun && !progress && !error && (
          <p className="text-sm text-slate-500">
            Compara los placements de las campañas elegidas con las creatividades asignadas en los line items Display de DV360.
            Solo lectura: no modifica nada en CM360 ni en DV360.
          </p>
        )}

        {multiRun && totals && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { label: 'Campañas revisadas', value: multiRun.campaignRuns.length, tone: 'text-slate-100' },
                { label: 'Errores', value: totals.errors, tone: totals.errors ? 'text-rose-400' : 'text-emerald-400' },
                { label: 'Avisos', value: totals.warnings, tone: totals.warnings ? 'text-amber-400' : 'text-emerald-400' },
                { label: 'Line items Display', value: totals.lineItems, tone: 'text-slate-100' },
              ].map((card) => (
                <div key={card.label} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                  <p className="text-[10px] uppercase font-bold tracking-widest text-slate-500">{card.label}</p>
                  <p className={`text-2xl font-bold mt-1 ${card.tone}`}>{card.value}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-500">
              DV360: {multiRun.advertiser.displayName} ({multiRun.advertiser.advertiserId}) · {multiRun.ranAt.toLocaleString()}
            </p>

            <div className="space-y-3">
              {multiRun.campaignRuns.map(({ campaign, result }) => {
                const isOpen = expandedCampaignIds.has(campaign.id);
                const expectedCoverage = result.coverage.filter((row) => row.expectedInDv360 || row.lineItemIds.length > 0);
                return (
                  <div key={campaign.id} className="rounded-xl border border-slate-800 overflow-hidden">
                    <button
                      onClick={() => toggleExpanded(campaign.id)}
                      className="w-full flex items-center gap-3 px-4 py-3 bg-slate-900/60 hover:bg-slate-900 text-left"
                    >
                      <ChevronDown className={`w-4 h-4 text-slate-500 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                      <span className="text-sm font-bold text-slate-100 font-mono truncate">{campaign.name}</span>
                      <div className="ml-auto flex items-center gap-3 shrink-0">
                        {result.counts.errors > 0 && (
                          <span className="text-xs font-bold text-rose-400">{result.counts.errors} error{result.counts.errors === 1 ? '' : 'es'}</span>
                        )}
                        {result.counts.warnings > 0 && (
                          <span className="text-xs font-bold text-amber-400">{result.counts.warnings} aviso{result.counts.warnings === 1 ? '' : 's'}</span>
                        )}
                        {result.issues.length === 0 && (
                          <span className="text-xs font-bold text-emerald-400 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> OK</span>
                        )}
                      </div>
                    </button>

                    {isOpen && (
                      <div className="p-4 space-y-5 border-t border-slate-800">
                        <section>
                          <h3 className="text-xs uppercase font-bold tracking-widest text-slate-400 mb-2">Insertion Orders</h3>
                          <div className="rounded-lg border border-slate-800 overflow-hidden">
                            {result.ioMatches.length === 0 && <p className="p-4 text-sm text-slate-500">Ningún IO relacionado.</p>}
                            {result.ioMatches.map(({ io, kind, diffs }) => (
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
                            Incidencias ({result.issues.length})
                          </h3>
                          <div className="rounded-lg border border-slate-800 overflow-hidden">
                            {result.issues.length === 0 && (
                              <p className="p-4 text-sm text-emerald-400 flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> Sin incidencias.</p>
                            )}
                            {result.issues.map((issue, index) => (
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
                            Placements con «dv360» o asignados en DV360
                          </h3>
                          <div className="rounded-lg border border-slate-800 overflow-hidden">
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
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default TraffickingAudit;
