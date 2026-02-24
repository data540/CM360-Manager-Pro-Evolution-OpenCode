
import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Status } from '../types';
import { 
  Search, 
  Plus, 
  ArrowUpDown,
  ExternalLink,
  Calendar,
  Target,
  MoreVertical,
  RefreshCw,
  LayoutDashboard,
  Check,
  Pause,
  Play,
  Archive,
  ChevronDown,
  Zap,
  Edit3
} from 'lucide-react';
import Toast from './Toast';

const CampaignGrid: React.FC = () => {
  const { 
    campaigns, 
    campaignsDrafts,
    selectedAdvertiser, 
    setSelectedCampaign,
    setCurrentView,
    fetchCampaigns,
    updateCampaignDraft,
    pushCampaigns,
    isCampaignsLoading,
    accountId,
    connectionStatus
  } = useApp();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<'name' | 'dates' | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editStartDate, setEditStartDate] = useState('');
  const [editEndDate, setEditEndDate] = useState('');

  const [toast, setToast] = useState<{show: boolean, type: 'success' | 'error' | 'loading', message: string, details?: string, link?: string}>({
    show: false,
    type: 'loading',
    message: ''
  });

  const handleRefresh = async () => {
    if (!selectedAdvertiser) return;
    await fetchCampaigns(selectedAdvertiser.id);
  };

  const handleStatusChange = async (campaignId: string, newStatus: Status) => {
    setActiveMenu(null);
    updateCampaignDraft(campaignId, { status: newStatus });
  };

  const toggleRow = (id: string) => {
    const newSelected = new Set(selectedRows);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedRows(newSelected);
  };

  const toggleAll = () => {
    if (selectedRows.size === filteredCampaigns.length) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(filteredCampaigns.map(c => c.id)));
    }
  };

  const handlePushToCM360 = async () => {
    if (selectedRows.size === 0) return;
    
    setToast({
      show: true,
      type: 'loading',
      message: `Pushing ${selectedRows.size} campaigns to CM360...`
    });

    const result = await pushCampaigns(Array.from(selectedRows));

    if (result.failed === 0) {
      setToast({
        show: true,
        type: 'success',
        message: 'Push Successful',
        details: `Successfully pushed ${result.success} campaigns to CM360.`
      });
      setSelectedRows(new Set());
    } else {
      setToast({
        show: true,
        type: 'error',
        message: 'Push Partially Failed',
        details: `Pushed ${result.success} successfully, but ${result.failed} failed.`
      });
    }
  };

  const filteredCampaigns = campaigns.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950/40">
      <div className="p-4 border-b border-slate-800 flex items-center justify-between gap-4 bg-slate-900/50 backdrop-blur-sm">
        <div className="flex-1 max-w-md relative">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
          <input 
            type="text" 
            placeholder="Search campaigns..." 
            className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2 pl-10 pr-4 text-sm focus:outline-none focus:border-blue-500 transition-all placeholder:text-slate-600"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        
        <div className="flex items-center gap-2">
          <button 
            onClick={handlePushToCM360}
            disabled={selectedRows.size === 0 || connectionStatus !== 'Connected'}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50 disabled:shadow-none"
          >
            <Zap className="w-3.5 h-3.5" />
            Push to CM360 ({selectedRows.size})
          </button>
          <button 
            onClick={handleRefresh}
            disabled={!selectedAdvertiser || isCampaignsLoading}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-bold transition-all border border-slate-700 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isCampaignsLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button 
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold transition-all shadow-lg shadow-blue-500/20"
            onClick={() => {
              window.dispatchEvent(new CustomEvent('open-campaign-modal'));
            }}
          >
            <Plus className="w-4 h-4" />
            Create Campaign
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
                  className="rounded border-slate-700 bg-slate-950 text-blue-600 focus:ring-blue-500 focus:ring-offset-slate-900"
                  checked={selectedRows.size === filteredCampaigns.length && filteredCampaigns.length > 0}
                  onChange={toggleAll}
                />
              </th>
              <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                <div className="flex items-center gap-2 cursor-pointer hover:text-slate-300 transition-colors">
                  Campaign Name <ArrowUpDown className="w-3 h-3" />
                </div>
              </th>
              <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-slate-500">Status</th>
              <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-slate-500">Flight Dates</th>
              <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-slate-500">Budget</th>
              <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-slate-500">Objective</th>
              <th className="p-4 w-12"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50">
            {filteredCampaigns.map((c) => {
              const draft = campaignsDrafts[c.id];
              const displayCampaign = draft ? { ...c, ...draft } : c;
              
              return (
                <tr 
                  key={c.id} 
                  className={`group hover:bg-blue-600/[0.03] transition-colors cursor-pointer ${selectedRows.has(c.id) ? 'bg-blue-600/[0.05]' : ''}`}
                  onClick={() => {
                    setSelectedCampaign(c);
                    setCurrentView('Placements');
                  }}
                >
                  <td className="p-4" onClick={(e) => e.stopPropagation()}>
                    <input 
                      type="checkbox" 
                      className="rounded border-slate-700 bg-slate-950 text-blue-600 focus:ring-blue-500 focus:ring-offset-slate-900"
                      checked={selectedRows.has(c.id)}
                      onChange={() => toggleRow(c.id)}
                    />
                  </td>
                  <td className="p-4">
                    {editingId === c.id && editingField === 'name' ? (
                      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <input 
                          autoFocus
                          className="bg-slate-950 border border-blue-500 rounded px-2 py-1 text-sm font-bold text-slate-200 outline-none w-full"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={() => {
                            updateCampaignDraft(c.id, { name: editValue });
                            setEditingId(null);
                            setEditingField(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              updateCampaignDraft(c.id, { name: editValue });
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
                      <div className="flex flex-col group/name" onClick={(e) => {
                        e.stopPropagation();
                        setEditingId(c.id);
                        setEditingField('name');
                        setEditValue(displayCampaign.name);
                      }}>
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-bold transition-colors ${displayCampaign.isDraft ? 'text-amber-400' : 'text-slate-200 group-hover:text-blue-400'}`}>
                            {displayCampaign.name}
                          </span>
                          <Edit3 className="w-3 h-3 opacity-0 group-hover/name:opacity-100 transition-opacity text-slate-500" />
                        </div>
                        <span className="text-[10px] text-slate-500 font-mono mt-0.5">ID: {c.id}</span>
                      </div>
                    )}
                  </td>
                  <td className="p-4">
                    <div className="relative">
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveMenu(activeMenu === c.id ? null : c.id);
                        }}
                        className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-slate-800 transition-all"
                      >
                        <div className={`w-1.5 h-1.5 rounded-full ${displayCampaign.status === 'Active' ? 'bg-emerald-500 shadow-sm shadow-emerald-500/50' : displayCampaign.status === 'Paused' ? 'bg-amber-500' : 'bg-slate-600'}`} />
                        <span className={`text-[10px] font-bold uppercase ${displayCampaign.status === 'Active' ? 'text-emerald-500' : displayCampaign.status === 'Paused' ? 'text-amber-500' : 'text-slate-400'}`}>
                          {displayCampaign.status} {displayCampaign.isDraft && displayCampaign.status !== c.status ? '(Draft)' : ''}
                        </span>
                        <ChevronDown className="w-3 h-3 text-slate-600" />
                      </button>

                      {activeMenu === c.id && (
                        <div 
                          className="absolute top-full left-0 mt-1 w-32 bg-slate-900 border border-slate-800 rounded-lg shadow-xl z-20 py-1 animate-in fade-in slide-in-from-top-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {(['Active', 'Paused', 'Completed'] as Status[]).map((status) => (
                            <button
                              key={status}
                              onClick={() => handleStatusChange(c.id, status)}
                              className={`w-full flex items-center justify-between px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                                displayCampaign.status === status ? 'text-blue-400 bg-blue-400/5' : 'text-slate-400 hover:text-white hover:bg-slate-800'
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                {status === 'Active' && <Play className="w-3 h-3" />}
                                {status === 'Paused' && <Pause className="w-3 h-3" />}
                                {status === 'Completed' && <Archive className="w-3 h-3" />}
                                {status}
                              </div>
                              {displayCampaign.status === status && <Check className="w-3 h-3" />}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="p-4">
                    {editingId === c.id && editingField === 'dates' ? (
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <input 
                          type="date"
                          className="bg-slate-950 border border-blue-500 rounded px-1 py-0.5 text-[10px] outline-none text-slate-300"
                          value={editStartDate}
                          onChange={(e) => setEditStartDate(e.target.value)}
                        />
                        <span className="text-slate-800">—</span>
                        <input 
                          type="date"
                          className="bg-slate-950 border border-blue-500 rounded px-1 py-0.5 text-[10px] outline-none text-slate-300"
                          value={editEndDate}
                          onChange={(e) => setEditEndDate(e.target.value)}
                        />
                        <button 
                          onClick={() => {
                            updateCampaignDraft(c.id, { startDate: editStartDate, endDate: editEndDate });
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
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingId(c.id);
                          setEditingField('dates');
                          setEditStartDate(displayCampaign.startDate);
                          setEditEndDate(displayCampaign.endDate);
                        }}
                      >
                        <div className="flex items-center gap-2 text-[11px] text-slate-400">
                          <Calendar className="w-3 h-3 text-slate-600" />
                          <span className={displayCampaign.isDraft && (displayCampaign.startDate !== c.startDate || displayCampaign.endDate !== c.endDate) ? 'text-amber-400' : ''}>
                            {displayCampaign.startDate} <span className="text-slate-700">—</span> {displayCampaign.endDate}
                          </span>
                        </div>
                        <Edit3 className="w-3 h-3 opacity-0 group-hover/dates:opacity-100 transition-opacity text-slate-500" />
                      </div>
                    )}
                  </td>
                  <td className="p-4">
                    <span className="text-[11px] font-mono text-slate-300">
                      ${c.budget.toLocaleString()}
                    </span>
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <Target className="w-3 h-3 text-slate-600" />
                      <span className="text-[11px] text-slate-400">{c.objective || 'Not set'}</span>
                    </div>
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <a 
                        href={`https://campaignmanager.google.com/trafficking/#/accounts/${accountId}/advertisers/${c.advertiserId}/campaigns/${c.id}`}
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="p-1.5 rounded-md text-slate-500 hover:text-blue-400 hover:bg-blue-400/10 transition-all"
                        title="Open in CM360"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveMenu(activeMenu === c.id ? null : c.id);
                        }}
                        className="p-1.5 rounded-md text-slate-600 hover:bg-slate-800 hover:text-slate-300 transition-all"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filteredCampaigns.length === 0 && (
              <tr>
                <td colSpan={7} className="p-32 text-center">
                  <div className="w-16 h-16 bg-slate-900 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-slate-800">
                    <LayoutDashboard className="w-8 h-8 text-slate-700" />
                  </div>
                  <h3 className="text-slate-300 font-bold">No campaigns found</h3>
                  <p className="text-slate-500 text-xs mt-1 max-w-xs mx-auto">
                    {selectedAdvertiser 
                      ? "We couldn't find any active campaigns for this advertiser."
                      : "Select an advertiser from the sidebar to view campaigns."}
                  </p>
                  {selectedAdvertiser && (
                    <button 
                      onClick={() => window.dispatchEvent(new CustomEvent('open-campaign-modal'))}
                      className="mt-6 text-blue-500 hover:text-blue-400 text-xs font-bold uppercase tracking-widest flex items-center gap-2 mx-auto"
                    >
                      <Plus className="w-4 h-4" /> Create your first campaign
                    </button>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Toast 
        {...toast} 
        onClose={() => setToast(prev => ({ ...prev, show: false }))} 
      />
    </div>
  );
};

export default CampaignGrid;

