import React, { useMemo, useState } from 'react';
import { X, Package, Plus, Trash2, Loader2, AlertCircle, CheckCircle2, HelpCircle, ExternalLink } from 'lucide-react';
import { Placement, Site } from '../types';
import {
  useApp,
  PackagePricingType,
  PackageCapCostOption,
  CreatePlacementPackageResult,
} from '../context/AppContext';

interface PlacementPackageModalProps {
  campaign: { id: string; name: string; startDate?: string; endDate?: string };
  site: Site;
  placements: Placement[];
  groupNameById: Map<string, string>;
  onClose: () => void;
  onCreated: () => void;
}

interface FlightRow {
  key: string;
  startDate: string;
  units: string;
  rate: string;
}

const PRICING_OPTIONS: { value: PackagePricingType; label: string }[] = [
  { value: 'PRICING_TYPE_CPM', label: 'CPM' },
  { value: 'PRICING_TYPE_CPM_ACTIVEVIEW', label: 'vCPM (Active View)' },
  { value: 'PRICING_TYPE_CPC', label: 'CPC' },
  { value: 'PRICING_TYPE_CPA', label: 'CPA' },
  { value: 'PRICING_TYPE_FLAT_RATE_IMPRESSIONS', label: 'Flat rate - impressions' },
  { value: 'PRICING_TYPE_FLAT_RATE_CLICKS', label: 'Flat rate - clicks' },
];

const CAP_OPTIONS: { value: PackageCapCostOption; label: string }[] = [
  { value: 'CAP_COST_NONE', label: 'Off' },
  { value: 'CAP_COST_MONTHLY', label: 'Monthly' },
  { value: 'CAP_COST_CUMULATIVE', label: 'Cumulative' },
];

const DAY_MS = 24 * 60 * 60 * 1000;
const addDays = (isoDate: string, days: number) =>
  new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const formatDate = (isoDate: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate || '—';
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
};
const localToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};
const parseNumber = (value: string) => {
  const normalized = value.replace(',', '.').trim();
  if (normalized === '') return 0;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
};
const newKey = () => Math.random().toString(36).slice(2, 10);

