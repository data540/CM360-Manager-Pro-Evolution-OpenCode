
import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { CM360_SIZES, PLACEMENT_STRATEGIES } from '../constants';
import { X, Plus, Layers, Check, Info, Calendar, Globe, Settings2 } from 'lucide-react';
import { Placement } from '../types';

interface PlacementCreatorProps {
  onClose: () => void;
}

const PlacementCreator: React.FC<PlacementCreatorProps> = ({ onClose }) => {
  const { selectedCampaign, sites, addPlacements } = useApp();
  
  const [namePrefix, setNamePrefix] = useState('ES_PROMO');
  const [selectedSiteId, setSelectedSiteId] = useState(sites[0]?.id || '');
  const [type, setType] = useState<'Display' | 'Video' | 'Native'>('Display');
  const [selectedSizes, setSelectedSizes] = useState<string[]>([]);
  const [strategy, setStrategy] = useState(PLACEMENT_STRATEGIES[0]);
  const [startDate, setStartDate] = useState(selectedCampaign?.startDate || '');
  const [endDate, setEndDate] = useState(selectedCampaign?.endDate || '');

  const toggleSize = (size: string) => {
    setSelectedSizes(prev => 
      prev.includes(size) ? prev.filter(s => s !== size) : [...prev, size]
    );
  };

  const handleCreate = () => {
    if (!selectedCampaign || selectedSizes.length === 0) return;

    const newPlacements: Placement[] = selectedSizes.map(size => ({
      id: `plc-${Math.random().toString(36).substr(2, 9)}`,
      campaignId: selectedCampaign.id,
      name: `${namePrefix}_${size}_${strategy}`,
      siteId: selectedSiteId,
      size: size,
      type: type,
      status: 'Draft',
      startDate: startDate,
      endDate: endDate,
      createdAt: new Date().toISOString().split('T')[0],
      updatedAt: new Date().toISOString().split('T')[0],
    }));

    addPlacements(newPlacements);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
      <div className="bg-slate-900 w-full max-w-4xl rounded-3xl border border-slate-800 shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600/20 rounded-xl flex items-center justify-center">
              <Plus className="w-6 h-6 text-blue-500" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Advanced Placement Creator</h2>
              <p className="text-xs text-slate-500 mt-0.5">Configure and generate multiple placements at once</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-8 grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left Column: Config */}
          <div className="space-y-6">
            <section className="space-y-4">
              <h3 className="text-[10px] uppercase font-bold tracking-widest text-slate-500 flex items-center gap-2">
                <Globe className="w-3 h-3" /> General Configuration
              </h3>
              
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5 ml-1">Naming Prefix</label>
                  <input 
                    type="text"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-blue-400 focus:outline-none focus:border-blue-500 transition-all font-mono"
                    value={namePrefix}
                    onChange={(e) => setNamePrefix(e.target.value)}
                    placeholder="e.g. ES_BRAND_Q4"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5 ml-1">Site</label>
                    <select 
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-blue-500 transition-all"
                      value={selectedSiteId}
                      onChange={(e) => setSelectedSiteId(e.target.value)}
                    >
                      {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5 ml-1">Strategy</label>
                    <select 
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-blue-500 transition-all"
                      value={strategy}
                      onChange={(e) => setStrategy(e.target.value)}
                    >
                      {PLACEMENT_STRATEGIES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            </section>

            <section className="space-y-4">
              <h3 className="text-[10px] uppercase font-bold tracking-widest text-slate-500 flex items-center gap-2">
                <Calendar className="w-3 h-3" /> Flight Dates
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5 ml-1">Start Date</label>
                  <input 
                    type="date"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-blue-500 transition-all"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5 ml-1">End Date</label>
                  <input 
                    type="date"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-blue-500 transition-all"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
              </div>
            </section>

            <div className="p-4 bg-blue-600/5 border border-blue-500/10 rounded-2xl flex gap-3">
              <Info className="w-5 h-5 text-blue-400 shrink-0" />
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Placements will be created as <span className="text-blue-400 font-bold italic">Draft</span> status. 
                You can push them to CM360 after reviewing the naming convention.
              </p>
            </div>
          </div>

          {/* Right Column: Format & Sizes */}
          <div className="space-y-6">
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

              <div className="grid grid-cols-3 gap-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
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

            <section className="pt-4 border-t border-slate-800">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-[10px] uppercase font-bold tracking-widest text-slate-500">Preview Generation</h3>
                <span className="text-[10px] font-bold text-blue-500 bg-blue-500/10 px-2 py-0.5 rounded-full">
                  {selectedSizes.length} Placements
                </span>
              </div>
              
              <div className="space-y-2 max-h-[120px] overflow-y-auto pr-2 custom-scrollbar">
                {selectedSizes.length === 0 ? (
                  <p className="text-[10px] text-slate-600 italic text-center py-4">Select at least one size to see preview...</p>
                ) : (
                  selectedSizes.map(size => (
                    <div key={size} className="flex items-center gap-2 text-[10px] font-mono text-slate-500">
                      <Layers className="w-3 h-3" />
                      <span className="truncate">{namePrefix}_{size}_{strategy}</span>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-slate-800 bg-slate-900/50 flex justify-between items-center">
          <button 
            onClick={onClose}
            className="px-6 py-2.5 rounded-xl text-slate-400 hover:text-white transition-all font-bold text-sm"
          >
            Cancel
          </button>
          <button 
            onClick={handleCreate}
            disabled={selectedSizes.length === 0}
            className="flex items-center gap-2 px-8 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-sm transition-all shadow-lg shadow-blue-600/20 disabled:opacity-50 disabled:grayscale"
          >
            Create {selectedSizes.length} Placements
          </button>
        </div>
      </div>
    </div>
  );
};

export default PlacementCreator;
