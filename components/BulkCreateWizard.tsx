
import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { BatchItem, Placement } from '../types';
import { normalizeNamingRules } from '../services/gemini';
import { 
  X, ChevronRight, ChevronLeft, Check, AlertCircle, 
  Layers, Database, Wand2, Download, Plus, Trash2, Loader2
} from 'lucide-react';

interface BulkCreateWizardProps {
  onClose: () => void;
}

const BulkCreateWizard: React.FC<BulkCreateWizardProps> = ({ onClose }) => {
  const { selectedCampaign, selectedAdvertiser, sites, addPlacements } = useApp();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  
  // Step 1: Template
  const [type, setType] = useState<'Display' | 'Video' | 'Native'>('Display');
  
  // Step 2: Inputs
  const [rawInput, setRawInput] = useState('');
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  
  // Step 3: Naming
  const [namingPrefix, setNamingPrefix] = useState('ES');
  
  // Handlers
  const parseInputs = () => {
    const lines = rawInput.split('\n').filter(l => l.trim());
    const newItems: BatchItem[] = lines.map((line, idx) => {
      const parts = line.split('\t'); // Assume tab-separated (pasted from Excel)
      return {
        id: `batch-${idx}`,
        name: parts[0] || `Placement_${idx + 1}`,
        siteId: parts[1] || (sites.length > 0 ? sites[0].id : ''),
        size: parts[2] || '300x250',
        startDate: selectedCampaign?.startDate || '2024-01-01',
        endDate: selectedCampaign?.endDate || '2024-12-31',
        errors: []
      };
    });
    setBatchItems(newItems);
    setStep(3);
  };

  const handleMagicNormalize = async () => {
    setLoading(true);
    const names = batchItems.map(item => item.name);
    const normalized = await normalizeNamingRules(names);
    setBatchItems(prev => prev.map((item, idx) => ({
      ...item,
      name: normalized[idx] || item.name
    })));
    setLoading(false);
  };

  const validateItems = () => {
    const validated = batchItems.map(item => {
      const errors = [];
      if (!item.name) errors.push('Name is required');
      if (item.startDate > item.endDate) errors.push('Start date must be before end date');
      if (!item.size.includes('x') && type === 'Display') errors.push('Invalid size format');
      return { ...item, errors };
    });
    setBatchItems(validated);
    setStep(4);
  };

  const finalize = () => {
    if (!selectedCampaign) return;
    const newPlacements: Placement[] = batchItems.map(item => ({
      id: `plc-${Math.random().toString(36).substr(2, 9)}`,
      campaignId: selectedCampaign.id,
      name: `${namingPrefix}_${item.name}`,
      siteId: item.siteId,
      size: item.size,
      type: type,
      status: 'Draft',
      startDate: item.startDate,
      endDate: item.endDate,
      createdAt: new Date().toISOString().split('T')[0],
      updatedAt: new Date().toISOString().split('T')[0],
    }));
    addPlacements(newPlacements);
    setStep(5);
  };

  const steps = [
    { id: 1, label: 'Template' },
    { id: 2, label: 'Inputs' },
    { id: 3, label: 'Naming' },
    { id: 4, label: 'Review' },
    { id: 5, label: 'Success' }
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="bg-slate-900 w-full max-w-5xl rounded-2xl border border-slate-800 shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-900/50">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Layers className="w-5 h-5 text-blue-500" />
              Bulk Placement Builder
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Campaign: <span className="text-blue-400 font-bold">{selectedCampaign?.name || 'No campaign selected'}</span>
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Stepper */}
        <div className="px-6 py-4 bg-slate-950/30 border-b border-slate-800 flex justify-between">
          {steps.map((s) => (
            <div key={s.id} className="flex items-center gap-2">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                step >= s.id ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-500'
              }`}>
                {step > s.id ? <Check className="w-3.5 h-3.5" /> : s.id}
              </div>
              <span className={`text-[11px] font-bold uppercase tracking-wider ${
                step >= s.id ? 'text-slate-200' : 'text-slate-600'
              }`}>{s.label}</span>
              {s.id < 5 && <ChevronRight className="w-4 h-4 text-slate-700 mx-2" />}
            </div>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-8">
          
          {step === 1 && (
            <div className="max-w-2xl mx-auto space-y-6 animate-in slide-in-from-bottom-4">
              <h3 className="text-lg font-bold text-slate-200 text-center mb-8">Choose your placement type</h3>
              <div className="grid grid-cols-3 gap-4">
                {(['Display', 'Video', 'Native'] as const).map(t => (
                  <button 
                    key={t}
                    onClick={() => setType(t)}
                    className={`p-6 rounded-2xl border-2 transition-all text-center group ${
                      type === t ? 'border-blue-600 bg-blue-600/5' : 'border-slate-800 hover:border-slate-700 bg-slate-900'
                    }`}
                  >
                    <div className={`w-12 h-12 rounded-xl mx-auto mb-4 flex items-center justify-center ${
                      type === t ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-500 group-hover:text-slate-300'
                    }`}>
                      <Database className="w-6 h-6" />
                    </div>
                    <p className="font-bold text-slate-200">{t}</p>
                    <p className="text-[10px] text-slate-500 mt-2 uppercase tracking-tighter">Standard {t} Tags</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4 animate-in slide-in-from-bottom-4">
              <div className="flex justify-between items-end">
                <div>
                  <h3 className="text-lg font-bold text-slate-200">Paste Placement Data</h3>
                  <p className="text-xs text-slate-500">Copy/Paste from Excel or Google Sheets (Name | Site | Size)</p>
                </div>
                <button 
                  onClick={() => setRawInput('Youtube_Video_Hero\tsite-1\tVideo\nNYT_Article_Leader\tsite-2\t728x90')}
                  className="text-[10px] text-blue-400 font-bold uppercase hover:underline"
                >
                  Load Example Data
                </button>
              </div>
              <textarea 
                className="w-full h-64 bg-slate-950 border border-slate-800 rounded-xl p-4 font-mono text-sm text-blue-300 focus:outline-none focus:border-blue-500/50"
                placeholder="Site_A_300x250&#10;Site_B_728x90"
                value={rawInput}
                onChange={(e) => setRawInput(e.target.value)}
              />
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6 animate-in slide-in-from-bottom-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-slate-200">Naming & Normalization</h3>
                <button 
                  onClick={handleMagicNormalize}
                  disabled={loading}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition-all disabled:opacity-50"
                >
                  {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                  Magic Normalize (AI)
                </button>
              </div>
              
              <div className="bg-slate-950 rounded-xl border border-slate-800 overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-900 border-b border-slate-800 text-slate-500 uppercase font-bold tracking-wider">
                    <tr>
                      <th className="p-3 text-left">Input Name</th>
                      <th className="p-3 text-left">Preview (After Suffix)</th>
                      <th className="p-3 text-left">Site</th>
                      <th className="p-3 text-left">Size</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {batchItems.map((item, idx) => (
                      <tr key={item.id} className="hover:bg-slate-900/50">
                        <td className="p-3">
                          <input 
                            value={item.name}
                            onChange={(e) => {
                              const news = [...batchItems];
                              news[idx].name = e.target.value;
                              setBatchItems(news);
                            }}
                            className="bg-transparent border-b border-slate-800 focus:border-blue-500 focus:outline-none w-full text-blue-400"
                          />
                        </td>
                        <td className="p-3 text-slate-500 font-mono italic">
                          {namingPrefix}_{item.name}
                        </td>
                        <td className="p-3 text-slate-400">{item.siteId}</td>
                        <td className="p-3 text-slate-400">{item.size}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4 animate-in slide-in-from-bottom-4">
              <h3 className="text-lg font-bold text-slate-200">Pre-flight Validation</h3>
              <div className="space-y-2">
                {batchItems.map((item) => (
                  <div key={item.id} className={`p-4 rounded-xl border flex items-center justify-between ${
                    item.errors.length > 0 ? 'bg-rose-500/5 border-rose-500/20' : 'bg-emerald-500/5 border-emerald-500/20'
                  }`}>
                    <div className="flex items-center gap-3">
                      {item.errors.length > 0 ? (
                        <AlertCircle className="w-5 h-5 text-rose-500" />
                      ) : (
                        <Check className="w-5 h-5 text-emerald-500" />
                      )}
                      <div>
                        <p className="text-sm font-bold text-slate-200">{namingPrefix}_{item.name}</p>
                        {item.errors.map((err, i) => (
                          <p key={i} className="text-[10px] text-rose-400 font-medium">⚠️ {err}</p>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Type: {type}</span>
                      <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Size: {item.size}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="py-12 text-center space-y-6 animate-in zoom-in-95">
              <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto border-2 border-emerald-500/30">
                <Check className="w-10 h-10 text-emerald-500" />
              </div>
              <div>
                <h3 className="text-2xl font-bold text-white">Batch Created!</h3>
                <p className="text-slate-500 mt-2">Successfully added {batchItems.length} placements to campaign context.</p>
              </div>
              <div className="flex justify-center gap-4">
                <button 
                  onClick={onClose}
                  className="px-6 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-bold transition-all"
                >
                  Go to Grid
                </button>
                <button className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold transition-all flex items-center gap-2">
                  <Download className="w-4 h-4" />
                  Export for CM360
                </button>
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="p-6 border-t border-slate-800 bg-slate-900/50 flex justify-between items-center">
          <p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest">
            AdOps Validation Engine v1.0
          </p>
          <div className="flex gap-3">
            {step > 1 && step < 5 && (
              <button 
                onClick={() => setStep(step - 1)}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-slate-400 hover:text-white transition-all font-bold text-sm"
              >
                <ChevronLeft className="w-4 h-4" />
                Back
              </button>
            )}
            
            {step === 1 && (
              <button 
                onClick={() => setStep(2)}
                className="flex items-center gap-2 px-8 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-sm transition-all shadow-lg shadow-blue-600/20"
              >
                Continue to Inputs
                <ChevronRight className="w-4 h-4" />
              </button>
            )}

            {step === 2 && (
              <button 
                disabled={!rawInput.trim()}
                onClick={parseInputs}
                className="flex items-center gap-2 px-8 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-sm transition-all disabled:opacity-50"
              >
                Parse Data
                <ChevronRight className="w-4 h-4" />
              </button>
            )}

            {step === 3 && (
              <button 
                onClick={validateItems}
                className="flex items-center gap-2 px-8 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-sm transition-all"
              >
                Run Validation
                <ChevronRight className="w-4 h-4" />
              </button>
            )}

            {step === 4 && (
              <button 
                disabled={batchItems.some(item => item.errors.length > 0)}
                onClick={finalize}
                className="flex items-center gap-2 px-8 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-sm transition-all disabled:opacity-50"
              >
                Finalize & Apply
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BulkCreateWizard;
