import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { Search, RefreshCw, ExternalLink, Megaphone, CheckCircle2 } from 'lucide-react';

const AdGrid: React.FC = () => {
  const {
    ads,
    placements,
    selectedCampaign,
    selectedAd,
    setSelectedAd,
    fetchAds,
    isAdsLoading,
  } = useApp();

  const [searchTerm, setSearchTerm] = useState('');
  const [placementFilter, setPlacementFilter] = useState('');

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

  const filteredAds = ads.filter((ad) => {
    const bySearch = ad.name.toLowerCase().includes(searchTerm.toLowerCase());
    const byPlacement = !placementFilter || ad.placementIds.includes(placementFilter);
    return bySearch && byPlacement;
  });

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
    <div className="flex-1 flex flex-col h-full bg-slate-950/40">
      <div className="p-4 border-b border-slate-800 flex items-center justify-between gap-3 bg-slate-900/50">
        <div className="flex-1 max-w-md relative">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search ads by name..."
            className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2 pl-10 pr-4 text-sm focus:outline-none focus:border-blue-500"
          />
        </div>

        <select
          value={placementFilter}
          onChange={(e) => setPlacementFilter(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-300"
        >
          <option value="">All placements</option>
          {placements.map((placement) => (
            <option key={placement.id} value={placement.id}>{placement.name}</option>
          ))}
        </select>

        <button
          onClick={() => selectedCampaign && fetchAds(selectedCampaign.id, placementFilter || undefined)}
          className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-bold border border-slate-700"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isAdsLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="flex-1 overflow-auto p-6 custom-scrollbar">
        {isAdsLoading ? (
          <div className="h-full flex items-center justify-center text-slate-500 text-xs">Loading ads from CM360...</div>
        ) : filteredAds.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <Megaphone className="w-8 h-8 text-slate-700 mb-3" />
            <h3 className="text-slate-300 font-bold">No ads found</h3>
            <p className="text-slate-500 text-xs mt-1">This campaign has no ads for the current filter.</p>
          </div>
        ) : (
          <div className="bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-900 border-b border-slate-800">
                  <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-slate-500">Ad Name</th>
                  <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-slate-500">Placements</th>
                  <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-slate-500">Creatives</th>
                  <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-slate-500">Status</th>
                  <th className="p-4 w-12"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {filteredAds.map((ad) => (
                  <tr
                    key={ad.id}
                    className={`cursor-pointer transition-colors ${selectedAd?.id === ad.id ? 'bg-blue-600/10' : 'hover:bg-blue-600/[0.03]'}`}
                    onClick={() => setSelectedAd(ad)}
                  >
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-200">{ad.name}</span>
                        {selectedAd?.id === ad.id && <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />}
                      </div>
                      <p className="text-[10px] text-slate-600 font-mono mt-1">ID: {ad.id}</p>
                    </td>
                    <td className="p-4 text-[11px] text-slate-400">
                      {ad.placementIds.length > 0
                        ? ad.placementIds.map((id) => placementMap.get(id) || id).join(', ')
                        : 'No placements'}
                    </td>
                    <td className="p-4 text-[11px] text-slate-400">{ad.creativeIds.length}</td>
                    <td className="p-4">
                      <span className={`text-[10px] font-bold uppercase ${ad.active ? 'text-emerald-500' : 'text-amber-500'}`}>
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
        )}
      </div>
    </div>
  );
};

export default AdGrid;
