
import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { Creative } from '../types';
import { CM360_ERROR_MAPPING } from '../constants';
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
  Plus,
  HelpCircle,
  ChevronDown as ChevronDownIcon,
  X as XIcon
} from 'lucide-react';
import Toast from './Toast';

const CreativeGrid: React.FC = () => {
  const { creatives, selectedAdvertiser, selectedCampaign, fetchCreatives, connectionStatus, uploadCreative, accountId } = useApp();
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [customName, setCustomName] = useState('');
  const [selectedFormat, setSelectedFormat] = useState('Display');
  const [selectedSize, setSelectedSize] = useState('');
  const [isErrorGuideOpen, setIsErrorGuideOpen] = useState(false);
  
  const CREATIVE_SPECS: Record<string, string[]> = {
    'Display': ['970x250', '970x90', '728x90', '300x250', '160x600', '300x600', '300x1050', '468x60', '250x250', '200x200'],
    'Mobile Display': ['320x50', '300x50', '320x480', '480x320'],
    'Tracking': ['1x1'],
    'Rich Media': ['728x90', '300x250', '160x600', '300x600', 'Interstitial'],
    'Video': ['In-stream', 'Companion 300x250', 'Companion 728x90', 'Companion 300x60', 'Companion 160x600']
  };
  
  const CREATIVE_FORMATS = Object.keys(CREATIVE_SPECS);
  
  const [toast, setToast] = useState<{show: boolean, type: 'success' | 'error' | 'loading', message: string, details?: string, link?: string}>({
    show: false,
    type: 'loading',
    message: ''
  });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedAdvertiser) return;

    setPendingFile(file);
    setCustomName(file.name.split('.')[0]);
    
    const initialFormat = file.type.startsWith('video/') ? 'Video' : 'Display';
    setSelectedFormat(initialFormat);
    
    // Auto-detect image dimensions
    if (file.type.startsWith('image/')) {
      const img = new Image();
      img.onload = () => {
        const detectedSize = `${img.width}x${img.height}`;
        setSelectedSize(detectedSize);
        URL.revokeObjectURL(img.src);
      };
      img.src = URL.createObjectURL(file);
    } else {
      setSelectedSize(CREATIVE_SPECS[initialFormat][0]);
    }
    
    setIsUploadModalOpen(true);
    
    // Reset input so the same file can be selected again if needed
    e.target.value = '';
  };

  const confirmUpload = async () => {
    if (!pendingFile || !selectedAdvertiser) return;

    const campaignPrefix = selectedCampaign ? `${selectedCampaign.name.substring(0, 10)}_` : '';
    const finalName = `${campaignPrefix}${customName}_${selectedFormat}_${selectedSize.replace(/\s+/g, '_')}`;
    setIsUploadModalOpen(false);

    setToast({
      show: true,
      type: 'loading',
      message: 'Uploading creative to CM360...',
      details: `Processing ${finalName} and registering asset.`
    });

    const result = await uploadCreative(pendingFile, finalName, selectedFormat, selectedSize);
    
    if (result.success) {
      const baseUrl = `https://campaignmanager.google.com/trafficking/#/accounts/${accountId}`;
      const creativePath = `/advertisers/${selectedAdvertiser.id}/creatives/${result.id}`;
      const verifyLink = `${baseUrl}${creativePath}`;
      
      setToast({
        show: true,
        type: 'success',
        message: 'Upload Successful!',
        details: 'The creative has been registered and is now available in Campaign Manager.',
        link: verifyLink
      });
    } else {
      // Translate error
      const errorCode = result.error?.match(/\d+/)?.[0] || (result.error === 'Network error' ? 'Network error' : 'default');
      const mappedError = CM360_ERROR_MAPPING[errorCode] || CM360_ERROR_MAPPING['default'];

      setToast({
        show: true,
        type: 'error',
        message: mappedError.title,
        details: `${mappedError.description} (Original: ${result.error})`
      });
    }
    
    setPendingFile(null);
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

  const filteredCreatives = creatives.filter(c => {
    const matchesSearch = c.name.toLowerCase().includes(searchTerm.toLowerCase());
    // If a campaign is selected, we might want to filter creatives by campaign, 
    // but CM360 creatives are advertiser-level. 
    // However, for UX, we can filter by name if they follow the campaign prefix convention we just added.
    const matchesCampaign = !selectedCampaign || c.name.toLowerCase().includes(selectedCampaign.name.substring(0, 5).toLowerCase());
    return matchesSearch && matchesCampaign;
  });

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

          <button 
            onClick={() => setIsErrorGuideOpen(true)}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 rounded-lg border border-slate-700 transition-all"
            title="Guía de errores"
          >
            <HelpCircle className="w-4 h-4" />
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

      {/* Upload Confirmation Modal */}
      {isUploadModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 w-full max-w-md shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-xl font-bold text-white mb-2">Configure Creative</h3>
            <p className="text-slate-400 text-sm mb-6">
              {selectedCampaign ? `Uploading to Campaign: ${selectedCampaign.name}` : 'Review the name and format before uploading to CM360.'}
            </p>
            
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-500 mb-2">Base Name</label>
                <div className="flex items-center gap-2">
                  {selectedCampaign && (
                    <span className="px-2 py-3 bg-slate-950 border border-slate-800 rounded-xl text-[10px] font-mono text-slate-500">
                      {selectedCampaign.name.substring(0, 10)}_
                    </span>
                  )}
                  <input 
                    type="text"
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500 transition-all"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    placeholder="Creative name..."
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-500 mb-2">Format</label>
                <div className="grid grid-cols-3 gap-2">
                  {CREATIVE_FORMATS.map(format => (
                    <button
                      key={format}
                      onClick={() => {
                        setSelectedFormat(format);
                        setSelectedSize(CREATIVE_SPECS[format][0]);
                      }}
                      className={`py-2 rounded-lg text-[10px] font-bold transition-all border ${
                        selectedFormat === format 
                          ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-500/20' 
                          : 'bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      {format}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-500 mb-2">Size / Variant</label>
                <div className="grid grid-cols-2 gap-2 max-h-32 overflow-y-auto custom-scrollbar pr-1">
                  {CREATIVE_SPECS[selectedFormat].map(size => (
                    <button
                      key={size}
                      onClick={() => setSelectedSize(size)}
                      className={`py-2 px-3 rounded-lg text-[10px] font-bold transition-all border text-left ${
                        selectedSize === size 
                          ? 'bg-indigo-600/20 border-indigo-500 text-indigo-400' 
                          : 'bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-400'
                      }`}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 mt-4">
                <label className="block text-[9px] uppercase font-bold text-slate-600 mb-1">Final Name Preview</label>
                <p className="text-xs font-mono text-blue-400 truncate">
                  {selectedCampaign ? `${selectedCampaign.name.substring(0, 10)}_` : ''}{customName}_{selectedFormat}_{selectedSize.replace(/\s+/g, '_')}
                </p>
              </div>
              
              <div className="flex gap-3 pt-4">
                <button 
                  onClick={() => setIsUploadModalOpen(false)}
                  className="flex-1 py-3 text-slate-400 hover:text-white font-bold transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={confirmUpload}
                  className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold transition-all shadow-lg shadow-blue-600/20"
                >
                  Confirm & Upload
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Error Guide Modal */}
      {isErrorGuideOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 w-full max-w-2xl shadow-2xl animate-in fade-in zoom-in-95 duration-200 relative">
            <button 
              onClick={() => setIsErrorGuideOpen(false)}
              className="absolute top-6 right-6 p-2 text-slate-500 hover:text-white hover:bg-slate-800 rounded-xl transition-all"
            >
              <XIcon className="w-5 h-5" />
            </button>
            
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-blue-600/10 rounded-xl flex items-center justify-center">
                <HelpCircle className="w-6 h-6 text-blue-500" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white">Guía de Errores CM360</h3>
                <p className="text-slate-400 text-sm">Traducción de errores técnicos a lenguaje natural.</p>
              </div>
            </div>
            
            <div className="space-y-3 max-h-[60vh] overflow-y-auto custom-scrollbar pr-2">
              {Object.entries(CM360_ERROR_MAPPING).map(([code, error]) => (
                <div key={code} className="p-4 bg-slate-950/50 border border-slate-800 rounded-2xl hover:border-slate-700 transition-all">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-mono text-slate-600 uppercase tracking-widest">{code === 'default' ? 'Otros' : `Error ${code}`}</span>
                    <span className="text-xs font-bold text-blue-400">{error.title}</span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">{error.description}</p>
                </div>
              ))}
            </div>
            
            <div className="mt-8 p-4 bg-blue-600/5 border border-blue-500/20 rounded-2xl">
              <p className="text-[11px] text-blue-400/80 leading-relaxed italic">
                * El error 100012 suele ocurrir cuando el formato elegido (ej: Video) no coincide con el archivo subido (ej: una imagen .png). Asegúrate de que el archivo y el formato seleccionado en la modal sean coherentes.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CreativeGrid;
