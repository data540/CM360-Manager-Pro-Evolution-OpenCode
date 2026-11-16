// Searchable campaign chooser (replaces a long <select>): type words, pick with mouse or keyboard.
// The list is `position: fixed` so the rounded, overflow-hidden cards around it don't clip it.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { campaignEnded, searchCampaigns, SearchableCampaign } from '../services/campaignSearch';

const MAX_RESULTS = 80;

interface CampaignPickerProps {
  campaigns: SearchableCampaign[];
  value: string;
  onChange: (campaignId: string) => void;
  placeholder: string;
  disabled?: boolean;
}

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const CampaignPicker: React.FC<CampaignPickerProps> = ({ campaigns, value, onChange, placeholder, disabled }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = campaigns.find((c) => c.id === value);
  const today = todayIso();
  const results = useMemo(() => searchCampaigns(campaigns, query, today), [campaigns, query, today]);
  const shown = results.slice(0, MAX_RESULTS);

  const place = () => {
    const box = inputRef.current?.getBoundingClientRect();
    if (!box) return;
    const width = Math.max(box.width, 480);
    const left = Math.min(box.left, window.innerWidth - width - 8);
    const below = window.innerHeight - box.bottom - 12;
    setRect({ left: Math.max(8, left), top: box.bottom + 4, width, maxHeight: Math.max(160, Math.min(420, below)) });
  };

  const openList = () => {
    if (disabled) return;
    place();
    setOpen(true);
    setActive(0);
  };

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  const choose = (id: string) => {
    onChange(id);
    close();
    inputRef.current?.blur();
  };

  // Keep the floating list attached to the input while the page scrolls or resizes.
  useEffect(() => {
    if (!open) return;
    const onMove = () => place();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) openList();
      else setActive((i) => Math.min(i + 1, shown.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && shown[active]) choose(shown[active].id);
    } else if (e.key === 'Escape') {
      close();
      inputRef.current?.blur();
    }
  };

  return (
    <div className="relative w-[26rem] max-w-full">
      <Search className="w-4 h-4 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={open}
        aria-label={placeholder}
        disabled={disabled}
        value={open ? query : selected?.name || ''}
        placeholder={selected ? selected.name : placeholder}
        onFocus={openList}
        onClick={() => { if (!open) openList(); }}
        onBlur={close}
        onChange={(e) => { setQuery(e.target.value); if (!open) openList(); }}
        onKeyDown={onKeyDown}
        title={selected?.name}
        className={`w-full bg-slate-950 border rounded-lg py-1.5 pl-8 pr-8 text-sm focus:outline-none focus:border-blue-500 disabled:opacity-60 ${
          selected ? 'border-emerald-600/50 text-slate-100 font-mono' : 'border-slate-700 text-slate-200'
        } placeholder:text-slate-500 ${open && selected ? 'placeholder:text-slate-400' : ''}`}
      />
      {selected && !disabled && (
        <button
          type="button"
          title="Quitar la campaña"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200"
        >
          <X className="w-4 h-4" />
        </button>
      )}

      {open && rect && (
        <div
          className="fixed z-[100] rounded-lg border border-slate-700 bg-slate-900 shadow-2xl shadow-black/50 overflow-hidden"
          style={{ left: rect.left, top: rect.top, width: rect.width }}
        >
          <p className="px-3 py-1.5 text-[10px] uppercase tracking-widest font-bold text-slate-500 border-b border-slate-800">
            {results.length} campaña{results.length === 1 ? '' : 's'}
            {query.trim() ? ` con «${query.trim()}»` : ''}
            {results.length > MAX_RESULTS ? ` · mostrando ${MAX_RESULTS}, escribe más para acotar` : ''}
          </p>
          <ul ref={listRef} role="listbox" className="overflow-auto py-1" style={{ maxHeight: rect.maxHeight }}>
            {shown.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">Ninguna campaña contiene esas palabras.</li>}
            {shown.map((c, i) => {
              const ended = campaignEnded(c, today);
              return (
                <li
                  key={c.id}
                  data-index={i}
                  role="option"
                  aria-selected={c.id === value}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(c.id)}
                  className={`px-3 py-1.5 cursor-pointer flex items-baseline justify-between gap-3 ${
                    i === active ? 'bg-blue-600/25' : ''
                  } ${c.id === value ? 'border-l-2 border-emerald-500' : 'border-l-2 border-transparent'}`}
                >
                  <span className={`font-mono text-[13px] break-all ${ended ? 'text-slate-500' : 'text-slate-100'}`}>{c.name}</span>
                  <span className={`shrink-0 text-[11px] ${ended ? 'text-slate-600' : 'text-slate-400'}`}>
                    {c.startDate || c.endDate ? `${c.startDate || '…'} → ${c.endDate || '…'}` : ''}
                    {ended ? ' · terminada' : ''}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
};

export default CampaignPicker;
