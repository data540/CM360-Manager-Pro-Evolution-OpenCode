
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
  X as XIcon,
  Layers,
  LayoutDashboard,
  SearchCode,
  UploadCloud,
  Loader2
} from 'lucide-react';
import Toast from './Toast';

const CreativeGrid: React.FC = () => {
  const { 
    creatives, 
    selectedAdvertiser, 
    selectedCampaign, 
    fetchCreatives, 
    connectionStatus, 
    uploadCreative, 
    accountId,
    isGlobalSearchActive,
    setIsGlobalSearchActive,
    advertisers,
    fetchAllCreatives,
    copyCreative,
    campaigns, 
    placements,
    fetchCampaigns,
    fetchPlacements,
    assignCreativeToPlacement
  } = useApp();
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [loading, setLoading] = useState(false);
  const [activeActionMenu, setActiveActionMenu] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isNewMenuOpen, setIsNewMenuOpen] = useState(false);
  const [selectedCreatives, setSelectedCreatives] = useState<string[]>([]);
  const [isSelectAll, setIsSelectAll] = useState(false);
  
  // Naming Convention States
  const [namingMode, setNamingMode] = useState<'prefix' | 'suffix'>('suffix');
  const [namingText, setNamingText] = useState('');
  const [includeDate, setIncludeDate] = useState(true);
  
  // Modals States
  const [activeModal, setActiveModal] = useState<'advertiser' | 'campaign' | 'placement' | null>(null);
  const [creativeToAssign, setCreativeToAssign] = useState<Creative | null>(null);
  const [destAdvertiserId, setDestAdvertiserId] = useState('');
  const [destCampaignId, setDestCampaignId] = useState('');
  const [destPlacementId, setDestPlacementId] = useState('');
  const [isAssigning, setIsAssigning] = useState(false);
  
  // Batch Upload States
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [batchProgress, setBatchProgress] = useState<{current: number, total: number, status: string} | null>(null);
  
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [customName, setCustomName] = useState('');
  const [selectedFormat, setSelectedFormat] = useState('Display');
  const [selectedSize, setSelectedSize] = useState('');
  const [isErrorGuideOpen, setIsErrorGuideOpen] = useState(false);

  useEffect(() => {
    if (activeModal === 'campaign' && destAdvertiserId) {
      fetchCampaigns(destAdvertiserId);
    }
  }, [activeModal, destAdvertiserId, fetchCampaigns]);

  useEffect(() => {
    if (activeModal === 'placement' && destCampaignId) {
      fetchPlacements(destCampaignId);
    }
  }, [activeModal, destCampaignId, fetchPlacements]);
  
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

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, isBatch: boolean = false) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0 || !selectedAdvertiser) return;

    if (isBatch || files.length > 1) {
      setPendingFiles(files);
      setCustomName('Batch_Upload');
      setSelectedFormat('Display');
      setSelectedSize(CREATIVE_SPECS['Display'][0]);
      setIsUploadModalOpen(true);
    } else {
      const file = files[0];
      setPendingFile(file);
      setPendingFiles([]);
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
    }
    
    // Reset input so the same file can be selected again if needed
    e.target.value = '';
    setIsNewMenuOpen(false);
  };

  const confirmUpload = async () => {
    if ((!pendingFile && pendingFiles.length === 0) || !selectedAdvertiser) return;

    setIsUploadModalOpen(false);
    const campaignPrefix = selectedCampaign ? `${selectedCampaign.name.substring(0, 10)}_` : '';
    const dateStr = includeDate ? `_${new Date().toLocaleDateString('es-ES').replace(/\//g, '-')}` : '';

    if (pendingFiles.length > 0) {
      // Batch Upload Logic
      setBatchProgress({ current: 0, total: pendingFiles.length, status: 'Starting batch upload...' });
      
      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < pendingFiles.length; i++) {
        const file = pendingFiles[i];
        const baseName = file.name.split('.')[0];
        let currentName = '';

        if (namingMode === 'prefix') {
          currentName = `${namingText}_${baseName}${dateStr}`;
        } else {
          currentName = `${baseName}_${namingText}${dateStr}`;
        }

        // Add format and size suffix for clarity
        currentName = `${campaignPrefix}${currentName}_${selectedFormat}_${selectedSize.replace(/\s+/g, '_')}`;
        
        setBatchProgress({ 
          current: i + 1, 
          total: pendingFiles.length, 
          status: `Uploading ${file.name} (${i + 1}/${pendingFiles.length})` 
        });

        setToast({
          show: true,
          type: 'loading',
          message: `Batch Processing: ${i + 1}/${pendingFiles.length}`,
          details: `Uploading ${file.name}...`
        });

        const result = await uploadCreative(file, currentName, selectedFormat, selectedSize);
        if (result.success) successCount++;
        else failCount++;
      }

      setBatchProgress(null);
      setPendingFiles([]);

      if (failCount === 0) {
        setToast({
          show: true,
          type: 'success',
          message: 'Batch Upload Complete!',
          details: `Successfully uploaded ${successCount} creatives to CM360.`,
          link: `https://campaignmanager.google.com/trafficking/#/accounts/${accountId}/advertisers/${selectedAdvertiser.id}/creatives`
        });
      } else {
        setToast({
          show: true,
          type: 'error',
          message: 'Batch Upload Partial Failure',
          details: `Uploaded ${successCount} successfully, but ${failCount} failed. Check error guide.`
        });
      }
    } else if (pendingFile) {
      // Single Upload Logic
      const finalName = `${campaignPrefix}${customName}_${selectedFormat}_${selectedSize.replace(/\s+/g, '_')}`;

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
    }
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleRefresh = async () => {
    setLoading(true);
    if (isGlobalSearchActive) {
      await fetchAllCreatives();
    } else if (selectedAdvertiser) {
      await fetchCreatives();
    }
    setLoading(false);
  };

  const handleAssign = async () => {
    if (!creativeToAssign || !destAdvertiserId) return;
    setIsAssigning(true);
    setToast({
      show: true,
      type: 'loading',
      message: 'Copying creative...',
      details: `Assigning ${creativeToAssign.name} to new advertiser.`
    });

    const result = await copyCreative(creativeToAssign.id, destAdvertiserId);
    setIsAssigning(false);
    setActiveModal(null);

    if (result.success) {
      setToast({
        show: true,
        type: 'success',
        message: 'Creative Assigned!',
        details: 'The creative has been successfully copied to the destination advertiser.',
        link: `https://campaignmanager.google.com/trafficking/#/accounts/${accountId}/advertisers/${destAdvertiserId}/creatives/${result.id}`
      });
    } else {
      setToast({
        show: true,
        type: 'error',
        message: 'Assignment Failed',
        details: result.error
      });
    }
  };

  const handleAssignToPlacement = async () => {
    if (!creativeToAssign || !destPlacementId || !destCampaignId) return;
    setIsAssigning(true);
    setToast({
      show: true,
      type: 'loading',
      message: 'Creating Ad...',
      details: `Linking ${creativeToAssign.name} to placement.`
    });

    const result = await assignCreativeToPlacement(creativeToAssign.id, destPlacementId, destCampaignId);
    setIsAssigning(false);
    setActiveModal(null);

    if (result.success) {
      setToast({
        show: true,
        type: 'success',
        message: 'Ad Created!',
        details: 'The creative has been linked to the placement via a new Ad.',
        link: `https://campaignmanager.google.com/trafficking/#/accounts/${accountId}/campaigns/${destCampaignId}/explorer/ads/${result.id}`
      });
    } else {
      setToast({
        show: true,
        type: 'error',
        message: 'Assignment Failed',
        details: result.error
      });
    }
  };

  useEffect(() => {
    if (isGlobalSearchActive && !selectedAdvertiser) {
      fetchAllCreatives();
    }
  }, [isGlobalSearchActive, selectedAdvertiser, fetchAllCreatives]);

  const filteredCreatives = creatives.filter(c => {
    const matchesSearch = c.name.toLowerCase().includes(searchTerm.toLowerCase());
    // If global search is active, we ignore the campaign filter
    if (isGlobalSearchActive) return matchesSearch;
    
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
      <div className="p-4 border-b border-slate-800 flex items-center justify-between gap-4 bg-slate-900/50 backdrop-blur-sm relative z-20">
        <div className={`flex-1 max-w-md relative transition-all duration-300 ${isGlobalSearchActive ? 'ring-2 ring-blue-500/50 rounded-lg' : ''}`}>
          <Search className={`absolute left-3 top-2.5 w-4 h-4 ${isGlobalSearchActive ? 'text-blue-400' : 'text-slate-500'}`} />
          <input 
            type="text" 
            placeholder={isGlobalSearchActive ? "Searching in ALL advertiser creatives..." : "Search creatives in this advertiser..."}
            className={`w-full bg-slate-950 border rounded-lg py-2 pl-10 pr-4 text-sm focus:outline-none transition-all placeholder:text-slate-600 ${
              isGlobalSearchActive ? 'border-blue-500/50 text-blue-100' : 'border-slate-800 text-slate-200 focus:border-blue-500'
            }`}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          {isGlobalSearchActive && (
            <div className="absolute right-3 top-2 flex items-center gap-1 px-1.5 py-0.5 bg-blue-500/20 rounded text-[9px] font-bold text-blue-400 uppercase tracking-tighter border border-blue-500/30">
              Global
            </div>
          )}
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

          <button 
            onClick={() => {
              const input = document.getElementById('batch-upload-input');
              input?.click();
            }}
            disabled={!selectedAdvertiser}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold transition-all shadow-lg shadow-blue-500/20 disabled:opacity-50 disabled:grayscale"
          >
            <UploadCloud className="w-4 h-4" />
            Bulk Create
          </button>

          <div className="relative">
            <button 
              onClick={() => setIsNewMenuOpen(!isNewMenuOpen)}
              disabled={toast.type === 'loading' && toast.show}
              className={`flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold transition-all shadow-lg shadow-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {toast.type === 'loading' && toast.show ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              New
              <ChevronDownIcon className={`w-3.5 h-3.5 transition-transform ${isNewMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {isNewMenuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setIsNewMenuOpen(false)} />
                <div className="absolute right-0 mt-2 w-56 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl z-40 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="p-2 border-b border-slate-800 bg-slate-950/50">
                    <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest px-2">Creative</span>
                  </div>
                  <div className="p-1">
                    <button 
                      disabled={!selectedAdvertiser}
                      onClick={() => {
                        const input = document.getElementById('batch-upload-input');
                        input?.click();
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2 text-xs text-slate-300 hover:bg-blue-600 hover:text-white rounded-lg transition-colors group disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <UploadCloud className="w-4 h-4 text-slate-500 group-hover:text-white" />
                      Batch upload
                    </button>
                    <button 
                      onClick={() => {
                        setIsGlobalSearchActive(!isGlobalSearchActive);
                        setIsNewMenuOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 text-xs rounded-lg transition-colors ${
                        isGlobalSearchActive 
                          ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30' 
                          : 'text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <SearchCode className="w-4 h-4" />
                        Add from advertiser
                      </div>
                      {isGlobalSearchActive && <Check className="w-3 h-3" />}
                    </button>
                  </div>

                  <div className="p-2 border-b border-slate-800 bg-slate-950/50 mt-1">
                    <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest px-2">Standard</span>
                  </div>
                  <div className="p-1">
                    <button 
                      disabled={!selectedAdvertiser}
                      onClick={() => {
                        const input = document.getElementById('single-upload-input');
                        input?.click();
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <ImageIcon className="w-4 h-4 text-blue-500" />
                      Display
                    </button>
                    <button 
                      disabled={!selectedAdvertiser}
                      onClick={() => {
                        const input = document.getElementById('single-upload-input');
                        input?.click();
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Video className="w-4 h-4 text-rose-500" />
                      In-stream video
                    </button>
                  </div>
                </div>
              </>
            )}

            <input 
              type="file" 
              id="single-upload-input" 
              className="hidden" 
              onChange={(e) => handleFileUpload(e, false)}
              accept="image/*,video/*"
            />
            <input 
              type="file" 
              id="batch-upload-input" 
              className="hidden" 
              multiple
              onChange={(e) => handleFileUpload(e, true)}
              accept="image/*,video/*"
            />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6 custom-scrollbar relative">
        {batchProgress && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 w-full max-w-md animate-in slide-in-from-top-4 duration-300">
            <div className="bg-blue-600 rounded-2xl p-4 shadow-2xl shadow-blue-500/20 border border-blue-400/30">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold text-blue-100 uppercase tracking-widest">Batch Upload Progress</span>
                <span className="text-[10px] font-bold text-white">{batchProgress.current} / {batchProgress.total}</span>
              </div>
              <div className="w-full h-1.5 bg-blue-900/50 rounded-full overflow-hidden mb-2">
                <div 
                  className="h-full bg-white transition-all duration-300" 
                  style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
                />
              </div>
              <p className="text-[10px] text-blue-100 font-medium truncate italic">{batchProgress.status}</p>
            </div>
          </div>
        )}

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
                    <div className="relative">
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveActionMenu(activeActionMenu === creative.id ? null : creative.id);
                        }}
                        className="p-2 bg-slate-800 rounded-lg text-white hover:bg-slate-700 transition-colors border border-slate-700"
                        title="Actions"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>

                      {activeActionMenu === creative.id && (
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl z-50 py-1 overflow-hidden animate-in fade-in slide-in-from-bottom-2">
                          <button 
                            onClick={() => {
                              setCreativeToAssign(creative);
                              setActiveModal('advertiser');
                              setActiveActionMenu(null);
                            }}
                            className="w-full flex items-center gap-3 px-4 py-2 text-xs text-slate-300 hover:bg-blue-600 hover:text-white transition-colors"
                          >
                            <Layers className="w-3.5 h-3.5" />
                            Assign to Advertiser
                          </button>
                          <button 
                            onClick={() => {
                              setCreativeToAssign(creative);
                              setDestAdvertiserId(selectedAdvertiser?.id || '');
                              setActiveModal('campaign');
                              setActiveActionMenu(null);
                            }}
                            className="w-full flex items-center gap-3 px-4 py-2 text-xs text-slate-300 hover:bg-blue-600 hover:text-white transition-colors"
                          >
                            <LayoutDashboard className="w-3.5 h-3.5" />
                            Assign to Campaign
                          </button>
                          <button 
                            onClick={() => {
                              setCreativeToAssign(creative);
                              setDestCampaignId(selectedCampaign?.id || '');
                              setActiveModal('placement');
                              setActiveActionMenu(null);
                            }}
                            className="w-full flex items-center gap-3 px-4 py-2 text-xs text-slate-300 hover:bg-blue-600 hover:text-white transition-colors"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            Assign to Placement (Ad)
                          </button>
                        </div>
                      )}
                    </div>
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
                        <div className="relative">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveActionMenu(activeActionMenu === creative.id ? null : creative.id);
                            }}
                            className="p-1.5 rounded-md text-slate-600 hover:bg-slate-800 hover:text-slate-300 transition-all"
                            title="Actions"
                          >
                            <MoreVertical className="w-4 h-4" />
                          </button>

                          {activeActionMenu === creative.id && (
                            <div className="absolute right-full top-0 mr-2 w-48 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl z-50 py-1 overflow-hidden animate-in fade-in slide-in-from-right-2">
                              <button 
                                onClick={() => {
                                  setCreativeToAssign(creative);
                                  setActiveModal('advertiser');
                                  setActiveActionMenu(null);
                                }}
                                className="w-full flex items-center gap-3 px-4 py-2 text-xs text-slate-300 hover:bg-blue-600 hover:text-white transition-colors"
                              >
                                <Layers className="w-3.5 h-3.5" />
                                Assign to Advertiser
                              </button>
                              <button 
                                onClick={() => {
                                  setCreativeToAssign(creative);
                                  setDestAdvertiserId(selectedAdvertiser?.id || '');
                                  setActiveModal('campaign');
                                  setActiveActionMenu(null);
                                }}
                                className="w-full flex items-center gap-3 px-4 py-2 text-xs text-slate-300 hover:bg-blue-600 hover:text-white transition-colors"
                              >
                                <LayoutDashboard className="w-3.5 h-3.5" />
                                Assign to Campaign
                              </button>
                              <button 
                                onClick={() => {
                                  setCreativeToAssign(creative);
                                  setDestCampaignId(selectedCampaign?.id || '');
                                  setActiveModal('placement');
                                  setActiveActionMenu(null);
                                }}
                                className="w-full flex items-center gap-3 px-4 py-2 text-xs text-slate-300 hover:bg-blue-600 hover:text-white transition-colors"
                              >
                                <Plus className="w-3.5 h-3.5" />
                                Assign to Placement (Ad)
                              </button>
                            </div>
                          )}
                        </div>
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
            <h3 className="text-xl font-bold text-white mb-2">
              {pendingFiles.length > 0 ? `Batch Upload (${pendingFiles.length} files)` : 'Configure Creative'}
            </h3>
            <p className="text-slate-400 text-sm mb-6">
              {pendingFiles.length > 0 
                ? 'Select a common format and size for all files in this batch.' 
                : (selectedCampaign ? `Uploading to Campaign: ${selectedCampaign.name}` : 'Review the name and format before uploading to CM360.')}
            </p>
            
            <div className="space-y-4">
              {pendingFiles.length > 0 && (
                <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] uppercase font-bold text-slate-500">Naming Convention</label>
                    <div className="flex bg-slate-900 rounded-lg p-0.5 border border-slate-800">
                      <button 
                        onClick={() => setNamingMode('prefix')}
                        className={`px-3 py-1 text-[9px] font-bold rounded-md transition-all ${namingMode === 'prefix' ? 'bg-blue-600 text-white' : 'text-slate-500'}`}
                      >
                        Prefix
                      </button>
                      <button 
                        onClick={() => setNamingMode('suffix')}
                        className={`px-3 py-1 text-[9px] font-bold rounded-md transition-all ${namingMode === 'suffix' ? 'bg-blue-600 text-white' : 'text-slate-500'}`}
                      >
                        Suffix
                      </button>
                    </div>
                  </div>
                  
                  <div className="space-y-3">
                    <input 
                      type="text"
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-xs text-white focus:outline-none focus:border-blue-500 transition-all"
                      value={namingText}
                      onChange={(e) => setNamingText(e.target.value)}
                      placeholder={namingMode === 'prefix' ? "Prefix text..." : "Suffix text..."}
                    />
                    
                    <label className="flex items-center gap-3 cursor-pointer group">
                      <div className={`w-8 h-4 rounded-full transition-all relative ${includeDate ? 'bg-blue-600' : 'bg-slate-800'}`}>
                        <div className={`absolute top-1 w-2 h-2 bg-white rounded-full transition-all ${includeDate ? 'left-5' : 'left-1'}`} />
                      </div>
                      <input 
                        type="checkbox" 
                        className="hidden" 
                        checked={includeDate} 
                        onChange={() => setIncludeDate(!includeDate)} 
                      />
                      <span className="text-[10px] font-bold text-slate-400 group-hover:text-slate-300 transition-colors">Append current date (DD-MM-YYYY)</span>
                    </label>
                  </div>
                </div>
              )}

              {pendingFiles.length === 0 && (
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
              )}

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

              {pendingFiles.length === 0 && (
                <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 mt-4">
                  <label className="block text-[9px] uppercase font-bold text-slate-600 mb-1">Final Name Preview</label>
                  <p className="text-xs font-mono text-blue-400 truncate">
                    {selectedCampaign ? `${selectedCampaign.name.substring(0, 10)}_` : ''}{customName}_{selectedFormat}_{selectedSize.replace(/\s+/g, '_')}
                  </p>
                </div>
              )}
              
              <div className="flex gap-3 pt-4">
                <button 
                  onClick={() => {
                    setIsUploadModalOpen(false);
                    setPendingFiles([]);
                    setPendingFile(null);
                  }}
                  className="flex-1 py-3 text-slate-400 hover:text-white font-bold transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={confirmUpload}
                  className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold transition-all shadow-lg shadow-blue-600/20"
                >
                  {pendingFiles.length > 0 ? 'Start Batch' : 'Confirm & Upload'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Assignment Modals */}
      {activeModal === 'advertiser' && creativeToAssign && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 w-full max-w-md shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-xl font-bold text-white mb-2">Assign to Advertiser</h3>
            <p className="text-slate-400 text-sm mb-6">This will copy the creative "{creativeToAssign.name}" to the selected advertiser's library.</p>
            
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-500 mb-2">Destination Advertiser</label>
                <select 
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500 transition-all appearance-none"
                  value={destAdvertiserId}
                  onChange={(e) => setDestAdvertiserId(e.target.value)}
                >
                  <option value="">Select an advertiser...</option>
                  {advertisers.map(adv => (
                    <option key={adv.id} value={adv.id}>{adv.name}</option>
                  ))}
                </select>
              </div>

              <div className="flex gap-3 pt-4">
                <button 
                  onClick={() => setActiveModal(null)}
                  className="flex-1 px-6 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleAssign}
                  disabled={!destAdvertiserId || isAssigning}
                  className="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-blue-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isAssigning ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm Copy'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeModal === 'campaign' && creativeToAssign && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 w-full max-w-md shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-xl font-bold text-white mb-2">Assign to Campaign</h3>
            <p className="text-slate-400 text-sm mb-6">The creative "{creativeToAssign.name}" will be made available in the selected campaign.</p>
            
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-500 mb-2">Advertiser</label>
                <select 
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500 transition-all appearance-none"
                  value={destAdvertiserId}
                  onChange={(e) => setDestAdvertiserId(e.target.value)}
                >
                  <option value="">Select an advertiser...</option>
                  {advertisers.map(adv => (
                    <option key={adv.id} value={adv.id}>{adv.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-500 mb-2">Campaign</label>
                <select 
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500 transition-all appearance-none"
                  value={destCampaignId}
                  onChange={(e) => setDestCampaignId(e.target.value)}
                  disabled={!destAdvertiserId}
                >
                  <option value="">Select a campaign...</option>
                  {campaigns.map(camp => (
                    <option key={camp.id} value={camp.id}>{camp.name}</option>
                  ))}
                </select>
              </div>

              <div className="flex gap-3 pt-4">
                <button 
                  onClick={() => setActiveModal(null)}
                  className="flex-1 px-6 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => {
                    handleAssign();
                  }}
                  disabled={!destCampaignId || isAssigning}
                  className="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-blue-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isAssigning ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm Assignment'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeModal === 'placement' && creativeToAssign && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 w-full max-w-md shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-xl font-bold text-white mb-2">Assign to Placement (Ad)</h3>
            <p className="text-slate-400 text-sm mb-6">Create a new Ad linking "{creativeToAssign.name}" to a specific placement.</p>
            
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-500 mb-2">Campaign</label>
                <select 
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500 transition-all appearance-none"
                  value={destCampaignId}
                  onChange={(e) => setDestCampaignId(e.target.value)}
                >
                  <option value="">Select a campaign...</option>
                  {campaigns.map(camp => (
                    <option key={camp.id} value={camp.id}>{camp.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-500 mb-2">Placement</label>
                <select 
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500 transition-all appearance-none"
                  value={destPlacementId}
                  onChange={(e) => setDestPlacementId(e.target.value)}
                  disabled={!destCampaignId}
                >
                  <option value="">Select a placement...</option>
                  {placements.map(p => (
                    <option key={p.id} value={p.id}>{p.name} ({p.size})</option>
                  ))}
                </select>
              </div>

              <div className="flex gap-3 pt-4">
                <button 
                  onClick={() => setActiveModal(null)}
                  className="flex-1 px-6 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleAssignToPlacement}
                  disabled={!destPlacementId || isAssigning}
                  className="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-blue-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isAssigning ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create Ad'}
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
