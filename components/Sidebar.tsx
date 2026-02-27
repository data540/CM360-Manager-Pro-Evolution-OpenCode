
import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { ViewType } from '../types';
import { 
  LayoutDashboard, 
  Layers, 
  Image as ImageIcon, 
  Megaphone,
  Settings as SettingsIcon,
  ChevronDown,
  Circle,
  Database,
  RefreshCw,
  Plus
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
  const [newCampaignEndDate, setNewCampaignEndDate] = useState(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
  const [isEuPolitical, setIsEuPolitical] = useState(false);
  const [selectedLandingPageId, setSelectedLandingPageId] = useState('');
  const [customLandingPageUrl, setCustomLandingPageUrl] = useState('');
  const [isCustomLandingPage, setIsCustomLandingPage] = useState(false);

  const [advertiserSearch, setAdvertiserSearch] = useState('');
  const [campaignSearch, setCampaignSearch] = useState('');
  
  React.useEffect(() => {
    const handleOpenModal = () => {
      setIsCampaignModalOpen(true);
      setSelectedLandingPageId('');
      setCustomLandingPageUrl('');
      setNewCampaignEndDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
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
    const today = new Date().toISOString().split('T')[0];
    if (newCampaignEndDate < today) {
      setToast({
        show: true,
        type: 'error',
        message: 'Invalid end date',
        details: 'Campaign end date must be today or later.'
      });
      return;
    }
    
    setToast({
      show: true,
      type: 'loading',
      message: 'Creating campaign in CM360...',
      details: `Registering "${newCampaignName}" in advertiser ${selectedAdvertiser.name}.`
    });

    const result = await createCampaign({
      name: newCampaignName,
      startDate: new Date().toISOString().split('T')[0],
      endDate: newCampaignEndDate,
      isEuPolitical,
      landingPageId: isCustomLandingPage ? undefined : selectedLandingPageId,
      landingPageUrl: isCustomLandingPage ? customLandingPageUrl : undefined
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
    <div className="sidebar-shell w-72 h-full flex flex-col bg-[#14233c] border-r border-[#2a4163] p-4 shrink-0 overflow-y-auto">
      <div className="sidebar-brand flex items-center mb-8 px-3 py-3 rounded-xl border border-[#2a4163] bg-[#162949] min-h-[88px]">
        <img
          src="/cm-traffic-studio-mark-dark.svg"
          alt="CM Traffic Studio"
          className="logo-dark h-16 w-full object-contain object-left"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
        <img
          src="/cm-traffic-studio-logo.svg"
          alt="CM Traffic Studio"
          className="logo-light h-16 w-full object-contain object-left hidden"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
      </div>

      <div className="mb-6 space-y-4">
        <div className="relative sidebar-card">
          <div className="flex justify-between items-center mb-1 px-2">
            <label className="text-xs uppercase tracking-[0.14em] text-slate-400 font-bold">CM360 Advertiser</label>
            {advertisers.length === 0 && connectionStatus === 'Connected' && (
              <button 
                onClick={fetchAdvertisers}
                className="text-[9px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
                title="Sincronizar de nuevo"
              >
                <RefreshCw className="w-2.5 h-2.5" /> SYNC
              </button>
            )}
          </div>
          <div className="space-y-1.5">
            <input 
              type="text"
              placeholder="Find advertisers..."
              className="w-full bg-[#0e1d35] border border-[#2a4163] text-slate-200 text-sm rounded-md py-2 px-3 focus:outline-none focus:border-emerald-500/50 transition-colors placeholder:text-slate-500"
              value={advertiserSearch}
              onChange={(e) => setAdvertiserSearch(e.target.value)}
            />
            <div className="relative">
              <select 
                className="w-full bg-[#10213c] border border-[#2a4163] text-slate-100 text-base font-semibold rounded-md py-2.5 px-3 appearance-none focus:outline-none focus:border-emerald-500 transition-colors"
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

        <div className="relative sidebar-card">
          <div className="flex justify-between items-center mb-1 px-2">
            <label className="text-xs uppercase tracking-[0.14em] text-slate-400 font-bold">Active Campaign</label>
            <div className="flex gap-2">
              {selectedAdvertiser && connectionStatus === 'Connected' && (
                <button 
                  onClick={() => {
                    setIsCampaignModalOpen(true);
                    setSelectedLandingPageId('');
                    setCustomLandingPageUrl('');
                    setNewCampaignEndDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
                    if (selectedAdvertiser) fetchLandingPages(selectedAdvertiser.id);
                  }}
                  className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1 font-semibold"
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
              placeholder="Find campaigns..."
              className="w-full bg-[#0e1d35] border border-[#2a4163] text-slate-200 text-sm rounded-md py-2 px-3 focus:outline-none focus:border-emerald-500/50 transition-colors disabled:opacity-50 placeholder:text-slate-500"
              value={campaignSearch}
              onChange={(e) => setCampaignSearch(e.target.value)}
            />
            <div className="relative">
              <select 
                disabled={!selectedAdvertiser}
                className="w-full bg-[#10213c] border border-[#2a4163] text-slate-100 text-base font-semibold rounded-md py-2.5 px-3 appearance-none focus:outline-none focus:border-emerald-500 disabled:opacity-50 transition-colors"
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
            className={`sidebar-nav-btn w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-semibold transition-all ${
              currentView === item.type 
                ? 'sidebar-nav-active bg-emerald-500/14 text-emerald-300 border border-emerald-500/35 shadow-[inset_0_1px_0_rgba(16,185,129,0.15)]' 
                : 'text-slate-300 hover:text-slate-100 hover:bg-[#1a2f51]'
            }`}
          >
            <item.icon className="w-5 h-5" />
            {item.label}
          </button>
        ))}
      </nav>

      <div className="mt-auto pt-6 border-t border-[#2a4163]">
        <div className="status-card bg-[#162949] rounded-xl p-3 border border-[#2a4163]">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Database className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-[10px] text-slate-300 font-bold uppercase tracking-wider">CM360 Link</span>
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
          <p className="text-[11px] text-slate-300">
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
                <label className="block text-[10px] uppercase font-bold text-slate-500 mb-2">Campaign End Date</label>
                <input
                  type="date"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500 transition-all"
                  value={newCampaignEndDate}
                  onChange={(e) => setNewCampaignEndDate(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
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
                      <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-all ${isEuPolitical === true ? 'border-emerald-500 bg-emerald-500/20' : 'border-slate-700 bg-slate-950'}`}>
                        {isEuPolitical === true && <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
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
                      <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-all ${isEuPolitical === false ? 'border-emerald-500 bg-emerald-500/20' : 'border-slate-700 bg-slate-950'}`}>
                        {isEuPolitical === false && <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
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
                    className="text-[10px] text-emerald-400 hover:text-emerald-300 font-bold"
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
                      value={selectedLandingPageId}
                      onChange={(e) => setSelectedLandingPageId(e.target.value)}
                    >
                      <option value="">{landingPages.length > 0 ? 'Select a landing page...' : 'No landing pages found'}</option>
                      {landingPages.map(lp => (
                        <option key={lp.id} value={lp.id}>{lp.name} ({lp.url})</option>
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
                  disabled={!newCampaignName || !newCampaignEndDate || (isCustomLandingPage ? !customLandingPageUrl : !selectedLandingPageId) || (toast.type === 'loading' && toast.show)}
                  className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold transition-all shadow-lg shadow-emerald-600/20 disabled:opacity-50"
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
