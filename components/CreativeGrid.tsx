
import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { Creative } from '../types';
import { 
  Search, 
  Filter, 
  Grid, 
  List, 
  ExternalLink, 
  MoreVertical,
  Image as ImageIcon,
  FileCode,
  Video,
  RefreshCw,
  AlertCircle,
  Copy,
  Check,
  Plus
} from 'lucide-react';
import Toast from './Toast';

const CreativeGrid: React.FC = () => {
  const { creatives, selectedAdvertiser, fetchCreatives, connectionStatus, uploadCreative, accountId } = useApp();
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  
  const [toast, setToast] = useState<{show: boolean, type: 'success' | 'error' | 'loading', message: string, details?: string, link?: string}>({
    show: false,
    type: 'loading',
    message: ''
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedAdvertiser) return;

    setToast({
      show: true,
      type: 'loading',
      message: 'Uploading creative to CM360...',
      details: `Processing ${file.name} and registering asset.`
    });

    const result = await uploadCreative(file, file.name.split('.')[0], 'Display');
    
    if (result.success) {
      const verifyLink = `https://campaignmanager.google.com/trafficking/#/accounts/${accountId}/advertisers/${selectedAdvertiser.id}/creatives/${result.id}`;
      setToast({
        show: true,
        type: 'success',
        message: 'Upload Successful!',
        details: 'The creative has been registered and is now available in Campaign Manager.',
        link: verifyLink
      });
    } else {
      setToast({
        show: true,
        type: 'error',
        message: 'Upload Failed',
        details: result.error || 'Check your internet connection and API permissions.'
      });
    }
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleRefresh = async () => {
    if (selectedAdvertiser) {
      setLoading(true);
      await fetchCreatives();
      setLoading(false);
    }
  };

  const filteredCreatives = creatives.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getIcon = (type: string) => {
    if (type.includes('HTML5') || type.includes('RICH_MEDIA')) return <FileCode className="w-5 h-5 text-amber-500" />;
    if (type.includes('VIDEO')) return <Video className="w-5 h-5 text-rose-500" />;
    return <ImageIcon className="w-5 h-5 text-blue-500" />;
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950/40">
      {/* Toolbar */}
      <div className="p-4 border-b border-slate-800 flex items-center justify-between gap-4 bg-slate-900/50 backdrop-blur-sm">
        <div className="flex-1 max-w-md relative">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
          <input 
            type="text" 
            placeholder="Search creatives in this advertiser..." 
            className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2 pl-10 pr-4 text-sm focus:outline-none focus:border-blue-500 transition-all placeholder:text-slate-600"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        
        <div className="flex items-center gap-2">
          <div className="flex p-1 bg-slate-950 rounded-lg border border-slate-800 mr-2">
            <button 
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded-md transition-all ${viewMode === 'grid' ? 'bg-slate-800 text-blue-400' : 'text-slate-600 hover:text-slate-400'}`}
            >
              <Grid className="w-4 h-4" />
            </button>
            <button 
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded-md transition-all ${viewMode === 'list' ? 'bg-slate-800 text-blue-400' : 'text-slate-600 hover:text-slate-400'}`}
            >
              <List className="w-4 h-4" />
            </button>
          </div>

          <button 
            onClick={handleRefresh}
            disabled={loading || !selectedAdvertiser}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-bold transition-all border border-slate-700 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Sync Assets
          </button>

          <div className="relative">
            <input 
              type="file" 
              id="creative-upload" 
              className="hidden" 
              onChange={handleFileUpload}
              accept="image/*,video/*"
            />
            <label 
              htmlFor="creative-upload"
              className={`flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold transition-all shadow-lg shadow-blue-500/20 cursor-pointer ${toast.type === 'loading' && toast.show ? 'opacity-50 pointer-events-none' : ''}`}
            >
              {toast.type === 'loading' && toast.show ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Upload Creative
            </label>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6 custom-scrollbar">
        {!selectedAdvertiser ? (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 bg-slate-900 rounded-2xl flex items-center justify-center mb-6 border border-slate-800">
              <AlertCircle className="w-8 h-8 text-amber-500" />
            </div>
            <h3 className="text-slate-300 font-bold">No Advertiser Selected</h3>
            <p className="text-slate-500 text-xs mt-1 max-w-xs mx-auto">Please select an advertiser from the sidebar to view its creative assets.</p>
          </div>
        ) : filteredCreatives.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 bg-slate-900 rounded-2xl flex items-center justify-center mb-6 border border-slate-800">
              <ImageIcon className="w-8 h-8 text-slate-700" />
            </div>
            <h3 className="text-slate-300 font-bold">No creatives found</h3>
            <p className="text-slate-500 text-xs mt-1 max-w-xs mx-auto">Try syncing assets or adjusting your search terms.</p>
            <button 
              onClick={handleRefresh}
              className="mt-6 text-blue-500 hover:text-blue-400 text-xs font-bold uppercase tracking-widest flex items-center gap-2 mx-auto"
            >
              <RefreshCw className="w-4 h-4" /> Sync now
            </button>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6">
            {filteredCreatives.map((creative) => (
              <div key={creative.id} className="group bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden hover:border-blue-500/30 transition-all hover:shadow-xl hover:shadow-blue-500/5">
                <div className="aspect-square bg-slate-950 relative overflow-hidden flex items-center justify-center border-b border-slate-800">
                  {creative.thumbnailUrl ? (
                    <div className="w-full h-full relative group-hover:scale-105 transition-transform duration-700">
                      <img 
                        src={creative.thumbnailUrl} 
                        alt={creative.name}
                        className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                        referrerPolicy="no-referrer"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 to-transparent" />
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-slate-700">
                      {getIcon(creative.type)}
                      <span className="text-[10px] font-bold uppercase tracking-widest">No Preview</span>
                    </div>
                  )}
                  <div className="absolute inset-0 bg-slate-950/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                    {creative.externalUrl && (
                      <a 
                        href={creative.externalUrl} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="p-2 bg-blue-600 rounded-lg text-white hover:bg-blue-500 transition-colors shadow-lg flex items-center justify-center"
                        title="View in CM360"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    )}
                    <button className="p-2 bg-slate-800 rounded-lg text-white hover:bg-slate-700 transition-colors border border-slate-700">
                      <MoreVertical className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="absolute top-3 left-3">
                    <span className="px-2 py-1 rounded-md bg-slate-900/80 backdrop-blur-md border border-slate-700 text-[9px] font-bold text-slate-300 uppercase tracking-wider">
                      {creative.size}
                    </span>
                  </div>
                </div>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      <h4 className="text-xs font-bold text-slate-200 truncate" title={creative.name}>
                        {creative.name}
                      </h4>
                      <button 
                        onClick={() => handleCopy(creative.name, creative.id)}
                        className={`shrink-0 p-1 rounded transition-all ${
                          copiedId === creative.id ? 'text-emerald-500 bg-emerald-500/10' : 'text-slate-600 hover:text-slate-400 hover:bg-slate-800'
                        }`}
                        title="Copy name"
                      >
                        {copiedId === creative.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      </button>
                    </div>
                    {getIcon(creative.type)}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-500 font-medium truncate max-w-[120px]">
                      {creative.type.replace(/_/g, ' ')}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <div className={`w-1 h-1 rounded-full ${creative.status === 'Active' ? 'bg-emerald-500' : 'bg-slate-600'}`} />
                      <span className="text-[9px] font-bold text-slate-600 uppercase tracking-tighter">{creative.status}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-900 border-b border-slate-800">
                  <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-slate-500">Preview</th>
                  <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-slate-500">Name</th>
                  <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-slate-500">Type</th>
                  <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-slate-500">Dimensions</th>
                  <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-slate-500">Status</th>
                  <th className="p-4 w-12"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {filteredCreatives.map((creative) => (
                  <tr key={creative.id} className="group hover:bg-blue-600/[0.03] transition-colors">
                    <td className="p-4">
                      <div className="w-10 h-10 bg-slate-950 rounded-lg border border-slate-800 overflow-hidden flex items-center justify-center">
                        {creative.thumbnailUrl ? (
                          <img src={creative.thumbnailUrl} className="w-full h-full object-contain" alt="" referrerPolicy="no-referrer" />
                        ) : (
                          getIcon(creative.type)
                        )}
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-200">{creative.name}</span>
                        <button 
                          onClick={() => handleCopy(creative.name, creative.id)}
                          className={`p-1 rounded transition-all ${
                            copiedId === creative.id ? 'text-emerald-500 bg-emerald-500/10' : 'text-slate-600 hover:text-slate-400 hover:bg-slate-800'
                          }`}
                          title="Copy name"
                        >
                          {copiedId === creative.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        </button>
                      </div>
                    </td>
                    <td className="p-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider">{creative.type.replace(/_/g, ' ')}</td>
                    <td className="p-4">
                      <span className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-[10px] font-bold text-slate-400">
                        {creative.size}
                      </span>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <div className={`w-1.5 h-1.5 rounded-full ${creative.status === 'Active' ? 'bg-emerald-500 shadow-sm shadow-emerald-500/50' : 'bg-slate-600'}`} />
                        <span className="text-[10px] font-bold uppercase text-slate-400">{creative.status}</span>
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        {creative.externalUrl && (
                          <a 
                            href={creative.externalUrl} 
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
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Toast 
        {...toast} 
        onClose={() => setToast(prev => ({ ...prev, show: false }))} 
      />
    </div>
  );
};

export default CreativeGrid;
