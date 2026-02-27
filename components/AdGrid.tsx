import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { Search, RefreshCw, ExternalLink, Megaphone, CheckCircle2, X, AlertCircle, MoreVertical, Zap } from 'lucide-react';
import BulkNamingModal, { applyBulkNamingConfig } from './BulkNamingModal';

const AdGrid: React.FC = () => {
  const {
    ads,
    adsDrafts,
    placements,
    creatives,
    selectedCampaign,
    selectedAd,
    setSelectedAd,
    fetchAds,
    unassignCreativeFromAd,
    updateAdName,
    publishSelectedAdDrafts,
    isAdsLoading,
  } = useApp();

  const [searchTerm, setSearchTerm] = useState('');
  const [placementFilter, setPlacementFilter] = useState('');
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [isBulkActionsOpen, setIsBulkActionsOpen] = useState(false);
  const [isBulkNamingOpen, setIsBulkNamingOpen] = useState(false);
  const [unassigningCreativeId, setUnassigningCreativeId] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (selectedCampaign) {
      fetchAds(selectedCampaign.id, placementFilter || undefined);
    }
  }, [selectedCampaign?.id, placementFilter]);

  const placementMap = useMemo(() => {
    const map = new Map<string, string>();
    placements.forEach((placement) => map.set(placement.id, placement.name));
    return map;
  }, [placements]);

  const creativeMap = useMemo(() => {
    const map = new Map<string, string>();
    creatives.forEach((creative) => map.set(creative.id, creative.name));
    return map;
  }, [creatives]);

  const displayAds = ads.map((ad) => ({
    ...ad,
    ...(adsDrafts[ad.id] || {}),
    isDraft: !!adsDrafts[ad.id],
  }));

  const isDefaultAd = (adName: string) => /default/i.test(adName || '');

  const filteredAds = displayAds.filter((ad) => {
    const bySearch = ad.name.toLowerCase().includes(searchTerm.toLowerCase());
    const byPlacement = !placementFilter || ad.placementIds.includes(placementFilter);
    return bySearch && byPlacement;
  });

  const selectedAdData = selectedAd ? displayAds.find((ad) => ad.id === selectedAd.id) || null : null;
  const selectedDraftCount = Array.from(selectedRows).filter((id) => !!adsDrafts[id]).length;

  const handleUnassignCreative = async (creativeId: string) => {
    if (!selectedCampaign || !selectedAdData) return;

    setUnassigningCreativeId(creativeId);
    setActionNotice(null);

    const result = await unassignCreativeFromAd(creativeId, selectedAdData.id, selectedCampaign.id);
    if (result.success) {
      setActionNotice({ type: 'success', message: `Creative ${creativeId} was unassigned from ${selectedAdData.name}.` });
    } else {
      setActionNotice({ type: 'error', message: result.error || 'Could not unassign creative from this Ad.' });
    }

    setUnassigningCreativeId(null);
  };

  const toggleSelectAll = () => {
    const selectableAds = filteredAds.filter((ad) => !isDefaultAd(ad.name));
    if (selectedRows.size === selectableAds.length) {
      setSelectedRows(new Set());
      return;
    }
    setSelectedRows(new Set(selectableAds.map((ad) => ad.id)));
  };

  const toggleSelectRow = (id: string) => {
    const ad = filteredAds.find((item) => item.id === id);
    if (ad && isDefaultAd(ad.name)) return;

    const next = new Set(selectedRows);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedRows(next);
  };

  if (!selectedCampaign) {
    return (
      <div className="flex-1 flex items-center justify-center text-center">
        <div>
          <h3 className="text-slate-300 font-bold">No Campaign Selected</h3>
          <p className="text-slate-500 text-xs mt-1">Select a campaign to load CM360 Ads.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="view-root flex-1 flex flex-col h-full bg-slate-950/40">
      <div className="view-toolbar p-4 border-b border-slate-800 flex items-center justify-between gap-3 bg-slate-900/50">
        <div className="flex-1 max-w-md relative">
          <Search className="absolute left-3 top-3 w-4 h-4 text-slate-500" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search ads by name..."
            className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2.5 pl-10 pr-4 text-base text-slate-200 focus:outline-none focus:border-blue-500"
          />
        </div>

        <select
          value={placementFilter}
          onChange={(e) => setPlacementFilter(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-sm text-slate-200"
        >
          <option value="">All placements</option>
          {placements.map((placement) => (
            <option key={placement.id} value={placement.id}>{placement.name}</option>
          ))}
        </select>

        {selectedRows.size > 0 && (
          <div className="flex items-center bg-blue-600/10 px-3 py-1.5 rounded-lg border border-blue-500/20 gap-3">
            <span className="text-xs font-bold text-blue-400 uppercase tracking-wider">{selectedRows.size} selected</span>
            <div className="w-px h-4 bg-blue-500/20" />
            <div className="relative">
              <button
                onClick={() => setIsBulkActionsOpen((prev) => !prev)}
                className="text-slate-400 hover:text-white transition-colors"
                title="Bulk actions"
              >
                <MoreVertical className="w-3.5 h-3.5" />
              </button>
              {isBulkActionsOpen && (
                <div className="absolute right-0 top-6 w-52 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl z-20 py-1">
                  <button
                    onClick={() => {
                      setIsBulkNamingOpen(true);
                      setIsBulkActionsOpen(false);
                    }}
                    className="w-full text-left px-3 py-2.5 text-sm text-slate-300 hover:bg-blue-600 hover:text-white flex items-center gap-2"
                  >
                    <Zap className="w-3.5 h-3.5" /> Bulk naming
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        <button
          onClick={async () => {
            const idsToPublish = Array.from(selectedRows).filter((id) => !!adsDrafts[id]);
            if (idsToPublish.length === 0) {
              setActionNotice({ type: 'error', message: 'Select at least one Ad with draft naming changes.' });
              return;
            }

            setActionNotice({ type: 'success', message: `Publishing ${idsToPublish.length} Ad draft changes...` });
            const result = await publishSelectedAdDrafts(idsToPublish);
            setActionNotice(
              result.failed === 0
                ? { type: 'success', message: `Published ${result.success} Ad naming changes to CM360.` }
                : { type: 'error', message: `Published ${result.success}, failed ${result.failed}.` }
            );
            setSelectedRows(new Set());
          }}
          disabled={selectedDraftCount === 0}
          className="flex items-center gap-2 px-4 py-2.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 rounded-lg text-sm font-semibold transition-all border border-emerald-500/30 disabled:opacity-50 disabled:grayscale"
        >
          <Zap className="w-4 h-4" />
          Push to CM360 ({selectedDraftCount})
        </button>

        <button
          onClick={() => selectedCampaign && fetchAds(selectedCampaign.id, placementFilter || undefined)}
          className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-sm font-bold border border-slate-700"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isAdsLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="flex-1 overflow-auto p-6 custom-scrollbar">
        {actionNotice && (
          <div className={`mb-4 p-3 rounded-lg border text-xs flex items-center gap-2 ${actionNotice.type === 'success' ? 'bg-emerald-600/10 border-emerald-500/30 text-emerald-300' : 'bg-rose-600/10 border-rose-500/30 text-rose-300'}`}>
            <AlertCircle className="w-3.5 h-3.5" />
            <span>{actionNotice.message}</span>
          </div>
        )}

        {isAdsLoading ? (
          <div className="h-full flex items-center justify-center text-slate-500 text-xs">Loading ads from CM360...</div>
        ) : filteredAds.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <Megaphone className="w-8 h-8 text-slate-700 mb-3" />
            <h3 className="text-slate-300 font-bold">No ads found</h3>
            <p className="text-slate-500 text-xs mt-1">This campaign has no ads for the current filter.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="list-surface bg-[#152542] border border-[#2a4163] rounded-2xl overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="list-header-row bg-[#1b2d4d] border-b border-[#2a4163]">
                    <th className="p-4 w-12">
                      <input
                        type="checkbox"
                        className="appearance-none w-4 h-4 rounded-full border border-slate-500 bg-transparent checked:bg-emerald-400 checked:border-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                        checked={filteredAds.filter((ad) => !isDefaultAd(ad.name)).length > 0 && selectedRows.size === filteredAds.filter((ad) => !isDefaultAd(ad.name)).length}
                        onChange={toggleSelectAll}
                      />
                    </th>
                    <th className="p-4 text-xs font-bold uppercase tracking-widest text-slate-400">Ad Name</th>
                    <th className="p-4 text-xs font-bold uppercase tracking-widest text-slate-400">Placements</th>
                    <th className="p-4 text-xs font-bold uppercase tracking-widest text-slate-400">Creatives</th>
                    <th className="p-4 text-xs font-bold uppercase tracking-widest text-slate-400">Status</th>
                    <th className="p-4 w-12"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#263a5b]">
                  {filteredAds.map((ad) => (
                    <tr
                      key={ad.id}
                      className={`list-row cursor-pointer transition-colors ${isDefaultAd(ad.name) ? 'opacity-55' : ''} ${selectedAd?.id === ad.id ? 'list-row-selected bg-[#1f3458]' : 'hover:bg-[#1b2d4d]/60'}`}
                      onClick={() => setSelectedAd(ad)}
                    >
                      <td className="p-4" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="appearance-none w-4 h-4 rounded-full border border-slate-500 bg-transparent checked:bg-emerald-400 checked:border-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 disabled:opacity-40 disabled:cursor-not-allowed"
                          checked={selectedRows.has(ad.id)}
                          disabled={isDefaultAd(ad.name)}
                          onChange={() => toggleSelectRow(ad.id)}
                        />
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <span className="text-base font-bold text-slate-100 leading-6">{ad.name}</span>
                          {isDefaultAd(ad.name) && <span className="text-[10px] px-2 py-0.5 rounded bg-slate-700/30 border border-slate-600/40 text-slate-400 font-bold uppercase">Default</span>}
                          {ad.isDraft && <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 font-bold uppercase">Draft</span>}
                          {selectedAd?.id === ad.id && <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />}
                        </div>
                        <p className="text-xs text-slate-400 mt-1">ID: {ad.id}</p>
                      </td>
                      <td className="p-4 text-sm text-slate-300 leading-6">
                        {ad.placementIds.length > 0
                          ? ad.placementIds.map((id) => placementMap.get(id) || id).join(', ')
                          : 'No placements'}
                      </td>
                      <td className="p-4 text-base font-semibold text-slate-200">{ad.creativeIds.length}</td>
                      <td className="p-4">
                        <span className={`text-sm font-bold uppercase ${ad.active ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {ad.active ? 'Active' : 'Paused'}
                        </span>
                      </td>
                      <td className="p-4">
                        {ad.externalUrl && (
                          <a
                            href={ad.externalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 rounded-md text-blue-400 hover:bg-blue-400/10 transition-all inline-flex"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selectedAdData && (
              <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-bold text-slate-100">Creative Assignments for {selectedAdData.name}</h4>
                  <span className="text-xs text-slate-400">Ad ID: {selectedAdData.id}</span>
                </div>

                {selectedAdData.creativeIds.length === 0 ? (
                  <p className="text-sm text-slate-400">No creatives are assigned to this Ad.</p>
                ) : (
                  <div className="space-y-2">
                    {selectedAdData.creativeIds.map((creativeId) => (
                      <div key={creativeId} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-slate-950 border border-slate-800">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-100 truncate">{creativeMap.get(creativeId) || `Creative ${creativeId}`}</p>
                          <p className="text-xs text-slate-400">{creativeId}</p>
                        </div>
                        <button
                          onClick={() => handleUnassignCreative(creativeId)}
                          disabled={unassigningCreativeId === creativeId}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-bold bg-rose-600/20 text-rose-300 border border-rose-500/30 hover:bg-rose-600/30 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <X className="w-3.5 h-3.5" />
                          {unassigningCreativeId === creativeId ? 'Removing...' : 'Unassign'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {isBulkNamingOpen && (
        <BulkNamingModal
          items={filteredAds.filter((ad) => selectedRows.has(ad.id)).map((ad) => ({ id: ad.id, name: ad.name }))}
          entityLabel="Ads"
          onClose={() => setIsBulkNamingOpen(false)}
          onApply={(config) => {
            filteredAds
              .filter((ad) => selectedRows.has(ad.id))
              .forEach((ad) => {
                updateAdName(ad.id, applyBulkNamingConfig(ad.name, config));
              });
            setActionNotice({ type: 'success', message: 'Draft naming changes prepared. Use Push to CM360 to confirm.' });
            setIsBulkNamingOpen(false);
            setSelectedRows(new Set());
          }}
        />
      )}
    </div>
  );
};

export default AdGrid;
