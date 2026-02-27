
import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Placement, Status } from '../types';
import BulkNamingModal, { applyBulkNamingConfig } from './BulkNamingModal';
import PlacementCreator from './PlacementCreator';
import { 
  MoreVertical, 
  Trash2, 
  Copy, 
  Edit3, 
  Search, 
  Plus, 
  ArrowUpDown,
  FileDown,
  Zap,
  Layers,
  AlertCircle,
  PlusCircle,
  RefreshCw,
  CheckCircle2,
  ExternalLink
} from 'lucide-react';
import Toast from './Toast';

const PlacementGrid: React.FC = () => {
  const { 
    placements, 
    placementsDrafts, 
    creatives, 
    selectedCampaign, 
    addPlacements,
    deletePlacement, 
    pushPlacements, 
    publishSelectedDrafts,
    updatePlacementName,
    updatePlacementDraft,
    accountId, 
    selectedAdvertiser, 
    assignCreativeToPlacement 
  } = useApp();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [isCreatorOpen, setIsCreatorOpen] = useState(false);
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [activePlacement, setActivePlacement] = useState<Placement | null>(null);
  const [creativeSearch, setCreativeSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<'name' | 'dates' | 'status' | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editStartDate, setEditStartDate] = useState('');
  const [editEndDate, setEditEndDate] = useState('');
  const [isBulkNamingOpen, setIsBulkNamingOpen] = useState(false);
  const [isBulkActionsOpen, setIsBulkActionsOpen] = useState(false);
  const [columnWidths, setColumnWidths] = useState({
    name: 360,
    site: 150,
    dimensions: 130,
    type: 110,
    status: 130,
    dates: 230,
  });
  
  const [toast, setToast] = useState<{show: boolean, type: 'success' | 'error' | 'loading', message: string, details?: string, link?: string}>({
    show: false,
    type: 'loading',
    message: ''
  });

  const handlePushToCM360 = async () => {
    if (selectedRows.size === 0) return;
    
    setToast({
      show: true,
      type: 'loading',
      message: `Publishing ${selectedRows.size} placements...`,
      details: 'Syncing changes with Campaign Manager 360.'
    });

    const result = await publishSelectedDrafts(Array.from(selectedRows));
    
    if (result.success > 0) {
      setToast({
        show: true,
        type: 'success',
        message: 'Publish Successful!',
        details: `${result.success} placements synced correctly. ${result.failed > 0 ? `${result.failed} failed.` : ''}`,
      });
    } else {
      setToast({
        show: true,
        type: 'error',
        message: 'Publish Failed',
        details: result.results.find(r => !r.success)?.error || 'None of the selected placements could be registered.'
      });
    }
    
    setSelectedRows(new Set());
  };

  const filteredPlacements = placements.map(p => placementsDrafts[p.id] || p).filter(p => {
    const matchesCampaign = !selectedCampaign || p.campaignId === selectedCampaign.id;
    const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesCampaign && matchesSearch;
  });

  const toggleSelectAll = () => {
    if (selectedRows.size === filteredPlacements.length) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(filteredPlacements.map(p => p.id)));
    }
  };

  const toggleSelectRow = (id: string) => {
    const newSelected = new Set(selectedRows);
    if (newSelected.has(id)) newSelected.delete(id);
    else newSelected.add(id);
    setSelectedRows(newSelected);
  };

  const handleLinkCreative = async (creativeId: string) => {
    if (!activePlacement || !selectedCampaign) return;

    setIsLinkModalOpen(false);
    setToast({
      show: true,
      type: 'loading',
      message: 'Linking creative to placement...',
      details: 'Creating Ad and assignments in CM360.'
    });

    const result = await assignCreativeToPlacement(creativeId, activePlacement.id, selectedCampaign.id);

    if (result.success) {
      setToast({
        show: true,
        type: 'success',
        message: 'Creative Linked!',
        details: 'An Ad has been created and assigned to the placement successfully.'
      });
    } else {
      setToast({
        show: true,
        type: 'error',
        message: 'Linking Failed',
        details: result.error || 'Could not create the association. Check API permissions.'
      });
    }
    setActivePlacement(null);
  };

  const handleExportCSV = () => {
    const headers = ['Name', 'Site', 'Size', 'Type', 'Status', 'Start', 'End'];
    const rows = filteredPlacements.map(p => [
      p.name, p.siteId, p.size, p.type, p.status, p.startDate, p.endDate
    ].join(','));
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(','), ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `placements_batch_${new Date().getTime()}.csv`);
    document.body.appendChild(link);
    link.click();
  };

  const handleDuplicateSelected = () => {
    if (selectedRows.size === 0) return;

    const now = new Date().toISOString().split('T')[0];
    const selectedPlacements = filteredPlacements.filter((p) => selectedRows.has(p.id));
    if (selectedPlacements.length === 0) return;

    const duplicates: Placement[] = selectedPlacements.map((placement) => ({
      ...placement,
      id: `plc-${Math.random().toString(36).slice(2, 11)}`,
      name: `${placement.name}_copy`,
      status: 'Draft',
      createdAt: now,
      updatedAt: now,
      isDraft: true,
    }));

    addPlacements(duplicates);
    setSelectedRows(new Set(duplicates.map((item) => item.id)));
    setToast({
      show: true,
      type: 'success',
      message: 'Placements duplicated',
      details: `${duplicates.length} duplicated placement(s) added as drafts.`
    });
  };

  const applyBulkStatus = (status: Status) => {
    if (selectedRows.size === 0) return;
    selectedRows.forEach((id) => updatePlacementDraft(id, { status }));
    setIsBulkActionsOpen(false);
    setToast({
      show: true,
      type: 'success',
      message: 'Status updated',
      details: `${selectedRows.size} placement(s) set to ${status}.`
    });
  };

  const handleAddIdToNaming = () => {
    if (selectedRows.size === 0) return;
    let updated = 0;
    selectedRows.forEach((id) => {
      const placement = filteredPlacements.find((p) => p.id === id);
      if (!placement) return;
      const placementId = placement.cmId || placement.id;
      if (!placementId) return;
      const suffixWithUnderscore = `_${placementId}`;
      const suffixWithoutUnderscore = `${placementId}`;

      if (placement.name.endsWith(suffixWithUnderscore) || placement.name.endsWith(suffixWithoutUnderscore)) return;

      const nextName = placement.name.endsWith('_')
        ? `${placement.name}${placementId}`
        : `${placement.name}${suffixWithUnderscore}`;

      updatePlacementName(id, nextName);
      updated++;
    });
    setIsBulkActionsOpen(false);
    setToast({
      show: true,
      type: 'success',
      message: 'Naming updated',
      details: `${updated} placement(s) updated with placement ID suffix.`
    });
  };

  const startResize = (column: keyof typeof columnWidths, startX: number, startWidth: number) => {
    const onMouseMove = (event: MouseEvent) => {
      const delta = event.clientX - startX;
      setColumnWidths((prev) => ({
        ...prev,
        [column]: Math.max(100, Math.min(700, startWidth + delta)),
      }));
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  return (
    <div className="view-root flex-1 flex flex-col h-full bg-slate-950/40">
      <div className="view-toolbar relative z-40 p-4 border-b border-slate-800 flex items-center justify-between gap-4 bg-slate-900/50 backdrop-blur-sm">
        <div className="flex-1 max-w-md relative">
          <Search className="absolute left-3 top-3 w-4 h-4 text-slate-500" />
          <input 
            type="text" 
            placeholder="Search placements in this campaign..." 
            className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2.5 pl-10 pr-4 text-base text-slate-200 focus:outline-none focus:border-blue-500 transition-all placeholder:text-slate-500"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        
        <div className="flex items-center gap-2">
          {selectedRows.size > 0 && (
            <div className="flex items-center bg-blue-600/10 px-3 py-1.5 rounded-lg border border-blue-500/20 gap-3 mr-4 animate-in fade-in slide-in-from-right-4 relative z-[120]">
              <span className="text-xs font-bold text-blue-400 uppercase tracking-wider">{selectedRows.size} selected</span>
              <div className="w-px h-4 bg-blue-500/20" />
              <div className="relative z-[130]">
                <button
                  onClick={() => setIsBulkActionsOpen((prev) => !prev)}
                  className="text-slate-400 hover:text-white transition-colors"
                  title="Bulk actions"
                >
                  <MoreVertical className="w-3.5 h-3.5" />
                </button>
                {isBulkActionsOpen && (
                  <div className="absolute right-0 top-6 w-52 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl z-[200] py-1 pointer-events-auto">
                    <button onClick={() => { setIsBulkNamingOpen(true); setIsBulkActionsOpen(false); }} className="w-full text-left px-3 py-2.5 text-sm text-slate-300 hover:bg-blue-600 hover:text-white flex items-center gap-2">
                      <Zap className="w-3.5 h-3.5" /> Bulk naming
                    </button>
                    <button onClick={() => { handleDuplicateSelected(); }} className="w-full text-left px-3 py-2.5 text-sm text-slate-300 hover:bg-blue-600 hover:text-white flex items-center gap-2">
                      <Copy className="w-3.5 h-3.5" /> Duplicate
                    </button>
                    <button onClick={handleAddIdToNaming} className="w-full text-left px-3 py-2.5 text-sm text-slate-300 hover:bg-blue-600 hover:text-white flex items-center gap-2">
                      <Layers className="w-3.5 h-3.5" /> Add placement ID
                    </button>
                    <div className="px-3 py-2 border-t border-slate-800 mt-1">
                      <p className="text-xs uppercase tracking-wider text-slate-500 mb-1">Set status</p>
                      <div className="grid grid-cols-2 gap-1">
                        <button onClick={() => applyBulkStatus('Active')} className="px-2 py-1.5 text-xs rounded bg-slate-800 text-slate-300 hover:bg-emerald-600 hover:text-white">Active</button>
                        <button onClick={() => applyBulkStatus('Paused')} className="px-2 py-1.5 text-xs rounded bg-slate-800 text-slate-300 hover:bg-amber-600 hover:text-white">Paused</button>
                        <button onClick={() => applyBulkStatus('Draft')} className="px-2 py-1.5 text-xs rounded bg-slate-800 text-slate-300 hover:bg-blue-600 hover:text-white">Draft</button>
                        <button onClick={() => applyBulkStatus('Completed')} className="px-2 py-1.5 text-xs rounded bg-slate-800 text-slate-300 hover:bg-indigo-600 hover:text-white">Completed</button>
                      </div>
                    </div>
                    <button 
                      onClick={() => {
                        selectedRows.forEach(id => deletePlacement(id));
                        setSelectedRows(new Set());
                        setIsBulkActionsOpen(false);
                      }}
                      className="w-full text-left px-3 py-2.5 text-sm text-rose-400 hover:bg-rose-600/20 flex items-center gap-2 border-t border-slate-800 mt-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Delete selected
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
          <button 
            onClick={handleExportCSV}
            className="flex items-center justify-center p-2.5 bg-[#111f37] hover:bg-[#172a48] text-slate-300 rounded-lg text-sm font-bold transition-all border border-[#2a4163]"
            title="Export CSV"
          >
            <FileDown className="w-3.5 h-3.5" />
          </button>
          <button 
            onClick={handlePushToCM360}
            disabled={selectedRows.size === 0 || toast.type === 'loading' && toast.show}
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 rounded-lg text-sm font-semibold transition-all border border-emerald-500/30 disabled:opacity-50 disabled:grayscale"
          >
            {toast.type === 'loading' && toast.show ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            Push to CM360 ({selectedRows.size})
          </button>
          <button 
            onClick={() => setIsCreatorOpen(true)}
            disabled={!selectedCampaign}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-semibold transition-all shadow-lg shadow-blue-500/20 disabled:opacity-50 disabled:grayscale"
          >
            <PlusCircle className="w-4 h-4" />
            New Placement
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto relative z-0 custom-scrollbar">
        <div className="list-surface m-4 rounded-2xl border border-[#2a4163] bg-[#152542] overflow-hidden">
        <table className="w-full text-left border-collapse min-w-[1000px] text-sm">
          <colgroup>
            <col style={{ width: 48 }} />
            <col style={{ width: columnWidths.name }} />
            <col style={{ width: columnWidths.site }} />
            <col style={{ width: columnWidths.dimensions }} />
            <col style={{ width: columnWidths.type }} />
            <col style={{ width: columnWidths.status }} />
            <col style={{ width: columnWidths.dates }} />
            <col style={{ width: 60 }} />
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr className="list-header-row bg-[#1b2d4d] border-b border-[#2a4163]">
              <th className="p-4 w-12">
                <input 
                  type="checkbox" 
                  className="appearance-none w-4 h-4 rounded-full border border-slate-500 bg-transparent checked:bg-emerald-400 checked:border-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 cursor-pointer"
                  checked={filteredPlacements.length > 0 && selectedRows.size === filteredPlacements.length}
                  onChange={toggleSelectAll}
                />
              </th>
              <th className="p-4 text-xs font-bold uppercase tracking-widest text-slate-400 relative">
                <div className="flex items-center gap-2 cursor-pointer hover:text-slate-300 transition-colors">
                  Placement Name <ArrowUpDown className="w-3 h-3" />
                </div>
                <div className="absolute right-0 top-0 h-full w-1 cursor-col-resize" onMouseDown={(e) => startResize('name', e.clientX, columnWidths.name)} />
              </th>
              <th className="p-4 text-xs font-bold uppercase tracking-widest text-slate-400 relative">Site<div className="absolute right-0 top-0 h-full w-1 cursor-col-resize" onMouseDown={(e) => startResize('site', e.clientX, columnWidths.site)} /></th>
              <th className="p-4 text-xs font-bold uppercase tracking-widest text-slate-400 relative">Dimensions<div className="absolute right-0 top-0 h-full w-1 cursor-col-resize" onMouseDown={(e) => startResize('dimensions', e.clientX, columnWidths.dimensions)} /></th>
              <th className="p-4 text-xs font-bold uppercase tracking-widest text-slate-400 relative">Type<div className="absolute right-0 top-0 h-full w-1 cursor-col-resize" onMouseDown={(e) => startResize('type', e.clientX, columnWidths.type)} /></th>
              <th className="p-4 text-xs font-bold uppercase tracking-widest text-slate-400 relative">Status<div className="absolute right-0 top-0 h-full w-1 cursor-col-resize" onMouseDown={(e) => startResize('status', e.clientX, columnWidths.status)} /></th>
              <th className="p-4 text-xs font-bold uppercase tracking-widest text-slate-400 relative">Flight Dates<div className="absolute right-0 top-0 h-full w-1 cursor-col-resize" onMouseDown={(e) => startResize('dates', e.clientX, columnWidths.dates)} /></th>
              <th className="p-4 w-12"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#263a5b]">
            {filteredPlacements.map((p) => (
              <tr 
                key={p.id} 
                className={`list-row group hover:bg-[#1b2d4d]/60 transition-colors ${selectedRows.has(p.id) ? 'list-row-selected bg-[#1f3458]' : ''}`}
              >
                <td className="p-4">
                  <input 
                    type="checkbox" 
                    className="appearance-none w-4 h-4 rounded-full border border-slate-500 bg-transparent checked:bg-emerald-400 checked:border-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 cursor-pointer"
                    checked={selectedRows.has(p.id)}
                    onChange={() => toggleSelectRow(p.id)}
                  />
                </td>
                <td className="p-4 text-base font-semibold text-slate-100 group-hover:text-blue-300 transition-colors leading-6">
                  {editingId === p.id && editingField === 'name' ? (
                    <div className="flex items-center gap-2">
                      <input 
                        autoFocus
                        className="bg-slate-950 border border-blue-500 rounded px-2 py-1 w-full outline-none"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={() => {
                          updatePlacementName(p.id, editValue);
                          setEditingId(null);
                          setEditingField(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            updatePlacementName(p.id, editValue);
                            setEditingId(null);
                            setEditingField(null);
                          }
                          if (e.key === 'Escape') {
                            setEditingId(null);
                            setEditingField(null);
                          }
                        }}
                      />
                    </div>
                  ) : (
                    <div className="flex items-center gap-2" onClick={() => {
                      setEditingId(p.id);
                      setEditingField('name');
                      setEditValue(p.name);
                    }}>
                      <span className="truncate max-w-[300px]">{p.name}</span>
                      <Edit3 className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  )}
                </td>
                <td className="p-4 text-base font-semibold text-slate-200 tracking-tight">
                  {p.siteId}
                </td>
                <td className="p-4">
                  <span className="inline-flex px-2.5 py-1 rounded bg-slate-700/40 text-sm font-bold text-slate-200 border border-slate-500/40 group-hover:border-blue-500/20 transition-all">
                    {p.size}
                  </span>
                </td>
                <td className="p-4">
                  <span className={`text-sm font-bold uppercase tracking-widest ${
                    p.type === 'Video' ? 'text-amber-500/80' : p.type === 'Native' ? 'text-emerald-500/80' : 'text-blue-500/80'
                  }`}>
                    {p.type}
                  </span>
                </td>
                <td className="p-4">
                  <div className="flex items-center gap-2">
                    {editingId === p.id && editingField === 'status' ? (
                      <select
                        autoFocus
                        className="bg-slate-950 border border-blue-500 rounded text-sm font-bold uppercase py-1 px-2 outline-none"
                        value={p.status}
                        onChange={(e) => {
                          updatePlacementDraft(p.id, { status: e.target.value as Status });
                          setEditingId(null);
                          setEditingField(null);
                        }}
                        onBlur={() => {
                          setEditingId(null);
                          setEditingField(null);
                        }}
                      >
                        <option value="Active">Active</option>
                        <option value="Paused">Paused</option>
                        <option value="Draft">Draft</option>
                        <option value="Completed">Completed</option>
                      </select>
                    ) : (
                      <div 
                        className="flex items-center gap-2 cursor-pointer group/status"
                        onClick={() => {
                          setEditingId(p.id);
                          setEditingField('status');
                        }}
                      >
                        {placementsDrafts[p.id] && placementsDrafts[p.id].isDraft ? (
                          <>
                            <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                            <span className="text-sm font-bold uppercase text-amber-500">Draft ({p.status})</span>
                          </>
                        ) : (
                          <>
                            <div className={`w-1.5 h-1.5 rounded-full ${p.status === 'Active' ? 'bg-emerald-500 shadow-sm shadow-emerald-500/50' : 'bg-slate-600'}`} />
                            <span className="text-sm font-bold uppercase text-slate-200">{p.status}</span>
                          </>
                        )}
                        <Edit3 className="w-2.5 h-2.5 opacity-0 group-hover/status:opacity-100 transition-opacity text-slate-500" />
                      </div>
                    )}
                  </div>
                </td>
                <td className="p-4 text-base text-slate-200 font-medium">
                  {editingId === p.id && editingField === 'dates' ? (
                    <div className="flex items-center gap-1">
                      <input 
                        type="date"
                        className="bg-slate-950 border border-blue-500 rounded px-2 py-1 text-sm outline-none text-slate-100"
                        value={editStartDate}
                        onChange={(e) => setEditStartDate(e.target.value)}
                      />
                      <span className="text-slate-800">—</span>
                      <input 
                        type="date"
                        className="bg-slate-950 border border-blue-500 rounded px-2 py-1 text-sm outline-none text-slate-100"
                        value={editEndDate}
                        onChange={(e) => setEditEndDate(e.target.value)}
                      />
                      <button 
                        onClick={() => {
                          updatePlacementDraft(p.id, { startDate: editStartDate, endDate: editEndDate });
                          setEditingId(null);
                          setEditingField(null);
                        }}
                        className="p-1 bg-blue-600 rounded text-white hover:bg-blue-500"
                      >
                        <RefreshCw className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <div 
                      className="flex items-center gap-2 cursor-pointer group/dates"
                      onClick={() => {
                        setEditingId(p.id);
                        setEditingField('dates');
                        setEditStartDate(p.startDate);
                        setEditEndDate(p.endDate);
                      }}
                    >
                      <span>{p.startDate} <span className="mx-1 text-slate-800">—</span> {p.endDate}</span>
                      <Edit3 className="w-3 h-3 opacity-0 group-hover/dates:opacity-100 transition-opacity text-slate-500" />
                    </div>
                  )}
                </td>
                <td className="p-4">
                  <div className="flex items-center gap-2">
                    {p.status === 'Active' && (
                      <button 
                        onClick={() => {
                          setActivePlacement(p);
                          setIsLinkModalOpen(true);
                        }}
                        className="p-1.5 rounded-md text-emerald-400 hover:bg-emerald-400/10 transition-all"
                        title="Link Creative"
                      >
                        <Zap className="w-4 h-4" />
                      </button>
                    )}
                    {p.externalUrl && (
                      <a 
                        href={p.externalUrl} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="p-1.5 rounded-md text-blue-400 hover:bg-blue-400/10 transition-all"
                        title="Open in CM360"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    )}
                    <button className="p-1.5 rounded-md text-slate-600 hover:bg-slate-800 hover:text-slate-300 transition-all">
                      <MoreVertical className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filteredPlacements.length === 0 && (
              <tr>
                <td colSpan={8} className="p-32 text-center">
                  <div className="w-16 h-16 bg-slate-900 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-slate-800">
                    <Layers className="w-8 h-8 text-slate-700" />
                  </div>
                  <h3 className="text-slate-300 font-bold">Workspace is empty</h3>
                  <p className="text-slate-500 text-xs mt-1 max-w-xs mx-auto">Select a campaign or start a new placement batch to populate this view.</p>
                  {!selectedCampaign ? (
                    <div className="mt-6 inline-flex items-center gap-2 px-4 py-2 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                      <AlertCircle className="w-4 h-4 text-amber-500" />
                      <span className="text-[11px] text-amber-500 font-bold uppercase">Select a campaign first</span>
                    </div>
                  ) : (
                    <button 
                      onClick={() => setIsCreatorOpen(true)}
                      className="mt-6 text-blue-500 hover:text-blue-400 text-xs font-bold uppercase tracking-widest flex items-center gap-2 mx-auto"
                    >
                      <Plus className="w-4 h-4" /> Create first placement
                    </button>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      {isCreatorOpen && (
        <PlacementCreator onClose={() => setIsCreatorOpen(false)} />
      )}

      {isBulkNamingOpen && (
        <BulkNamingModal 
          items={filteredPlacements.filter(p => selectedRows.has(p.id)).map((p) => ({ id: p.id, name: p.name }))}
          entityLabel="Placements"
          onClose={() => setIsBulkNamingOpen(false)}
          onApply={(config) => {
            selectedRows.forEach(id => {
              const p = filteredPlacements.find(p => p.id === id);
              if (!p) return;
              const newName = applyBulkNamingConfig(p.name, config);
              updatePlacementName(id, newName);
            });
            setIsBulkNamingOpen(false);
            setSelectedRows(new Set());
          }}
        />
      )}

      {/* Link Creative Modal */}
      {isLinkModalOpen && activePlacement && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 w-full max-w-2xl shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h3 className="text-xl font-bold text-white">Link Creative to Placement</h3>
                <p className="text-slate-400 text-sm mt-1">Select a creative to assign to <span className="text-blue-400 font-mono">{activePlacement.name}</span></p>
              </div>
              <button onClick={() => setIsLinkModalOpen(false)} className="text-slate-500 hover:text-white transition-colors">
                <ArrowUpDown className="w-5 h-5 rotate-45" />
              </button>
            </div>

            <div className="relative mb-6">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
              <input 
                type="text" 
                placeholder="Search creatives..." 
                className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2 pl-10 pr-4 text-sm text-white focus:outline-none focus:border-blue-500 transition-all"
                value={creativeSearch}
                onChange={(e) => setCreativeSearch(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-1 gap-2 max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
              {creatives
                .filter(c => c.name.toLowerCase().includes(creativeSearch.toLowerCase()))
                .map(creative => (
                  <button
                    key={creative.id}
                    onClick={() => handleLinkCreative(creative.id)}
                    className="flex items-center gap-4 p-3 bg-slate-950/50 border border-slate-800 rounded-2xl hover:border-blue-500/50 hover:bg-blue-600/5 transition-all text-left group"
                  >
                    <div className="w-12 h-12 bg-slate-900 rounded-lg border border-slate-800 overflow-hidden flex items-center justify-center shrink-0">
                      {creative.thumbnailUrl ? (
                        <img src={creative.thumbnailUrl} className="w-full h-full object-cover" alt="" referrerPolicy="no-referrer" />
                      ) : (
                        <Layers className="w-5 h-5 text-slate-700" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-bold text-slate-200 truncate group-hover:text-blue-400 transition-colors">{creative.name}</h4>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{creative.type}</span>
                        <span className="text-[10px] font-bold text-slate-600">{creative.size}</span>
                      </div>
                    </div>
                    <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                    </div>
                  </button>
                ))}
              {creatives.length === 0 && (
                <div className="p-12 text-center">
                  <AlertCircle className="w-8 h-8 text-slate-700 mx-auto mb-3" />
                  <p className="text-slate-500 text-sm">No creatives found for this advertiser.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <Toast 
        {...toast} 
        onClose={() => setToast(prev => ({ ...prev, show: false }))} 
      />
    </div>
  );
};

export default PlacementGrid;