const PlacementPackageModal: React.FC<PlacementPackageModalProps> = ({ campaign, site, placements, groupNameById, onClose, onCreated }) => {
  const { createPlacementPackage, accountId } = useApp();

  const defaultStart = campaign.startDate || localToday();
  const defaultEnd = campaign.endDate || addDays(defaultStart, 30);

  const [name, setName] = useState(`${site.name} - `);
  const [testingStartDate, setTestingStartDate] = useState(defaultStart);
  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);
  const [pricingType, setPricingType] = useState<PackagePricingType>('PRICING_TYPE_CPM');
  const [capCostOption, setCapCostOption] = useState<PackageCapCostOption>('CAP_COST_NONE');
  const [automaticFlighting, setAutomaticFlighting] = useState(false);
  const [flights, setFlights] = useState<FlightRow[]>([{ key: newKey(), startDate: defaultStart, units: '0', rate: '0' }]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<CreatePlacementPackageResult | null>(null);

  const isFlatRate = pricingType === 'PRICING_TYPE_FLAT_RATE_IMPRESSIONS' || pricingType === 'PRICING_TYPE_FLAT_RATE_CLICKS';
  const isPerThousand = pricingType === 'PRICING_TYPE_CPM' || pricingType === 'PRICING_TYPE_CPM_ACTIVEVIEW';

  const handleStartDateChange = (value: string) => {
    // Keep the first flight aligned with the package start, as CM360 does.
    setFlights((prev) => prev.map((f, idx) => (idx === 0 && f.startDate === startDate ? { ...f, startDate: value } : f)));
    if (testingStartDate === startDate) setTestingStartDate(value);
    setStartDate(value);
  };

  // Flights sorted by start date; each flight ends the day before the next one starts,
  // and the last one ends on the package end date.
  const computedFlights = useMemo(() => {
    const sorted = [...flights].sort((a, b) => a.startDate.localeCompare(b.startDate));
    return sorted.map((flight, idx) => {
      const next = sorted[idx + 1];
      const flightEnd = next ? addDays(next.startDate, -1) : endDate;
      const units = parseNumber(flight.units);
      const rate = parseNumber(flight.rate);
      const cost = isFlatRate ? rate : isPerThousand ? (units / 1000) * rate : units * rate;
      return { ...flight, endDate: flightEnd, unitsValue: units, rateValue: rate, cost };
    });
  }, [flights, endDate, isFlatRate, isPerThousand]);

  const totals = computedFlights.reduce(
    (acc, f) => ({ units: acc.units + (Number.isFinite(f.unitsValue) ? f.unitsValue : 0), cost: acc.cost + (Number.isFinite(f.cost) ? f.cost : 0) }),
    { units: 0, cost: 0 }
  );

  const errors = useMemo(() => {
    const list: string[] = [];
    if (!name.trim() || name.trim() === `${site.name} -`) list.push('Escribe un nombre para el package.');
    if (!startDate || !endDate) list.push('Start date y End date son obligatorias.');
    else if (startDate > endDate) list.push('End date debe ser igual o posterior a Start date.');
    if (testingStartDate && startDate && testingStartDate > startDate) list.push('Testing starts no puede ser posterior a Start date.');
    if (placements.length === 0) list.push('No hay placements seleccionados para el package.');
    if (!automaticFlighting) {
      if (computedFlights.length === 0) list.push('Añade al menos un Flight.');
      if (computedFlights.length > 0 && computedFlights[0].startDate !== startDate) list.push('El primer Flight debe empezar en la Start date del package.');
      const starts = computedFlights.map((f) => f.startDate);
      if (new Set(starts).size !== starts.length) list.push('Dos Flights no pueden empezar el mismo día.');
      if (computedFlights.some((f) => !f.startDate || f.startDate < startDate || f.startDate > endDate)) list.push('Todas las fechas de Flight deben estar entre Start date y End date.');
      if (computedFlights.some((f) => !Number.isFinite(f.unitsValue) || f.unitsValue < 0 || !Number.isInteger(f.unitsValue))) list.push('Units debe ser un número entero ≥ 0.');
      if (computedFlights.some((f) => !Number.isFinite(f.rateValue) || f.rateValue < 0)) list.push('Rate debe ser un número ≥ 0.');
    }
    return list;
  }, [name, site.name, startDate, endDate, testingStartDate, placements.length, automaticFlighting, computedFlights]);

  const addFlight = () => {
    const last = computedFlights[computedFlights.length - 1];
    let nextStart = last ? addDays(last.startDate, 1) : startDate;
    if (last) {
      // Default to the first day of the following month, clamped to the package end.
      const d = new Date(`${last.startDate}T00:00:00Z`);
      nextStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
      if (nextStart > endDate) nextStart = endDate;
    }
    setFlights((prev) => [...prev, { key: newKey(), startDate: nextStart, units: '0', rate: last ? last.rate : '0' }]);
  };

  const updateFlight = (key: string, field: 'startDate' | 'units' | 'rate', value: string) => {
    setFlights((prev) => prev.map((f) => (f.key === key ? { ...f, [field]: value } : f)));
  };

  const removeFlight = (key: string) => {
    setFlights((prev) => (prev.length > 1 ? prev.filter((f) => f.key !== key) : prev));
  };

  const handleSave = async () => {
    if (errors.length > 0 || isSubmitting) return;
    setIsSubmitting(true);
    const res = await createPlacementPackage({
      campaignId: campaign.id,
      siteId: site.id,
      name: name.trim(),
      testingStartDate: testingStartDate || undefined,
      startDate,
      endDate,
      pricingType,
      capCostOption,
      automaticFlighting,
      flights: computedFlights.map((f) => ({ startDate: f.startDate, endDate: f.endDate, units: f.unitsValue, rate: f.rateValue })),
      placementIds: placements.map((p) => p.id),
    });
    setIsSubmitting(false);
    setResult(res);
    if (res.success) onCreated();
  };

  const campaignExplorerUrl = `https://campaignmanager.google.com/trafficking/#/accounts/${accountId}/campaigns/${campaign.id}/explorer`;
  const placementNameById = new Map(placements.map((p) => [p.id, p.name]));

  const labelCls = 'block text-[10px] uppercase font-bold text-slate-500 mb-1.5';
  const inputCls = 'w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500 disabled:opacity-50';

  return (
    <div className="fixed inset-0 z-[110] flex items-start sm:items-center justify-center p-4 overflow-y-auto bg-slate-950/80 backdrop-blur-sm">
      <div className="my-4 w-full max-w-4xl max-h-[calc(100vh-2rem)] overflow-y-auto custom-scrollbar bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-start justify-between p-6 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-500/15 border border-orange-500/30 flex items-center justify-center">
              <Package className="w-5 h-5 text-orange-400" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-white">New package</h3>
              <p className="text-xs text-slate-400 mt-0.5">Site: <span className="text-slate-200 font-semibold">{site.name}</span> · Campaign: <span className="text-slate-200">{campaign.name}</span></p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-slate-500 hover:text-white hover:bg-slate-800 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {result?.success ? (
          <div className="p-6 space-y-4">
            <div className={`p-4 rounded-2xl border ${result.failedPlacements.length === 0 ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-amber-500/10 border-amber-500/30'}`}>
              <div className="flex items-center gap-2">
                <CheckCircle2 className={`w-5 h-5 ${result.failedPlacements.length === 0 ? 'text-emerald-400' : 'text-amber-400'}`} />
                <p className="text-sm font-bold text-white">Package creado (ID {result.id})</p>
              </div>
              <p className="text-xs text-slate-300 mt-2">
                {result.assignedPlacementIds.length} de {placements.length} placements asignados al package.
              </p>
            </div>
            {result.failedPlacements.length > 0 && (
              <div className="p-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 space-y-2">
                <p className="text-xs font-bold text-rose-300">No se pudieron asignar:</p>
                {result.failedPlacements.map((f) => (
                  <p key={f.id} className="text-[11px] text-rose-200 break-words">
                    <span className="font-mono">{placementNameById.get(f.id) || f.id}</span> — {f.error}
                  </p>
                ))}
              </div>
            )}
            <div className="flex justify-between items-center pt-2">
              <a href={campaignExplorerUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300">
                Ver campaña en CM360 <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <button onClick={onClose} className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-bold">Cerrar</button>
            </div>
          </div>
        ) : (
          <>
            <div className="p-6 space-y-6">
              <div>
                <label className={labelCls}>Package name *</label>
                <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder={`${site.name} - ROS - Cash - Octubre 2026 - Marzo 2027`} autoFocus />
              </div>

              <section>
                <h4 className="text-sm font-bold text-white mb-3">Schedule and pricing</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Testing starts</label>
                    <input type="date" value={testingStartDate} max={startDate || undefined} onChange={(e) => setTestingStartDate(e.target.value)} className={inputCls} />
                  </div>
                  <div className="hidden md:block" />
                  <div>
                    <label className={labelCls}>Start date *</label>
                    <input type="date" value={startDate} onChange={(e) => handleStartDateChange(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>End date *</label>
                    <input type="date" value={endDate} min={startDate || undefined} onChange={(e) => setEndDate(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Cost structure *</label>
                    <select value={pricingType} onChange={(e) => setPricingType(e.target.value as PackagePricingType)} className={inputCls}>
                      {PRICING_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Cap cost</label>
                    <select value={capCostOption} onChange={(e) => setCapCostOption(e.target.value as PackageCapCostOption)} className={inputCls}>
                      {CAP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                </div>

                <label className="mt-4 inline-flex items-center gap-3 cursor-pointer select-none">
                  <span className={`relative w-9 h-5 rounded-full transition-colors ${automaticFlighting ? 'bg-blue-600' : 'bg-slate-700'}`}>
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${automaticFlighting ? 'left-[18px]' : 'left-0.5'}`} />
                  </span>
                  <input type="checkbox" className="hidden" checked={automaticFlighting} onChange={(e) => setAutomaticFlighting(e.target.checked)} />
                  <span className="text-sm text-slate-200">Automatic flighting</span>
                  <span title="Si está activo, CM360 calcula los flights automáticamente y no se envían los flights manuales.">
                    <HelpCircle className="w-4 h-4 text-slate-500" />
                  </span>
                </label>
              </section>

              <section className={automaticFlighting ? 'opacity-50 pointer-events-none' : ''}>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-bold text-white">Flights</h4>
                  <button onClick={addFlight} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 text-xs font-bold text-emerald-300 hover:bg-slate-800">
                    <Plus className="w-3.5 h-3.5" /> New
                  </button>
                </div>
                <div className="border border-slate-800 rounded-xl overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead className="bg-slate-950 text-[10px] uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="px-3 py-2 font-bold">Start date</th>
                        <th className="px-3 py-2 font-bold">End date</th>
                        <th className="px-3 py-2 font-bold text-right">Units</th>
                        <th className="px-3 py-2 font-bold text-right">Rate</th>
                        <th className="px-3 py-2 font-bold text-right">Cost</th>
                        <th className="px-3 py-2 w-10" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {computedFlights.map((f) => (
                        <tr key={f.key}>
                          <td className="px-3 py-2">
                            <input type="date" value={f.startDate} min={startDate} max={endDate} onChange={(e) => updateFlight(f.key, 'startDate', e.target.value)} className="bg-slate-950 border border-slate-800 rounded-md px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-blue-500" />
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-400 font-mono">{formatDate(f.endDate)}</td>
                          <td className="px-3 py-2 text-right">
                            <input inputMode="numeric" value={f.units} onChange={(e) => updateFlight(f.key, 'units', e.target.value)} className="w-28 text-right bg-slate-950 border border-slate-800 rounded-md px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-blue-500" />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <input inputMode="decimal" value={f.rate} onChange={(e) => updateFlight(f.key, 'rate', e.target.value)} className="w-24 text-right bg-slate-950 border border-slate-800 rounded-md px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-blue-500" />
                          </td>
                          <td className="px-3 py-2 text-right text-xs text-slate-300 font-mono">
                            {Number.isFinite(f.cost) ? f.cost.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button onClick={() => removeFlight(f.key)} disabled={flights.length <= 1} className="p-1 text-slate-500 hover:text-rose-400 disabled:opacity-30 disabled:hover:text-slate-500" title="Eliminar flight">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-slate-950/60 text-xs text-slate-400">
                      <tr>
                        <td className="px-3 py-2 font-bold" colSpan={2}>Total</td>
                        <td className="px-3 py-2 text-right font-mono">{totals.units.toLocaleString('es-ES')}</td>
                        <td />
                        <td className="px-3 py-2 text-right font-mono">{totals.cost.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <p className="text-[10px] text-slate-500 mt-2">
                  Cada flight termina el día anterior al inicio del siguiente; el último termina en la End date del package.
                  {isPerThousand ? ' Cost = Units / 1000 × Rate.' : isFlatRate ? ' En tarifa plana, Cost = Rate.' : ' Cost = Units × Rate.'}
                </p>
              </section>

              <section>
                <h4 className="text-sm font-bold text-white mb-2">Placements ({placements.length})</h4>
                <div className="max-h-44 overflow-y-auto custom-scrollbar border border-slate-800 rounded-xl divide-y divide-slate-800">
                  {placements.map((p) => {
                    const currentGroupId = (p.originalData as any)?.placementGroupId ? String((p.originalData as any).placementGroupId) : '';
                    return (
                      <div key={p.id} className="px-3 py-2 flex items-center gap-3">
                        <span className="flex-1 min-w-0 text-xs text-slate-200 break-words">{p.name}</span>
                        {currentGroupId && (
                          <span className="shrink-0 text-[10px] px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300" title="Se moverá a este nuevo package">
                            Ya en: {groupNameById.get(currentGroupId) || `package ${currentGroupId}`}
                          </span>
                        )}
                        <span className="shrink-0 text-[10px] font-mono text-slate-500">{p.size} · {p.id}</span>
                      </div>
                    );
                  })}
                </div>
              </section>

              {(errors.length > 0 || result?.error) && (
                <div className="p-3 rounded-xl border border-rose-500/30 bg-rose-500/10 space-y-1">
                  {result?.error && <p className="text-xs text-rose-200 flex gap-2"><AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> CM360: {result.error}</p>}
                  {errors.map((err) => <p key={err} className="text-xs text-rose-300">• {err}</p>)}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 p-6 border-t border-slate-800">
              <button onClick={onClose} className="px-5 py-2.5 text-sm font-bold text-slate-400 hover:text-white">Cancel</button>
              <button onClick={handleSave} disabled={errors.length > 0 || isSubmitting} className="inline-flex items-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed">
                {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {isSubmitting ? 'Creando package...' : `Save (${placements.length} placements)`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default PlacementPackageModal;
