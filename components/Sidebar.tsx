
import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { ViewType } from '../types';
import { 
  LayoutDashboard, 
  Layers, 
  Image as ImageIcon, 
  Megaphone,
  Cpu, 
  Settings as SettingsIcon,
  ChevronDown,
  Circle,
  Database,
  RefreshCw,
  Plus,
  ExternalLink
} from 'lucide-react';
import Toast from './Toast';

const Sidebar: React.FC = () => {
  const { 
    currentView, 
    setCurrentView, 
    connectionStatus,
    advertisers,
    selectedAdvertiser,
    setSelectedAdvertiser,
    campaigns,
    selectedCampaign,
    setSelectedCampaign,
    fetchAdvertisers,
    isAuthenticated,
    fetchLandingPages,
    landingPages,
    createCampaign,
    accountId
  } = useApp();

  const [isCampaignModalOpen, setIsCampaignModalOpen] = useState(false);
  const [newCampaignName, setNewCampaignName] = useState('');
  const [isEuPolitical, setIsEuPolitical] = useState(false);
  const [selectedLandingPageUrl, setSelectedLandingPageUrl] = useState('');
  const [customLandingPageUrl, setCustomLandingPageUrl] = useState('');
  const [isCustomLandingPage, setIsCustomLandingPage] = useState(false);

  const [advertiserSearch, setAdvertiserSearch] = useState('');
  const [campaignSearch, setCampaignSearch] = useState('');
  
  React.useEffect(() => {
    const handleOpenModal = () => {
      setIsCampaignModalOpen(true);
      if (selectedAdvertiser) fetchLandingPages(selectedAdvertiser.id);
    };
    window.addEventListener('open-campaign-modal', handleOpenModal);
    return () => window.removeEventListener('open-campaign-modal', handleOpenModal);
  }, [selectedAdvertiser, fetchLandingPages]);

  const [toast, setToast] = useState<{show: boolean, type: 'success' | 'error' | 'loading', message: string, details?: string, link?: string}>({
    show: false,
    type: 'loading',
    message: ''
  });

  const handleCreateCampaign = async () => {
    if (!newCampaignName || !selectedAdvertiser) return;
    
    setToast({
      show: true,
      type: 'loading',
      message: 'Creating campaign in CM360...',
      details: `Registering "${newCampaignName}" in advertiser ${selectedAdvertiser.name}.`
    });

    const result = await createCampaign({
      name: newCampaignName,
      startDate: new Date().toISOString().split('T')[0],
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      isEuPolitical,
      landingPageUrl: isCustomLandingPage ? customLandingPageUrl : selectedLandingPageUrl
    });
    
    if (result.success) {
      const verifyLink = `https://campaignmanager.google.com/trafficking/#/accounts/${accountId}/advertisers/${selectedAdvertiser.id}/campaigns/${result.id}`;
      setToast({
        show: true,
        type: 'success',
        message: 'Campaign Created!',
        details: 'The campaign has been successfully registered in Campaign Manager.',
        link: verifyLink
      });
      setIsCampaignModalOpen(false);
      setNewCampaignName('');
    } else {
      setToast({
        show: true,
        type: 'error',
        message: 'Creation Failed',
        details: result.error || 'Check API permissions or campaign name uniqueness.'
      });
    }
  };

  const navItems: { type: ViewType; icon: any; label: string }[] = [
    { type: 'Campaigns', icon: LayoutDashboard, label: 'Campaigns' },
    { type: 'Placements', icon: Layers, label: 'Placements' },
    { type: 'Ads', icon: Megaphone, label: 'Ads' },
    { type: 'Creatives', icon: ImageIcon, label: 'Creatives' },
    { type: 'AIHelper', icon: Cpu, label: 'AI Helper' },
    { type: 'Settings', icon: SettingsIcon, label: 'Settings' },
  ];

  const filteredAdvertisers = advertisers.filter(a => 
    a.name.toLowerCase().includes(advertiserSearch.toLowerCase())
  );

  const filteredCampaigns = selectedAdvertiser 
    ? campaigns.filter(c => 
        c.advertiserId === selectedAdvertiser.id && 
        c.name.toLowerCase().includes(campaignSearch.toLowerCase())
      )
    : [];

  return (
    <div className="w-72 h-full flex flex-col glass border-r border-slate-800 p-4 shrink-0 overflow-y-auto">
      <div className="flex items-center gap-3 mb-8 px-2">
        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center font-bold text-white italic shadow-lg shadow-blue-500/20">CP</div>
        <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-indigo-400">
          CM360 Pro
        </h1>
      </div>

      <div className="mb-6 space-y-4">
        <div className="relative">
          <div className="flex justify-between items-center mb-1 px-2">
            <label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">CM360 Advertiser</label>
            {advertisers.length === 0 && connectionStatus === 'Connected' && (
              <button 
                onClick={fetchAdvertisers}
                className="text-[9px] text-blue-400 hover:text-blue-300 flex items-center gap-1"
                title="Sincronizar de nuevo"
              >
                <RefreshCw className="w-2.5 h-2.5" /> SYNC
              </button>
            )}
          </div>
          <div className="space-y-1.5">
            <input 
              type="text"
              placeholder="Filter advertisers..."
              className="w-full bg-slate-950/50 border border-slate-800 text-slate-400 text-[10px] rounded-md py-1.5 px-3 focus:outline-none focus:border-blue-500/50 transition-colors"
              value={advertiserSearch}
              onChange={(e) => setAdvertiserSearch(e.target.value)}
            />
            <div className="relative">
              <select 
                className="w-full bg-slate-900/50 border border-slate-700 text-slate-200 text-sm rounded-md py-2 px-3 appearance-none focus:outline-none focus:border-blue-500 transition-colors"
                value={selectedAdvertiser?.id || ''}
                onChange={(e) => {
                  const adv = advertisers.find(a => a.id === e.target.value);
                  setSelectedAdvertiser(adv || null);
                  setSelectedCampaign(null);
                  if (adv) setCurrentView('Campaigns');
                }}
              >
                <option value="">{advertisers.length > 0 ? 'Select Advertiser' : 'No advertisers found'}</option>
                {filteredAdvertisers.map(adv => <option key={adv.id} value={adv.id}>{adv.name}</option>)}
              </select>
              <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-slate-500 pointer-events-none" />
            </div>
          </div>
        </div>

        <div className="relative">
          <div className="flex justify-between items-center mb-1 px-2">
            <label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Active Campaign</label>
            <div className="flex gap-2">
              {selectedAdvertiser && connectionStatus === 'Connected' && (
                <button 
                  onClick={() => {
                    setIsCampaignModalOpen(true);
                    if (selectedAdvertiser) fetchLandingPages(selectedAdvertiser.id);
                  }}
                  className="text-[9px] text-blue-400 hover:text-blue-300 flex items-center gap-1"
                  title="Crear campaña"
                >
                  <Plus className="w-2.5 h-2.5" /> CREATE
                </button>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <input 
              type="text"
              disabled={!selectedAdvertiser}
              placeholder="Filter campaigns..."
              className="w-full bg-slate-950/50 border border-slate-800 text-slate-400 text-[10px] rounded-md py-1.5 px-3 focus:outline-none focus:border-blue-500/50 transition-colors disabled:opacity-50"
              value={campaignSearch}
              onChange={(e) => setCampaignSearch(e.target.value)}
            />
            <div className="relative">
              <select 
                disabled={!selectedAdvertiser}
                className="w-full bg-slate-900/50 border border-slate-700 text-slate-200 text-sm rounded-md py-2 px-3 appearance-none focus:outline-none focus:border-blue-500 disabled:opacity-50 transition-colors"
                value={selectedCampaign?.id || ''}
                onChange={(e) => {
                  const camp = campaigns.find(c => c.id === e.target.value);
                  setSelectedCampaign(camp || null);
                  if (camp) setCurrentView('Placements');
                }}
              >
                <option value="">{selectedAdvertiser ? 'Select Campaign' : 'Select Advertiser first'}</option>
                {filteredCampaigns.map(camp => <option key={camp.id} value={camp.id}>{camp.name}</option>)}
              </select>
              <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-slate-500 pointer-events-none" />
            </div>
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-1">
        {navItems.map((item) => (
          <button
            key={item.type}
            onClick={() => setCurrentView(item.type)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all ${
              currentView === item.type 
                ? 'bg-blue-600/10 text-blue-400 border border-blue-500/20 shadow-sm shadow-blue-500/10' 
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <item.icon className="w-5 h-5" />
            {item.label}
          </button>
        ))}
      </nav>

      <div className="mt-auto pt-6 border-t border-slate-800/50">
        <div className="bg-slate-900/40 rounded-xl p-3 border border-slate-800/50">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Database className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">CM360 Link</span>
            </div>
            <div className="relative">
              <Circle className={`w-2 h-2 fill-current ${
                connectionStatus === 'Connected' ? 'text-emerald-500' : 'text-amber-500'
              }`} />
              <div className={`absolute inset-0 animate-ping rounded-full ${
                 connectionStatus === 'Connected' ? 'bg-emerald-500/40' : 'bg-amber-500/40'
              }`} />
            </div>
          </div>
          <p className="text-[11px] text-slate-400">
            {connectionStatus === 'Connected' ? 'Synchronized with Live API' : 'Initializing sync...'}
          </p>
        </div>
      </div>
      {/* Campaign Creation Modal */}
      {isCampaignModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 w-full max-w-lg shadow-2xl animate-in fade-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto custom-scrollbar">
            <h3 className="text-xl font-bold text-white mb-2">Create New Campaign</h3>
            <p className="text-slate-400 text-sm mb-6">Enter details for the new campaign in {selectedAdvertiser?.name}.</p>
            
            <div className="space-y-6">
              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-500 mb-2">Campaign Name</label>
                <input 
                  type="text"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500 transition-all"
                  placeholder="e.g. Q1_Brand_Awareness_2024"
                  value={newCampaignName}
                  onChange={(e) => setNewCampaignName(e.target.value)}
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Declarations</label>
                <p className="text-[11px] text-slate-400 mb-3">EU political ads (required)</p>
                <div className="space-y-3">
                  <label className="flex items-start gap-3 cursor-pointer group">
                    <div className="pt-0.5">
                      <input 
                        type="radio" 
                        name="euPolitical" 
                        className="hidden" 
                        checked={isEuPolitical === true}
                        onChange={() => setIsEuPolitical(true)}
                      />
                      <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-all ${isEuPolitical === true ? 'border-blue-500 bg-blue-500/20' : 'border-slate-700 bg-slate-950'}`}>
                        {isEuPolitical === true && <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />}
                      </div>
                    </div>
                    <div>
                      <span className="text-xs text-slate-200 font-medium group-hover:text-white transition-colors">Yes, this campaign has EU political ads</span>
                      <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">
                        Campaign Manager 360 doesn't allow campaigns with EU political ads to serve in the EU. This campaign can still serve in other regions.
                      </p>
                    </div>
                  </label>

                  <label className="flex items-start gap-3 cursor-pointer group">
                    <div className="pt-0.5">
                      <input 
                        type="radio" 
                        name="euPolitical" 
                        className="hidden" 
                        checked={isEuPolitical === false}
                        onChange={() => setIsEuPolitical(false)}
                      />
                      <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-all ${isEuPolitical === false ? 'border-blue-500 bg-blue-500/20' : 'border-slate-700 bg-slate-950'}`}>
                        {isEuPolitical === false && <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />}
                      </div>
                    </div>
                    <div>
                      <span className="text-xs text-slate-200 font-medium group-hover:text-white transition-colors">No, this campaign doesn't have EU political ads</span>
                    </div>
                  </label>
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-[10px] uppercase font-bold text-slate-500">Landing Page</label>
                  <button 
                    onClick={() => setIsCustomLandingPage(!isCustomLandingPage)}
                    className="text-[10px] text-blue-400 hover:text-blue-300 font-bold"
                  >
                    {isCustomLandingPage ? 'Select from list' : 'Enter manually'}
                  </button>
                </div>

                {isCustomLandingPage ? (
                  <input 
                    type="url"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500 transition-all"
                    placeholder="https://example.com"
                    value={customLandingPageUrl}
                    onChange={(e) => setCustomLandingPageUrl(e.target.value)}
                  />
                ) : (
                  <div className="relative">
                    <select 
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500 transition-all appearance-none"
                      value={selectedLandingPageUrl}
                      onChange={(e) => setSelectedLandingPageUrl(e.target.value)}
                    >
                      <option value="">{landingPages.length > 0 ? 'Select a landing page...' : 'No landing pages found'}</option>
                      {landingPages.map(lp => (
                        <option key={lp.id} value={lp.url}>{lp.name} ({lp.url})</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-4 top-3.5 w-4 h-4 text-slate-500 pointer-events-none" />
                  </div>
                )}
              </div>
              
              <div className="flex gap-3 pt-4">
                <button 
                  onClick={() => setIsCampaignModalOpen(false)}
                  className="flex-1 py-3 text-slate-400 hover:text-white font-bold transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleCreateCampaign}
                  disabled={!newCampaignName || (isCustomLandingPage ? !customLandingPageUrl : !selectedLandingPageUrl) || (toast.type === 'loading' && toast.show)}
                  className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold transition-all shadow-lg shadow-blue-600/20 disabled:opacity-50"
                >
                  {toast.type === 'loading' && toast.show ? <RefreshCw className="w-4 h-4 animate-spin mx-auto" /> : 'Create Campaign'}
                </button>
              </div>
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

export default Sidebar;
