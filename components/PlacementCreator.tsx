
import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { CM360_SIZES, PLACEMENT_STRATEGIES, NAMING_TAXONOMY } from '../constants';
import { X, Plus, Layers, Check, Info, Calendar, Globe, Settings2, Tag, AlertCircle } from 'lucide-react';
import { Placement } from '../types';

interface PlacementCreatorProps {
  onClose: () => void;
}

const PlacementCreator: React.FC<PlacementCreatorProps> = ({ onClose }) => {
  const { selectedCampaign, sites, addPlacements } = useApp();
  const todayISO = useMemo(() => new Date().toISOString().split('T')[0], []);
  const plus30DaysISO = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().split('T')[0];
  }, []);
  
  // Naming Parts
  const [naming, setNaming] = useState({
    brand: 'ae',
    iso: NAMING_TAXONOMY.ISO[0],
    site: NAMING_TAXONOMY.Sites[0],
    campaña: NAMING_TAXONOMY.Campañas[0],
    canal: NAMING_TAXONOMY.Canales[0],
    funnel: NAMING_TAXONOMY.Funnel[0],
    tech: NAMING_TAXONOMY.Tech[0],
    device: NAMING_TAXONOMY.Device[0],
    format: NAMING_TAXONOMY.Formats[0]
  });

  const [enabledFields, setEnabledFields] = useState<Record<keyof typeof naming, boolean>>({
    brand: true,
    iso: true,
    site: true,
    campaña: true,
    canal: true,
    funnel: true,
    tech: true,
    device: true,
    format: true
  });

  const [selectedSiteId, setSelectedSiteId] = useState('');
  const [creationMode, setCreationMode] = useState<'taxonomy' | 'plain'>('taxonomy');
  const [plainTextNames, setPlainTextNames] = useState('');
  const [type, setType] = useState<'Display' | 'Video' | 'Native'>('Display');
  const [compatibility, setCompatibility] = useState<'DISPLAY' | 'DISPLAY_INTERSTITIAL' | 'IN_STREAM_VIDEO' | 'IN_STREAM_AUDIO'>('DISPLAY');

  useEffect(() => {
    // Auto-adjust compatibility when type changes
    if (type === 'Video') setCompatibility('IN_STREAM_VIDEO');
    else setCompatibility('DISPLAY');
  }, [type]);

  useEffect(() => {
    if (creationMode !== 'plain' && sites.length > 0 && !selectedSiteId) {
      setSelectedSiteId(sites[0].id);
    }
  }, [sites, selectedSiteId, creationMode]);
  const [selectedSizes, setSelectedSizes] = useState<string[]>([]);
  const [startDate, setStartDate] = useState(todayISO);
  const [endDate, setEndDate] = useState(selectedCampaign?.endDate || plus30DaysISO);
  const [createdInSession, setCreatedInSession] = useState<Placement[]>([]);

  const namePrefix = useMemo(() => {
    const { brand, iso, site, campaña, canal, funnel, tech, device, format } = naming;
    const parts: string[] = [];

    const hasBrand = enabledFields.brand;
    const hasIso = enabledFields.iso;
    if (hasBrand && hasIso) {
      parts.push(`${brand}-${iso}`);
    } else {
      if (hasBrand) parts.push(brand);
      if (hasIso) parts.push(iso);
    }

    if (enabledFields.site) parts.push(site);
    if (enabledFields.campaña) parts.push(campaña);
    if (enabledFields.canal) parts.push(canal);
    if (enabledFields.funnel) parts.push(funnel);
    if (enabledFields.tech) parts.push(tech);
    if (enabledFields.device) parts.push(device);
    if (enabledFields.format) parts.push(format);
    
    return parts.join('_');
  }, [naming, enabledFields]);

  const toggleSize = (size: string) => {
    setSelectedSizes(prev => 
      prev.includes(size) ? prev.filter(s => s !== size) : [...prev, size]
    );
  };

  const normalizeToken = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

  const detectSize = (name: string) => {
    const match = name.match(/(\d+)\s*[x×]\s*(\d+)/i);
    if (!match) return null;
    return `${parseInt(match[1], 10)}x${parseInt(match[2], 10)}`;
  };

  const detectTypeAndCompatibility = (fullName: string): { type: 'Display' | 'Video' | 'Native'; compatibility: 'DISPLAY' | 'DISPLAY_INTERSTITIAL' | 'IN_STREAM_VIDEO' | 'IN_STREAM_AUDIO' } => {
    const parts = fullName.split('_').filter(Boolean);
    const formatToken = (parts[4] || '').toLowerCase();

    if (formatToken.includes('vid') || formatToken.includes('instream')) {
      return { type: 'Video', compatibility: 'IN_STREAM_VIDEO' };
    }
    if (formatToken.includes('nat')) {
      return { type: 'Native', compatibility: 'DISPLAY' };
    }
    return { type: 'Display', compatibility: 'DISPLAY' };
  };

  const extractTechToken = (fullName: string) => {
    const parts = fullName.split('_').filter(Boolean);
    // Naming schema: brand-iso, site, campaign, channel, funnel, tech, device, format, size
    // Tech is the 7th taxonomy field but token index 5 because brand+iso are combined.
    const byPosition = parts[5] || '';

    const normalizedTechOptions = new Set(NAMING_TAXONOMY.Tech.map((value) => normalizeToken(value)));
    const byCatalog = parts.find((token) => normalizedTechOptions.has(normalizeToken(token))) || '';

    return byCatalog || byPosition;
  };

  const findSiteIdFromName = (fullName: string): { siteId: string | null; source: 'tech-match' | 'no-match'; techToken: string } => {
    const parts = fullName.split('_').filter(Boolean);
    const techToken = extractTechToken(fullName);
    const normalizedTechToken = normalizeToken(techToken);
    if (!normalizedTechToken) {
      return { siteId: null, source: 'no-match', techToken };
    }

    const scored = sites
      .map((site) => {
        const normalizedSiteName = normalizeToken(site.name);
        if (!normalizedSiteName) return { site, score: 0 };
        if (normalizedSiteName === normalizedTechToken) return { site, score: 100 };
        if (normalizedSiteName.startsWith(normalizedTechToken)) return { site, score: 90 };
        if (normalizedSiteName.includes(normalizedTechToken)) return { site, score: 70 };
        if (normalizedTechToken.includes(normalizedSiteName)) return { site, score: 60 };
        return { site, score: 0 };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);

    if (scored.length > 0) {
      return { siteId: scored[0].site.id, source: 'tech-match', techToken };
    }

    return { siteId: null, source: 'no-match', techToken };
  };

  const parsedPlainRows = useMemo(() => {
    const rows = plainTextNames
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const normalizedName = line.endsWith('_') ? line : `${line}_`;
        const size = detectSize(normalizedName);
        const detected = detectTypeAndCompatibility(normalizedName);
        const siteMatch = findSiteIdFromName(normalizedName);
        const siteId = siteMatch.siteId;
        const siteName = sites.find((site) => site.id === siteId)?.name || '';
        return {
          sourceName: line,
          normalizedName,
          size,
          type: detected.type,
          compatibility: detected.compatibility,
          techToken: siteMatch.techToken,
          siteSource: siteMatch.source,
          siteId,
          siteName,
          isValid: !!(size && (siteId || selectedSiteId)),
        };
      });
    return rows;
  }, [plainTextNames, sites, selectedSiteId]);

  useEffect(() => {
    if (creationMode !== 'plain') return;
    if (parsedPlainRows.length === 0) {
      if (selectedSiteId) setSelectedSiteId('');
      return;
    }

    const firstMatched = parsedPlainRows.find((row) => row.siteId && row.siteSource === 'tech-match');
    if (firstMatched?.siteId) {
      if (firstMatched.siteId !== selectedSiteId) {
        setSelectedSiteId(firstMatched.siteId);
      }
      return;
    }

    if (selectedSiteId) {
      setSelectedSiteId('');
    }
  }, [creationMode, parsedPlainRows, selectedSiteId]);

  const handleCreate = () => {
    if (!selectedCampaign) return;

    if (creationMode === 'plain') {
      if (parsedPlainRows.length === 0) return;

      const validRows = parsedPlainRows.filter((row) => row.isValid);
      const invalidRows = parsedPlainRows.filter((row) => !row.isValid);

      if (validRows.length === 0) {
        alert('No valid plain-text placements detected. Ensure each line includes a size (e.g. 728x90) and a site token that matches CM360 sites.');
        return;
      }

      const now = new Date().toISOString().split('T')[0];
      const newPlacements: Placement[] = validRows.map((row) => ({
        id: `plc-${Math.random().toString(36).substr(2, 9)}`,
        campaignId: selectedCampaign.id,
        name: row.normalizedName,
        siteId: (row.siteId || selectedSiteId)!,
        size: row.size!,
        type: row.type,
        compatibility: row.compatibility,
        status: 'Draft',
        startDate,
        endDate,
        createdAt: now,
        updatedAt: now,
      }));

      addPlacements(newPlacements);
      setCreatedInSession((prev) => [...newPlacements, ...prev]);

      if (invalidRows.length > 0) {
        const remaining = invalidRows.map((row) => row.sourceName).join('\n');
        setPlainTextNames(remaining);
        alert(`Created ${validRows.length} placements. ${invalidRows.length} lines could not be created (missing size or unresolved CM360 site) and remain in the text box.`);
      } else {
        setPlainTextNames('');
      }
      return;
    }

    if (selectedSizes.length === 0) return;

    const newPlacements: Placement[] = selectedSizes.map(size => ({
      id: `plc-${Math.random().toString(36).substr(2, 9)}`,
      campaignId: selectedCampaign.id,
      name: `${namePrefix}_${size}_`,
      siteId: selectedSiteId,
      size: size,
      type: type,
      compatibility: compatibility,
      status: 'Draft',
      startDate: startDate,
      endDate: endDate,
      createdAt: new Date().toISOString().split('T')[0],
      updatedAt: new Date().toISOString().split('T')[0],
    }));

    addPlacements(newPlacements);
    setCreatedInSession(prev => [...newPlacements, ...prev]);
    setSelectedSizes([]);
  };

  const updateNaming = (key: keyof typeof naming, value: string) => {
    setNaming(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
      <div className="bg-slate-900 w-full max-w-6xl rounded-3xl border border-slate-800 shadow-2xl flex flex-col max-h-[95vh] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-600/20 rounded-xl flex items-center justify-center">
              <Plus className="w-6 h-6 text-emerald-500" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Taxonomy Placement Builder</h2>
              <p className="text-xs text-slate-500 mt-0.5">Build standardized CM360 names using official AdOps taxonomy</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Column 1: Taxonomy Selectors */}
          <div className="lg:col-span-2 space-y-6">
            <div className="flex p-1 bg-slate-950 rounded-xl border border-slate-800 max-w-md">
              <button
                onClick={() => setCreationMode('taxonomy')}
                className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${creationMode === 'taxonomy' ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'text-slate-500 hover:text-slate-300'}`}
              >
                Taxonomy Builder
              </button>
              <button
                onClick={() => setCreationMode('plain')}
                className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${creationMode === 'plain' ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'text-slate-500 hover:text-slate-300'}`}
              >
                Plain Text Import
              </button>
            </div>

            <section className="space-y-4">
              <h3 className="text-[10px] uppercase font-bold tracking-widest text-slate-500 flex items-center gap-2">
                <Tag className="w-3 h-3" /> {creationMode === 'taxonomy' ? 'Naming Taxonomy' : 'Plain Text Naming'}
              </h3>

              {creationMode === 'taxonomy' ? (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 bg-slate-950/50 p-6 rounded-2xl border border-slate-800">
                  {[
                    { key: 'brand', label: 'Brand', type: 'input' },
                    { key: 'iso', label: 'ISO (País)', type: 'select', options: NAMING_TAXONOMY.ISO },
                    { key: 'site', label: 'Site', type: 'select', options: NAMING_TAXONOMY.Sites },
                    { key: 'campaña', label: 'Campaña', type: 'select', options: NAMING_TAXONOMY.Campañas },
                    { key: 'canal', label: 'Canal', type: 'select', options: NAMING_TAXONOMY.Canales },
                    { key: 'funnel', label: 'Funnel', type: 'select', options: NAMING_TAXONOMY.Funnel },
                    { key: 'tech', label: 'Tech', type: 'select', options: NAMING_TAXONOMY.Tech },
                    { key: 'device', label: 'Device', type: 'select', options: NAMING_TAXONOMY.Device },
                    { key: 'format', label: 'Format', type: 'select', options: NAMING_TAXONOMY.Formats },
                  ].map((field) => (
                    <div key={field.key} className={`transition-opacity ${enabledFields[field.key as keyof typeof naming] ? 'opacity-100' : 'opacity-40'}`}>
                      <div className="flex items-center justify-between mb-1.5 ml-1">
                        <label className="block text-[10px] uppercase font-bold text-slate-500">{field.label}</label>
                        <input 
                          type="checkbox" 
                          checked={enabledFields[field.key as keyof typeof naming]}
                          onChange={() => setEnabledFields(prev => ({ ...prev, [field.key]: !prev[field.key as keyof typeof naming] }))}
                          className="w-3 h-3 rounded border-slate-700 bg-slate-900 text-blue-500 focus:ring-blue-500/50"
                        />
                      </div>
                      {field.type === 'input' ? (
                        <input 
                          type="text"
                          disabled={!enabledFields[field.key as keyof typeof naming]}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-blue-400 focus:outline-none focus:border-blue-500 transition-all font-mono disabled:cursor-not-allowed"
                          value={naming[field.key as keyof typeof naming]}
                          onChange={(e) => updateNaming(field.key as keyof typeof naming, e.target.value)}
                        />
                      ) : (
                        <select 
                          disabled={!enabledFields[field.key as keyof typeof naming]}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500 transition-all disabled:cursor-not-allowed"
                          value={naming[field.key as keyof typeof naming]}
                          onChange={(e) => updateNaming(field.key as keyof typeof naming, e.target.value)}
                        >
                          {field.options?.map(v => <option key={v} value={v}>{v.toUpperCase()}</option>)}
                        </select>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-3 bg-slate-950/50 p-6 rounded-2xl border border-slate-800">
                  <p className="text-xs text-slate-400">
                    Paste one placement name per line. Site and size are auto-detected from the naming string.
                  </p>
                  <textarea
                    value={plainTextNames}
                    onChange={(e) => setPlainTextNames(e.target.value)}
                    placeholder="ae-de_kpi360_panama-institucional_2026_dis_prs_dv360_desktop_gen_728x90_"
                    className="w-full min-h-[160px] bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-xs text-blue-300 font-mono focus:outline-none focus:border-blue-500"
                  />
                  {parsedPlainRows.length > 0 && (
                    <div className="space-y-2 max-h-[170px] overflow-y-auto custom-scrollbar pr-1">
                      {parsedPlainRows.map((row) => (
                        <div key={row.sourceName} className={`p-2 rounded-lg border text-[10px] ${row.isValid ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300' : 'border-amber-500/30 bg-amber-500/5 text-amber-300'}`}>
                          <p className="font-mono truncate">{row.normalizedName}</p>
                          <p className="mt-1 text-[9px]">
                            size: {row.size || 'not detected'} · tech: {row.techToken || 'n/a'} · site: {row.siteName || 'no site match'}
                            {row.siteSource === 'no-match' ? ' (requires CM360 Site Mapping selection)' : ''}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex items-start gap-2 p-2 bg-slate-900 border border-slate-800 rounded-lg text-[10px] text-slate-500">
                    <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>Rows without size or site match are skipped and kept in the text box for correction.</span>
                  </div>
                </div>
              )}
            </section>

            <div className="grid grid-cols-2 gap-8">
              <section className="space-y-4">
                <h3 className="text-[10px] uppercase font-bold tracking-widest text-slate-500 flex items-center gap-2">
                  <Globe className="w-3 h-3" /> CM360 Site Mapping
                </h3>
                {sites.length === 0 ? (
                  <div className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-500 italic">
                    Loading sites from CM360...
                  </div>
                ) : (
                  <select 
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-blue-500 transition-all"
                    value={selectedSiteId}
                    onChange={(e) => setSelectedSiteId(e.target.value)}
                  >
                    <option value="">Select CM360 site mapping</option>
                    {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                )}
              </section>

              <section className="space-y-4">
                <h3 className="text-[10px] uppercase font-bold tracking-widest text-slate-500 flex items-center gap-2">
                  <Calendar className="w-3 h-3" /> Flight Dates
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <input 
                    type="date"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500 transition-all"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                  <input 
                    type="date"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500 transition-all"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
              </section>
            </div>

            <div className="p-4 bg-blue-600/5 border border-blue-500/10 rounded-2xl">
               <div className="flex items-center gap-3 mb-2">
                  <Info className="w-4 h-4 text-blue-400" />
                  <span className="text-[10px] uppercase font-bold text-blue-400 tracking-widest">Naming Preview</span>
               </div>
               <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 font-mono text-xs text-blue-300 break-all leading-relaxed">
                  {creationMode === 'taxonomy'
                    ? <>{namePrefix}_<span className="text-slate-500">[SIZE]</span>_</>
                    : (parsedPlainRows[0]?.normalizedName || <span className="text-slate-500">Paste naming lines to preview...</span>)}
               </div>

               <div className="mt-4 pt-4 border-t border-slate-800/70">
                 <div className="flex items-center justify-between mb-2">
                   <span className="text-[10px] uppercase font-bold text-slate-500 tracking-widest">Created In This Session</span>
                   <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                     {createdInSession.length}
                   </span>
                 </div>

                 <div className="space-y-2 max-h-[160px] overflow-y-auto custom-scrollbar pr-2">
                   {createdInSession.length === 0 ? (
                     <p className="text-[10px] text-slate-600 italic">No placements added yet in this builder session.</p>
                   ) : (
                     createdInSession.map((placement) => (
                       <div key={placement.id} className="flex items-center gap-2 text-[10px] font-mono text-slate-400 bg-slate-950/60 p-2 rounded-lg border border-slate-800/70">
                         <Layers className="w-3 h-3 shrink-0 text-emerald-500" />
                         <span className="truncate">{placement.name}</span>
                       </div>
                     ))
                   )}
                 </div>
               </div>
            </div>
          </div>

          {/* Column 2: Format & Sizes */}
          <div className="space-y-6">
            {creationMode === 'taxonomy' ? (
              <section className="space-y-4">
                <h3 className="text-[10px] uppercase font-bold tracking-widest text-slate-500 flex items-center gap-2">
                  <Settings2 className="w-3 h-3" /> Format & Dimensions
                </h3>
                
                <div className="flex p-1 bg-slate-950 rounded-xl border border-slate-800 mb-4">
                  {(['Display', 'Video', 'Native'] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => { setType(t); setSelectedSizes([]); }}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
                        type === t ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>

                <div className="space-y-2 mb-6">
                  <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1.5 ml-1">Compatibility (Required for CM360)</label>
                  <select 
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500 transition-all font-bold"
                    value={compatibility}
                    onChange={(e) => setCompatibility(e.target.value as any)}
                  >
                    <option value="DISPLAY">Display</option>
                    <option value="DISPLAY_INTERSTITIAL">Display Interstitial</option>
                    <option value="IN_STREAM_VIDEO">In-Stream Video</option>
                    <option value="IN_STREAM_AUDIO">In-Stream Audio</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                  {CM360_SIZES[type].map(size => (
                    <button
                      key={size}
                      onClick={() => toggleSize(size)}
                      className={`p-3 rounded-xl border text-[11px] font-bold transition-all flex items-center justify-between ${
                        selectedSizes.includes(size) 
                          ? 'border-blue-500 bg-blue-600/10 text-blue-400' 
                          : 'border-slate-800 bg-slate-950 text-slate-500 hover:border-slate-700'
                      }`}
                    >
                      {size}
                      {selectedSizes.includes(size) && <Check className="w-3 h-3" />}
                    </button>
                  ))}
                </div>
              </section>
            ) : (
              <section className="space-y-4">
                <h3 className="text-[10px] uppercase font-bold tracking-widest text-slate-500 flex items-center gap-2">
                  <Settings2 className="w-3 h-3" /> Plain Text Detection
                </h3>
                <div className="p-4 bg-slate-950/50 rounded-2xl border border-slate-800 text-xs text-slate-400 leading-relaxed">
                  <p>In plain-text mode, <span className="text-blue-400 font-semibold">Format & Dimensions</span> are read from the naming string.</p>
                  <p className="mt-2">Site is resolved from token #7 (TECH). If no CM360 match is found, CM360 Site Mapping stays blank and must be selected manually.</p>
                </div>
              </section>
            )}

            <section className="pt-4 border-t border-slate-800">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-[10px] uppercase font-bold tracking-widest text-slate-500">Batch Summary</h3>
                <span className="text-[10px] font-bold text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                  {creationMode === 'taxonomy' ? selectedSizes.length : parsedPlainRows.filter((r) => r.isValid).length} Placements
                </span>
              </div>
              
              <div className="space-y-2 max-h-[150px] overflow-y-auto pr-2 custom-scrollbar">
                {(creationMode === 'taxonomy' ? selectedSizes.length === 0 : parsedPlainRows.length === 0) ? (
                    <p className="text-[10px] text-slate-600 italic text-center py-4">
                      {creationMode === 'taxonomy' ? 'Select dimensions to generate names...' : 'Paste names in plain-text mode to build the batch summary...'}
                    </p>
                  ) : (
                  creationMode === 'taxonomy'
                    ? selectedSizes.map(size => (
                        <div key={size} className="flex items-center gap-2 text-[9px] font-mono text-slate-500 bg-slate-950/50 p-2 rounded-lg border border-slate-800/50">
                          <Layers className="w-3 h-3 shrink-0" />
                          <span className="truncate">{namePrefix}_{size}_</span>
                        </div>
                      ))
                    : parsedPlainRows.map((row) => (
                        <div key={row.sourceName} className="flex items-center gap-2 text-[9px] font-mono text-slate-500 bg-slate-950/50 p-2 rounded-lg border border-slate-800/50">
                          <Layers className="w-3 h-3 shrink-0" />
                          <span className="truncate">{row.normalizedName}</span>
                        </div>
                      ))
                )}
              </div>
            </section>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-slate-800 bg-slate-900/50 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-500 uppercase font-bold tracking-tighter">Target Campaign</span>
              <span className="text-xs text-blue-400 font-bold truncate max-w-[200px]">{selectedCampaign?.name}</span>
            </div>
          </div>
          <div className="flex gap-3">
            <button 
              onClick={onClose}
              className="px-6 py-2.5 rounded-xl text-slate-400 hover:text-white transition-all font-bold text-sm"
            >
              Cancel
            </button>
            <button 
              onClick={handleCreate}
              disabled={creationMode === 'taxonomy' ? (selectedSizes.length === 0 || sites.length === 0) : (parsedPlainRows.length === 0 || (!selectedSiteId && parsedPlainRows.some((r) => !r.siteId)))}
              className="flex items-center gap-2 px-8 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-sm transition-all shadow-lg shadow-emerald-600/20 disabled:opacity-50 disabled:grayscale"
            >
              {creationMode === 'taxonomy' ? `Add ${selectedSizes.length} Placements` : `Add ${parsedPlainRows.filter((r) => r.isValid).length} Placements`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PlacementCreator;
