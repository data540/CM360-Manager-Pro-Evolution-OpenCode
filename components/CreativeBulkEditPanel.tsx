
import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { Campaign, Creative, Site } from '../types';
import { X, Search, ChevronLeft, ChevronsRight, Loader2, CheckSquare } from 'lucide-react';
import { applyBulkNamingConfig, BulkNamingConfig } from './BulkNamingModal';

interface ToastPayload {
  show: boolean;
  type: 'success' | 'error' | 'loading';
  message: string;
  details?: string;
  link?: string;
}

interface CreativeBulkEditPanelProps {
  onClose: () => void;
  onToast: (toast: ToastPayload) => void;
  initialSelectedCreativeIds?: string[];
}

const CreativeBulkEditPanel: React.FC<CreativeBulkEditPanelProps> = ({ onClose, onToast, initialSelectedCreativeIds }) => {
  const {
    selectedAdvertiser,
    campaigns, fetchCampaigns,
    ads, fetchAds,
    creatives, fetchCreatives,
    placements, fetchPlacements,
    sites, fetchSites,
    creativesDrafts, updateCreativeDraft,
    publishSelectedCreativeDrafts,
    landingPages, fetchLandingPages,
  } = useApp();

  const [step, setStep] = useState<'search' | 'edit'>('search');

  const [campaignQuery, setCampaignQuery] = useState('');
  const [isCampaignDropdownOpen, setIsCampaignDropdownOpen] = useState(false);
  const [selectedEditCampaign, setSelectedEditCampaign] = useState<Campaign | null>(null);
  const [isLoadingCampaignData, setIsLoadingCampaignData] = useState(false);

  const [nameFilter, setNameFilter] = useState('');
  const [siteFilterIds, setSiteFilterIds] = useState<Set<string>>(new Set());
  const [sizeFilterValues, setSizeFilterValues] = useState<Set<string>>(new Set());

  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());

  const [nameEnabled, setNameEnabled] = useState(false);
  const [namingConfig, setNamingConfig] = useState<BulkNamingConfig>({ mode: 'replace', value: '', replaceFrom: '', separator: '_' });
  const [startEnabled, setStartEnabled] = useState(false);
  const [startDateValue, setStartDateValue] = useState('');
  const [startTimeValue, setStartTimeValue] = useState('00:00');
  const [endEnabled, setEndEnabled] = useState(false);
  const [endDateValue, setEndDateValue] = useState('');
  const [landingEnabled, setLandingEnabled] = useState(false);
  const [landingMode, setLandingMode] = useState<'list' | 'manual'>('list');
  const [landingPageId, setLandingPageId] = useState('');
  const [landingUrl, setLandingUrl] = useState('');

  const [isPublishing, setIsPublishing] = useState(false);

  useEffect(() => {
    if (selectedAdvertiser) {
      fetchCampaigns(selectedAdvertiser.id);
      fetchLandingPages(selectedAdvertiser.id);
    }
  }, [selectedAdvertiser]);

  // Direct-selection entry point: opened from CreativeGrid with a pre-made
  // multiselection, skipping the internal campaign search step.
  useEffect(() => {
    if (initialSelectedCreativeIds && initialSelectedCreativeIds.length > 0) {
      setSelectedRowIds(new Set(initialSelectedCreativeIds));
      setStep('edit');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const campaignMatches = useMemo(() => {
    if (!campaignQuery.trim()) return [];
    const q = campaignQuery.toLowerCase();
    return campaigns.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 15);
  }, [campaigns, campaignQuery]);

  const handlePickCampaign = async (campaign: Campaign) => {
    setSelectedEditCampaign(campaign);
    setCampaignQuery(campaign.name);
    setIsCampaignDropdownOpen(false);
    setSelectedRowIds(new Set());
    setNameFilter('');
    setSiteFilterIds(new Set());
    setSizeFilterValues(new Set());
    setIsLoadingCampaignData(true);
    try {
      await Promise.all([
        fetchAds(campaign.id),
        fetchPlacements(campaign.id),
        fetchSites(),
        fetchCreatives(),
      ]);
    } finally {
      setIsLoadingCampaignData(false);
    }
  };

  const campaignAdsForEdit = selectedEditCampaign
    ? ads.filter((ad) => ad.campaignId === selectedEditCampaign.id)
    : [];

  const campaignCreativeIds = useMemo(
    () => new Set(campaignAdsForEdit.flatMap((ad) => ad.creativeIds)),
    [campaignAdsForEdit]
  );

  const campaignPlacementsForEdit = selectedEditCampaign
    ? placements.filter((p) => p.campaignId === selectedEditCampaign.id)
    : [];

  const placementById = useMemo(
    () => new Map(campaignPlacementsForEdit.map((p) => [p.id, p])),
    [campaignPlacementsForEdit]
  );

  const candidateCreatives: Creative[] = useMemo(() => {
    if (!selectedEditCampaign) return [];
    return creatives.filter((c) => campaignCreativeIds.has(c.id));
  }, [creatives, campaignCreativeIds, selectedEditCampaign]);

  const creativeSiteIds = (creative: Creative): string[] => {
    const siteIds = new Set<string>();
    creative.placementIds.forEach((pid) => {
      const placement = placementById.get(pid);
      if (placement) siteIds.add(placement.siteId);
    });
    return Array.from(siteIds);
  };

  const availableSites: Site[] = useMemo(() => {
    const ids = new Set<string>();
    candidateCreatives.forEach((c) => creativeSiteIds(c).forEach((id) => ids.add(id)));
    return sites.filter((s) => ids.has(s.id));
  }, [candidateCreatives, sites, placementById]);

  const availableSizes: string[] = useMemo(() => {
    const set = new Set<string>();
    candidateCreatives.forEach((c) => { if (c.size) set.add(c.size); });
    return Array.from(set).sort();
  }, [candidateCreatives]);

  const filteredCreatives = useMemo(() => {
    return candidateCreatives.filter((c) => {
      if (nameFilter && !c.name.toLowerCase().includes(nameFilter.toLowerCase())) return false;
      if (siteFilterIds.size > 0) {
        const cSites = creativeSiteIds(c);
        if (!cSites.some((id) => siteFilterIds.has(id))) return false;
      }
      if (sizeFilterValues.size > 0 && !sizeFilterValues.has(c.size)) return false;
      return true;
    });
  }, [candidateCreatives, nameFilter, siteFilterIds, sizeFilterValues, placementById]);

  const toggleRow = (id: string) => {
    setSelectedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllFiltered = () => {
    setSelectedRowIds((prev) => {
      if (filteredCreatives.length > 0 && filteredCreatives.every((c) => prev.has(c.id))) {
        const next = new Set(prev);
        filteredCreatives.forEach((c) => next.delete(c.id));
        return next;
      }
      const next = new Set(prev);
      filteredCreatives.forEach((c) => next.add(c.id));
      return next;
    });
  };

  // Sourced from the full `creatives` list (not `candidateCreatives`) so that a
  // direct selection coming from CreativeGrid works even without a picked campaign.
  const selectedCreativesList = useMemo(
    () => creatives.filter((c) => selectedRowIds.has(c.id)),
    [creatives, selectedRowIds]
  );

  const namePreview = useMemo(() => {
    if (!nameEnabled) return [];
    return selectedCreativesList.slice(0, 8).map((c) => ({
      id: c.id,
      name: c.name,
      newName: applyBulkNamingConfig(c.name, namingConfig),
    }));
  }, [nameEnabled, selectedCreativesList, namingConfig]);

  const anyFieldEnabled = nameEnabled || startEnabled || endEnabled || landingEnabled;

  const handleApply = () => {
    if (selectedRowIds.size === 0 || !anyFieldEnabled) return;

    let appliedTo = 0;
    selectedCreativesList.forEach((creative) => {
      const changes: Partial<Creative> = {};

      if (nameEnabled) {
        const newName = applyBulkNamingConfig(creative.name, namingConfig);
        if (newName !== creative.name) changes.name = newName;
      }

      if (startEnabled && startDateValue) {
        changes.startDate = startDateValue;
        changes.startTime = startTimeValue || '00:00';
      }

      if (endEnabled && endDateValue) {
        changes.endDate = endDateValue;
      }

      if (landingEnabled) {
        if (landingMode === 'list' && landingPageId) {
          const lp = landingPages.find((l) => l.id === landingPageId);
          changes.landingPageId = landingPageId;
          changes.landingPageUrl = lp?.url;
        } else if (landingMode === 'manual' && landingUrl) {
          changes.landingPageUrl = landingUrl;
          changes.landingPageId = undefined;
        }
      }

      if (Object.keys(changes).length > 0) {
        updateCreativeDraft(creative.id, changes);
        appliedTo++;
      }
    });

    onToast({
      show: true,
      type: 'success',
      message: `Draft changes applied to ${appliedTo} creatives`,
      details: 'Review and publish to push these changes to CM360.',
    });
  };

  const draftedSelectedCount = selectedCreativesList.filter((c) => !!creativesDrafts[c.id]).length;

  const handlePublish = async () => {
    const idsToPublish = selectedCreativesList.filter((c) => !!creativesDrafts[c.id]).map((c) => c.id);
    if (idsToPublish.length === 0) {
      onToast({ show: true, type: 'error', message: 'No changes to publish', details: 'Apply field changes first.' });
      return;
    }

    setIsPublishing(true);
    onToast({ show: true, type: 'loading', message: `Publishing ${idsToPublish.length} creative changes...` });
    const result = await publishSelectedCreativeDrafts(idsToPublish);
    setIsPublishing(false);

    onToast({
      show: true,
      type: result.failed === 0 ? 'success' : 'error',
      message: result.failed === 0 ? `Published ${result.success} creatives` : `Published ${result.success}, failed ${result.failed}`,
      details: result.failed > 0 ? (result.results.find((r) => !r.success)?.error || 'CM360 rejected one or more updates.') : undefined,
    });

    if (result.failed === 0) {
      onClose();
    }
  };

  if (!selectedAdvertiser) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 w-full max-w-md shadow-2xl text-center">
          <p className="text-slate-300 text-sm mb-4">Select an Advertiser first to bulk edit its creatives.</p>
          <button onClick={onClose} className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-sm">Close</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-start sm:items-center justify-center p-4 overflow-y-auto bg-slate-950/80 backdrop-blur-sm">
      <div className="my-4 max-h-[calc(100vh-2rem)] overflow-y-auto custom-scrollbar bg-slate-900 border border-slate-800 rounded-3xl p-8 w-full max-w-5xl shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            {step === 'edit' && (
              <button onClick={() => setStep('search')} className="text-slate-500 hover:text-white transition-colors">
                <ChevronLeft className="w-5 h-5" />
              </button>
            )}
            <h3 className="text-xl font-bold text-white">
              {step === 'search' ? 'Bulk Edit Creatives' : `Edit ${selectedRowIds.size} Creative${selectedRowIds.size === 1 ? '' : 's'}`}
            </h3>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {step === 'search' && (
          <>
            <p className="text-slate-400 text-sm mb-5">Search a campaign, filter its creatives, then select the rows you want to edit in bulk.</p>

            <div className="relative mb-4">
              <label className="block text-[10px] uppercase font-bold text-slate-500 mb-2">Campaign</label>
              <div className="relative">
                <Search className="absolute left-3 top-3 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  value={campaignQuery}
                  onChange={(e) => {
                    setCampaignQuery(e.target.value);
                    setIsCampaignDropdownOpen(true);
                    if (selectedEditCampaign && e.target.value !== selectedEditCampaign.name) {
                      setSelectedEditCampaign(null);
                    }
                  }}
                  onFocus={() => setIsCampaignDropdownOpen(true)}
                  placeholder="Search campaign by name..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500 transition-all"
                />
              </div>
              {isCampaignDropdownOpen && campaignMatches.length > 0 && (
                <div className="absolute z-[130] mt-1 w-full bg-slate-900 border border-slate-800 rounded-xl shadow-2xl max-h-56 overflow-y-auto custom-scrollbar">
                  {campaignMatches.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => handlePickCampaign(c)}
                      className="w-full text-left px-4 py-2.5 text-sm text-slate-300 hover:bg-blue-600 hover:text-white transition-colors"
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {isLoadingCampaignData && (
              <div className="flex items-center justify-center gap-2 text-slate-400 text-sm py-10">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading campaign creatives...
              </div>
            )}

            {!isLoadingCampaignData && selectedEditCampaign && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4 p-4 bg-slate-950 rounded-2xl border border-slate-800">
                  <div>
                    <label className="block text-[9px] uppercase font-bold text-slate-600 mb-1">Creative Name</label>
                    <input
                      type="text"
                      value={nameFilter}
                      onChange={(e) => setNameFilter(e.target.value)}
                      placeholder="Filter by name..."
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] uppercase font-bold text-slate-600 mb-1">Site {siteFilterIds.size > 0 && `(${siteFilterIds.size})`}</label>
                    <div className="flex flex-wrap gap-1 max-h-16 overflow-y-auto custom-scrollbar">
                      {availableSites.length === 0 && <span className="text-[10px] text-slate-600">No Sites found</span>}
                      {availableSites.map((site) => {
                        const checked = siteFilterIds.has(site.id);
                        return (
                          <button
                            key={site.id}
                            onClick={() => setSiteFilterIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(site.id)) next.delete(site.id); else next.add(site.id);
                              return next;
                            })}
                            className={`px-2 py-1 rounded-md text-[10px] font-semibold border transition-all ${checked ? 'bg-blue-600/20 border-blue-500 text-blue-300' : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300'}`}
                          >
                            {site.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <label className="block text-[9px] uppercase font-bold text-slate-600 mb-1">Dimensions {sizeFilterValues.size > 0 && `(${sizeFilterValues.size})`}</label>
                    <div className="flex flex-wrap gap-1 max-h-16 overflow-y-auto custom-scrollbar">
                      {availableSizes.length === 0 && <span className="text-[10px] text-slate-600">No sizes found</span>}
                      {availableSizes.map((size) => {
                        const checked = sizeFilterValues.has(size);
                        return (
                          <button
                            key={size}
                            onClick={() => setSizeFilterValues((prev) => {
                              const next = new Set(prev);
                              if (next.has(size)) next.delete(size); else next.add(size);
                              return next;
                            })}
                            className={`px-2 py-1 rounded-md text-[10px] font-semibold border transition-all font-mono ${checked ? 'bg-blue-600/20 border-blue-500 text-blue-300' : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300'}`}
                          >
                            {size}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="border border-slate-800 rounded-2xl overflow-hidden mb-4">
                  <div className="flex items-center gap-3 px-4 py-2.5 bg-slate-950 border-b border-slate-800">
                    <input
                      type="checkbox"
                      className="accent-blue-500"
                      checked={filteredCreatives.length > 0 && filteredCreatives.every((c) => selectedRowIds.has(c.id))}
                      onChange={toggleSelectAllFiltered}
                    />
                    <span className="text-[10px] uppercase font-bold text-slate-500">{filteredCreatives.length} results · {selectedRowIds.size} selected</span>
                  </div>
                  <div className="max-h-72 overflow-y-auto custom-scrollbar divide-y divide-slate-800/60">
                    {filteredCreatives.length === 0 ? (
                      <p className="text-center text-sm text-slate-600 py-8">No creatives match these filters.</p>
                    ) : filteredCreatives.map((creative) => {
                      const checked = selectedRowIds.has(creative.id);
                      const creativeSites = creativeSiteIds(creative).map((id) => sites.find((s) => s.id === id)?.name).filter(Boolean).join(', ');
                      return (
                        <label key={creative.id} className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${checked ? 'bg-blue-600/10' : 'hover:bg-slate-800/40'}`}>
                          <input type="checkbox" className="accent-blue-500" checked={checked} onChange={() => toggleRow(creative.id)} />
                          <span className="flex-1 min-w-0 text-xs text-slate-200 truncate">{creative.name}</span>
                          <span className="text-[10px] font-mono text-slate-500 w-20 text-right">{creative.size}</span>
                          <span className="text-[10px] text-slate-500 w-32 truncate text-right">{creativeSites || 'N/A'}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </>
            )}

            <div className="flex gap-3 pt-2">
              <button onClick={onClose} className="flex-1 py-3 text-slate-400 hover:text-white font-bold transition-all">Cancel</button>
              <button
                onClick={() => setStep('edit')}
                disabled={selectedRowIds.size === 0}
                className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold transition-all shadow-lg shadow-blue-600/20 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                Edit {selectedRowIds.size} selected <ChevronsRight className="w-4 h-4" />
              </button>
            </div>
          </>
        )}

        {step === 'edit' && (
          <>
            <p className="text-slate-400 text-sm mb-5">Turn on each field you want to change, then Apply. Applied changes stay as local drafts until you Publish them to CM360.</p>

            <div className="space-y-3">
              {/* Name */}
              <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800">
                <label className="flex items-center gap-3 cursor-pointer mb-3">
                  <input type="checkbox" className="accent-blue-500 w-4 h-4" checked={nameEnabled} onChange={(e) => setNameEnabled(e.target.checked)} />
                  <span className="text-sm font-bold text-white">Name</span>
                </label>
                {nameEnabled && (
                  <div className="pl-7 space-y-3">
                    <div className="flex p-1 bg-slate-900 rounded-xl border border-slate-800 w-fit">
                      {(['replace', 'prefix', 'suffix'] as const).map((mode) => (
                        <button
                          key={mode}
                          onClick={() => setNamingConfig((c) => ({ ...c, mode }))}
                          className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${namingConfig.mode === mode ? 'bg-blue-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                        >
                          {mode === 'replace' ? 'Find & Replace' : mode.charAt(0).toUpperCase() + mode.slice(1)}
                        </button>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-2 max-w-md">
                      {namingConfig.mode === 'replace' && (
                        <div>
                          <label className="block text-[9px] uppercase font-bold text-slate-600 mb-1">Find</label>
                          <input
                            type="text"
                            value={namingConfig.replaceFrom || ''}
                            onChange={(e) => setNamingConfig((c) => ({ ...c, replaceFrom: e.target.value }))}
                            className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                          />
                        </div>
                      )}
                      <div>
                        <label className="block text-[9px] uppercase font-bold text-slate-600 mb-1">{namingConfig.mode === 'replace' ? 'Replace With' : 'Text'}</label>
                        <input
                          type="text"
                          value={namingConfig.value}
                          onChange={(e) => setNamingConfig((c) => ({ ...c, value: e.target.value }))}
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                        />
                      </div>
                    </div>
                    {namePreview.length > 0 && (
                      <div className="bg-slate-900/60 rounded-lg border border-slate-800 p-2 max-h-32 overflow-y-auto custom-scrollbar">
                        {namePreview.map((p) => (
                          <div key={p.id} className={`flex items-center gap-2 text-[10px] py-0.5 ${p.name === p.newName ? 'opacity-40' : ''}`}>
                            <span className="font-mono text-slate-500 truncate flex-1">{p.name}</span>
                            <ChevronsRight className="w-3 h-3 text-blue-500 shrink-0" />
                            <span className="font-mono text-blue-400 truncate flex-1">{p.newName}</span>
                          </div>
                        ))}
                        {selectedRowIds.size > namePreview.length && (
                          <p className="text-[9px] text-slate-600 text-center mt-1">...and {selectedRowIds.size - namePreview.length} more</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Start Date/Time */}
              <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800">
                <label className="flex items-center gap-3 cursor-pointer mb-3">
                  <input type="checkbox" className="accent-blue-500 w-4 h-4" checked={startEnabled} onChange={(e) => setStartEnabled(e.target.checked)} />
                  <span className="text-sm font-bold text-white">Start date</span>
                </label>
                {startEnabled && (
                  <div className="pl-7 flex gap-3">
                    <div>
                      <label className="block text-[9px] uppercase font-bold text-slate-600 mb-1">Start date</label>
                      <input
                        type="date"
                        value={startDateValue}
                        onChange={(e) => setStartDateValue(e.target.value)}
                        className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] uppercase font-bold text-slate-600 mb-1">Start time</label>
                      <input
                        type="time"
                        value={startTimeValue}
                        onChange={(e) => setStartTimeValue(e.target.value)}
                        className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>
                )}
                <p className="pl-7 text-[9px] text-slate-600 mt-2">Applied to the Start Time of every Ad this creative is assigned to in CM360.</p>
              </div>

              {/* End Date */}
              <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800">
                <label className="flex items-center gap-3 cursor-pointer mb-3">
                  <input type="checkbox" className="accent-blue-500 w-4 h-4" checked={endEnabled} onChange={(e) => setEndEnabled(e.target.checked)} />
                  <span className="text-sm font-bold text-white">End date</span>
                </label>
                {endEnabled && (
                  <div className="pl-7">
                    <input
                      type="date"
                      value={endDateValue}
                      onChange={(e) => setEndDateValue(e.target.value)}
                      className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                )}
                <p className="pl-7 text-[9px] text-slate-600 mt-2">Applied to the End Time of every Ad this creative is assigned to in CM360.</p>
              </div>

              {/* Landing Page */}
              <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800">
                <label className="flex items-center gap-3 cursor-pointer mb-3">
                  <input type="checkbox" className="accent-blue-500 w-4 h-4" checked={landingEnabled} onChange={(e) => setLandingEnabled(e.target.checked)} />
                  <span className="text-sm font-bold text-white">Landing page</span>
                </label>
                {landingEnabled && (
                  <div className="pl-7 space-y-3">
                    <div className="flex p-1 bg-slate-900 rounded-xl border border-slate-800 w-fit">
                      <button
                        onClick={() => setLandingMode('list')}
                        className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${landingMode === 'list' ? 'bg-blue-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                      >
                        From list
                      </button>
                      <button
                        onClick={() => setLandingMode('manual')}
                        className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${landingMode === 'manual' ? 'bg-blue-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                      >
                        Manual URL
                      </button>
                    </div>
                    {landingMode === 'list' ? (
                      <select
                        value={landingPageId}
                        onChange={(e) => setLandingPageId(e.target.value)}
                        className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                      >
                        <option value="">Select landing page...</option>
                        {landingPages.map((lp) => (
                          <option key={lp.id} value={lp.id}>{lp.name}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={landingUrl}
                        onChange={(e) => setLandingUrl(e.target.value)}
                        placeholder="https://..."
                        className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                      />
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-800">
              <span className="text-xs text-slate-500">
                {draftedSelectedCount > 0 ? `${draftedSelectedCount} of ${selectedRowIds.size} selected have pending draft changes` : 'No draft changes applied yet'}
              </span>
              <div className="flex gap-3">
                <button
                  onClick={handleApply}
                  disabled={!anyFieldEnabled}
                  className="px-6 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-bold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  <CheckSquare className="w-4 h-4" /> Apply to {selectedRowIds.size} rows
                </button>
                <button
                  onClick={handlePublish}
                  disabled={draftedSelectedCount === 0 || isPublishing}
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {isPublishing && <Loader2 className="w-4 h-4 animate-spin" />} Publish {draftedSelectedCount} to CM360
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default CreativeBulkEditPanel;
