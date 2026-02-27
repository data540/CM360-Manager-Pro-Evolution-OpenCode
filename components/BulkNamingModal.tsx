import React, { useState, useMemo } from 'react';
import { X, Type, ChevronsLeft, ChevronsRight } from 'lucide-react';

interface BulkNamingModalProps {
  items: Array<{ id: string; name: string }>;
  entityLabel?: string;
  onClose: () => void;
  onApply: (config: BulkNamingConfig) => void;
}

export interface BulkNamingConfig {
  mode: 'prefix' | 'suffix' | 'replace';
  value: string;
  replaceFrom?: string;
  separator: string;
}

export const applyBulkNamingConfig = (name: string, config: BulkNamingConfig): string => {
  if (!config.value) return name;

  switch (config.mode) {
    case 'prefix':
      return `${config.value}${config.separator}${name}`;
    case 'suffix':
      return `${name}${config.separator}${config.value}`;
    case 'replace':
      if (!config.replaceFrom) return name;
      return name.replace(new RegExp(config.replaceFrom, 'g'), config.value);
    default:
      return name;
  }
};

const BulkNamingModal: React.FC<BulkNamingModalProps> = ({ items, entityLabel = 'Items', onClose, onApply }) => {
  const [config, setConfig] = useState<BulkNamingConfig>({ mode: 'suffix', value: '', separator: '_' });

  const { previewItems, changedCount } = useMemo(() => {
    let changed = 0;
    const allPreviews = items.map((item) => {
      const newName = applyBulkNamingConfig(item.name, config);
      if (newName !== item.name) changed++;
      return { ...item, newName };
    });
    return { 
      previewItems: allPreviews.slice(0, 20), 
      changedCount: changed 
    };
  }, [items, config]);

  return (
    <div className="fixed inset-0 z-[101] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 w-full max-w-3xl shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        <div className="flex justify-between items-start mb-6">
          <div>
              <h3 className="text-xl font-bold text-white">Bulk Naming Tool</h3>
              <div className="flex items-center gap-4 mt-1">
                <p className="text-slate-400 text-sm">Selected: <span className="text-white font-bold">{items.length}</span></p>
                <p className="text-slate-400 text-sm">To be changed: <span className="text-blue-400 font-bold">{changedCount}</span></p>
              </div>
            </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-500 mb-2">Mode</label>
            <div className="flex p-1 bg-slate-950 rounded-xl border border-slate-800">
              {(['prefix', 'suffix', 'replace'] as const).map(mode => (
                <button
                  key={mode}
                  onClick={() => setConfig(c => ({ ...c, mode }))}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
                    config.mode === mode ? 'bg-blue-600 text-white shadow' : 'text-slate-500 hover:text-slate-300'
                  }`}>
                  {mode.charAt(0).toUpperCase() + mode.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {config.mode === 'replace' && (
              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-500 mb-2">Find</label>
                <input 
                  type="text"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                  value={config.replaceFrom || ''}
                  onChange={(e) => setConfig(c => ({ ...c, replaceFrom: e.target.value }))}
                />
              </div>
            )}
            <div>
              <label className="block text-[10px] uppercase font-bold text-slate-500 mb-2">
                {config.mode === 'replace' ? 'Replace With' : 'Text to Add'}
              </label>
              <input 
                type="text"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                value={config.value}
                onChange={(e) => setConfig(c => ({ ...c, value: e.target.value }))}
              />
            </div>
          </div>
        </div>

        <div className="bg-slate-950/50 p-4 rounded-xl border border-slate-800 max-h-64 overflow-y-auto custom-scrollbar">
          <table className="w-full text-left">
            <thead>
              <tr>
                <th className="p-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">Current Name</th>
                <th className="p-2 w-8"></th>
                <th className="p-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">New Name</th>
              </tr>
            </thead>
            <tbody>
              {previewItems.map(item => (
                <tr key={item.id} className={item.name === item.newName ? 'opacity-40' : ''}>
                  <td className="p-2 font-mono text-xs text-slate-500 truncate max-w-xs">{item.name}</td>
                  <td className="p-2 text-center text-blue-500">
                    {item.name === item.newName ? (
                      <span className="text-[10px] text-slate-600 font-bold">NO CHANGE</span>
                    ) : (
                      <ChevronsRight className="w-4 h-4 mx-auto" />
                    )}
                  </td>
                  <td className="p-2 font-mono text-xs text-blue-400 truncate max-w-xs">{item.newName}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {items.length > 20 && (
            <p className="text-center text-xs text-slate-600 mt-2">... and {items.length - 20} more {entityLabel.toLowerCase()}.</p>
          )}
        </div>

        <div className="flex justify-end gap-3 pt-6">
          <button 
            onClick={onClose}
            className="px-6 py-2.5 rounded-xl text-slate-400 hover:text-white transition-all font-bold text-sm"
          >
            Cancel
          </button>
          <button 
            onClick={() => onApply(config)}
            disabled={!config.value}
            className="px-8 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-sm transition-all shadow-lg shadow-blue-600/20 disabled:opacity-50"
          >
            Apply to {items.length} {entityLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BulkNamingModal;
