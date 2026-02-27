import React from 'react';
import { Moon, Sun } from 'lucide-react';

interface SettingsPanelProps {
  theme: 'dark' | 'light';
  onThemeChange: (theme: 'dark' | 'light') => void;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({ theme, onThemeChange }) => {
  const isLight = theme === 'light';

  return (
    <div className="view-root flex-1 overflow-auto p-8 bg-slate-950/40">
      <div className={`max-w-2xl rounded-2xl border p-6 ${isLight ? 'border-slate-300 bg-white' : 'border-slate-800 bg-slate-900/50'}`}>
        <h2 className={`text-xl font-bold ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>Settings</h2>
        <p className={`mt-2 text-sm ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>Choose your interface appearance.</p>

        <div className={`mt-6 rounded-xl border p-4 ${isLight ? 'border-slate-200 bg-white shadow-sm' : 'border-slate-800 bg-slate-950/50'}`}>
          <p className={`text-xs uppercase tracking-[0.12em] font-bold ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>Theme Mode</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <button
              onClick={() => onThemeChange('dark')}
              className={`flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold border transition-all ${
                theme === 'dark'
                  ? 'bg-blue-600/20 border-blue-500/40 text-blue-300'
                  : (isLight
                    ? 'bg-white border-slate-300 text-slate-800 hover:border-slate-400'
                    : 'bg-[#0f172a] border-[#334155] text-[#e2e8f0] hover:border-[#475569]')
              }`}
            >
              <Moon className="w-4 h-4" /> Dark Mode
            </button>
            <button
              onClick={() => onThemeChange('light')}
              className={`flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold border transition-all ${
                theme === 'light'
                  ? (isLight
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                    : 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300')
                  : (isLight
                    ? 'bg-white border-slate-300 text-slate-800 hover:border-slate-400'
                    : 'bg-[#0f172a] border-[#334155] text-[#e2e8f0] hover:border-[#475569]')
              }`}
            >
              <Sun className="w-4 h-4" /> Light Mode
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;
