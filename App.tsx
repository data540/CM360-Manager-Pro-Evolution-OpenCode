
import React from 'react';
import { AppProvider, useApp } from './context/AppContext';
import Sidebar from './components/Sidebar';
import PlacementGrid from './components/PlacementGrid';
import CreativeGrid from './components/CreativeGrid';
import CampaignGrid from './components/CampaignGrid';
import AdGrid from './components/AdGrid';
import AIHelper from './components/AIHelper';
import Login from './components/Login';
import { ChevronRight, LogOut } from 'lucide-react';

class RootErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: string }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error?.message || 'Unknown runtime error' };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Root runtime error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen w-full bg-slate-950 text-slate-100 flex items-center justify-center p-6">
          <div className="max-w-2xl w-full bg-slate-900 border border-rose-500/30 rounded-2xl p-6">
            <p className="text-[10px] uppercase tracking-widest text-rose-400 font-bold">Runtime Error</p>
            <h2 className="text-lg font-bold text-white mt-2">The app failed to render.</h2>
            <p className="text-xs text-slate-300 mt-3 font-mono break-all">{this.state.error}</p>
            <p className="text-xs text-slate-500 mt-4">Open browser console (F12) and share the first red error line.</p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const Header: React.FC = () => {
  const { selectedAdvertiser, selectedCampaign, currentView, user, logout, profileId } = useApp();

  return (
    <header className="h-14 border-b border-slate-800 flex items-center justify-between px-6 bg-slate-950/80 backdrop-blur-md sticky top-0 z-20">
      <div className="flex items-center gap-3 text-[11px] uppercase tracking-widest font-bold">
        <span className="text-slate-500">{currentView}</span>
        {selectedAdvertiser && (
          <>
            <ChevronRight className="w-3 h-3 text-slate-800" />
            <span className="text-slate-400">{selectedAdvertiser.name}</span>
          </>
        )}
        {selectedCampaign && (
          <>
            <ChevronRight className="w-3 h-3 text-slate-800" />
            <span className="text-blue-500">{selectedCampaign.name}</span>
          </>
        )}
      </div>

      <div className="flex items-center gap-4">
        {profileId && (
          <div className="flex items-center gap-1.5 px-3 py-1 bg-slate-900 border border-slate-800 rounded-full text-[10px] text-slate-500 font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Profile ID: {profileId}
          </div>
        )}
        
        <div className="h-4 w-px bg-slate-800" />
        
        {user && (
          <div className="flex items-center gap-3 pl-4">
             <div className="text-right hidden sm:block">
               <p className="text-[10px] font-bold text-slate-200 leading-none">{user.name}</p>
               <p className="text-[9px] text-slate-600 leading-none mt-1">{user.email}</p>
             </div>
             <div className="relative">
               <img src={user.picture} className="w-8 h-8 rounded-full border border-slate-700 shadow-xl" alt="Profile" />
               <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-500 border-2 border-slate-950 rounded-full" />
             </div>
             <button 
               onClick={logout}
               className="p-1.5 rounded-lg text-slate-500 hover:bg-rose-500/10 hover:text-rose-400 transition-all ml-1"
               title="Logout"
             >
               <LogOut className="w-4 h-4" />
             </button>
          </div>
        )}
      </div>
    </header>
  );
};

const MainContent: React.FC = () => {
  const { currentView } = useApp();

  const renderView = () => {
    switch (currentView) {
      case 'Placements':
        return <PlacementGrid />;
      case 'AIHelper':
        return <AIHelper />;
      case 'Campaigns':
        return <CampaignGrid />;
      case 'Creatives':
        return <CreativeGrid />;
      case 'Ads':
        return <AdGrid />;
      default:
        return (
          <div className="flex items-center justify-center h-full text-slate-600 italic font-mono text-xs uppercase tracking-tighter">
            System waiting for tool selection...
          </div>
        );
    }
  };

  return (
    <main className="flex-1 flex flex-col overflow-hidden relative">
      <Header />
      <div className="flex-1 overflow-hidden relative">
        {renderView()}
      </div>
    </main>
  );
};

const AppShell: React.FC = () => {
  const { isAuthenticated } = useApp();

  if (!isAuthenticated) {
    return <Login />;
  }

  return (
    <div className="flex h-screen w-screen bg-[#020617] text-slate-100 font-sans overflow-hidden">
      <Sidebar />
      <MainContent />
    </div>
  );
};

const App: React.FC = () => {
  return (
    <RootErrorBoundary>
      <AppProvider>
        <AppShell />
      </AppProvider>
    </RootErrorBoundary>
  );
};

export default App;
