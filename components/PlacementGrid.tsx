
import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Placement } from '../types';
import BulkCreateWizard from './BulkCreateWizard';
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
  CheckCircle2
} from 'lucide-react';
import Toast from './Toast';

const PlacementGrid: React.FC = () => {
  const { placements, selectedCampaign, deletePlacement, pushPlacements, accountId, selectedAdvertiser } = useApp();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [isCreatorOpen, setIsCreatorOpen] = useState(false);
  
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
      message: `Pushing ${selectedRows.size} placements to CM360...`,
      details: 'Connecting to Google API and registering entities.'
    });

    const result = await pushPlacements(Array.from(selectedRows));
    
    if (result.success > 0) {
      const lastItem = result.createdItems[result.createdItems.length - 1];
      const verifyLink = `https://campaignmanager.google.com/trafficking/#/accounts/${accountId}/advertisers/${selectedAdvertiser?.id}/placements/${lastItem.cmId}`;
      
      setToast({
        show: true,
        type: 'success',
        message: 'Push Successful!',
        details: `${result.success} placements registered correctly in Campaign Manager. ${result.failed > 0 ? `${result.failed} failed.` : ''}`,
        link: verifyLink
      });
    } else {
      setToast({
        show: true,
        type: 'error',
        message: 'Push Failed',
        details: result.error || 'None of the selected placements could be registered. Check API permissions.'
      });
    }
    
    setSelectedRows(new Set());
  };

  const filteredPlacements = placements.filter(p => {
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

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950/40">
      <div className="p-4 border-b border-slate-800 flex items-center justify-between gap-4 bg-slate-900/50 backdrop-blur-sm">
        <div className="flex-1 max-w-md relative">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
          <input 
            type="text" 
            placeholder="Search placements in this campaign..." 
            className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2 pl-10 pr-4 text-sm focus:outline-none focus:border-blue-500 transition-all placeholder:text-slate-600"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        
        <div className="flex items-center gap-2">
          {selectedRows.size > 0 && (
            <div className="flex items-center bg-blue-600/10 px-3 py-1.5 rounded-lg border border-blue-500/20 gap-3 mr-4 animate-in fade-in slide-in-from-right-4">
              <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider">{selectedRows.size} selected</span>
              <div className="w-px h-4 bg-blue-500/20" />
              <button className="text-slate-400 hover:text-white transition-colors" title="Bulk Naming"><Zap className="w-3.5 h-3.5" /></button>
              <button className="text-slate-400 hover:text-white transition-colors" title="Duplicate"><Copy className="w-3.5 h-3.5" /></button>
              <button 
                onClick={() => {
                  selectedRows.forEach(id => deletePlacement(id));
                  setSelectedRows(new Set());
                }}
                className="text-rose-500 hover:text-rose-400 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          <button 
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-bold transition-all border border-slate-700"
          >
            <FileDown className="w-3.5 h-3.5" />
            Export CSV
          </button>
          <button 
            onClick={handlePushToCM360}
            disabled={selectedRows.size === 0 || toast.type === 'loading' && toast.show}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition-all shadow-lg shadow-indigo-500/20 disabled:opacity-50 disabled:grayscale"
          >
            {toast.type === 'loading' && toast.show ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            Push to CM360 ({selectedRows.size})
          </button>
          <button 
            onClick={() => setIsCreatorOpen(true)}
            disabled={!selectedCampaign}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50 disabled:grayscale"
          >
            <PlusCircle className="w-4 h-4" />
            New Placement
          </button>
          <button 
            onClick={() => setIsWizardOpen(true)}
            disabled={!selectedCampaign}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold transition-all shadow-lg shadow-blue-500/20 disabled:opacity-50 disabled:grayscale"
          >
            <Plus className="w-4 h-4" />
            Bulk Create
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto relative custom-scrollbar">
        <table className="w-full text-left border-collapse min-w-[1000px]">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-900/90 backdrop-blur-md border-b border-slate-800">
              <th className="p-4 w-12">
                <input 
                  type="checkbox" 
                  className="rounded border-slate-700 bg-slate-800 text-blue-600 focus:ring-blue-500/20 w-4 h-4 cursor-pointer"
                  checked={filteredPlacements.length > 0 && selectedRows.size === filteredPlacements.length}
                  onChange={toggleSelectAll}
                />
              </th>
              <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                <div className="flex items-center gap-2 cursor-pointer hover:text-slate-300 transition-colors">
                  Placement Name <ArrowUpDown className="w-3 h-3" />
                </div>
              </th>
              <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-slate-500">Site</th>
              <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-slate-500">Dimensions</th>
              <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-slate-500">Type</th>
              <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-slate-500">Status</th>
              <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-slate-500">Flight Dates</th>
              <th className="p-4 w-12"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50">
            {filteredPlacements.map((p) => (
              <tr 
                key={p.id} 
                className={`group hover:bg-blue-600/[0.03] transition-colors ${selectedRows.has(p.id) ? 'bg-blue-600/5' : ''}`}
              >
                <td className="p-4">
                  <input 
                    type="checkbox" 
                    className="rounded border-slate-700 bg-slate-800 text-blue-600 focus:ring-blue-500/20 w-4 h-4 cursor-pointer"
                    checked={selectedRows.has(p.id)}
                    onChange={() => toggleSelectRow(p.id)}
                  />
                </td>
                <td className="p-4 font-mono text-[11px] text-slate-300 group-hover:text-blue-400 cursor-pointer transition-colors">
                  {p.name}
                </td>
                <td className="p-4 text-[11px] font-bold text-slate-400 uppercase tracking-tighter">
                  {p.siteId}
                </td>
                <td className="p-4">
                  <span className="inline-flex px-2 py-0.5 rounded bg-slate-900 text-[10px] font-bold text-slate-400 border border-slate-800 group-hover:border-blue-500/20 transition-all">
                    {p.size}
                  </span>
                </td>
                <td className="p-4">
                  <span className={`text-[10px] font-bold uppercase tracking-widest ${
                    p.type === 'Video' ? 'text-amber-500/80' : p.type === 'Native' ? 'text-emerald-500/80' : 'text-blue-500/80'
                  }`}>
                    {p.type}
                  </span>
                </td>
                <td className="p-4">
                  <div className="flex items-center gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full ${p.status === 'Active' ? 'bg-emerald-500 shadow-sm shadow-emerald-500/50' : 'bg-slate-600'}`} />
                    <span className="text-[10px] font-bold uppercase text-slate-400">{p.status}</span>
                  </div>
                </td>
                <td className="p-4 text-[11px] text-slate-500 font-medium">
                  {p.startDate} <span className="mx-1 text-slate-800">—</span> {p.endDate}
                </td>
                <td className="p-4">
                  <button className="p-1.5 rounded-md text-slate-600 hover:bg-slate-800 hover:text-slate-300 transition-all">
                    <MoreVertical className="w-4 h-4" />
                  </button>
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
                      onClick={() => setIsWizardOpen(true)}
                      className="mt-6 text-blue-500 hover:text-blue-400 text-xs font-bold uppercase tracking-widest flex items-center gap-2 mx-auto"
                    >
                      <Plus className="w-4 h-4" /> Create first batch
                    </button>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {isWizardOpen && (
        <BulkCreateWizard onClose={() => setIsWizardOpen(false)} />
      )}
      {isCreatorOpen && (
        <PlacementCreator onClose={() => setIsCreatorOpen(false)} />
      )}

      <Toast 
        {...toast} 
        onClose={() => setToast(prev => ({ ...prev, show: false }))} 
      />
    </div>
  );
};

export default PlacementGrid;
