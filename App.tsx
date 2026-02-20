
import React from 'react';
import { AppProvider, useApp } from './context/AppContext';
import Sidebar from './components/Sidebar';
import PlacementGrid from './components/PlacementGrid';
import AIHelper from './components/AIHelper';
import Login from './components/Login';
import { ChevronRight, Settings, LogOut, ExternalLink } from 'lucide-react';

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
        return (
          <div className="flex-1 flex items-center justify-center bg-slate-950/20">
            <div className="text-center p-12 glass border-slate-800/50 rounded-[2rem] max-w-md">
              <div className="w-16 h-16 bg-blue-600/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <ExternalLink className="w-8 h-8 text-blue-500" />
              </div>
              <h1 className="text-2xl font-bold mb-3 text-white">Campaign Explorer</h1>
              <p className="text-slate-500 text-sm leading-relaxed mb-8">Campaign performance and traffic data is pulled directly from the CM360 Trafficking API for the selected profile.</p>
              <button className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold transition-all shadow-lg shadow-blue-500/20">
                Refresh Live Feed
              </button>
            </div>
          </div>
        );
      case 'Creatives':
        return (
          <div className="flex-1 flex items-center justify-center bg-slate-950/20">
             <div className="text-center p-12 glass border-slate-800/50 rounded-[2rem] max-w-md">
              <div className="w-16 h-16 bg-indigo-600/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <Settings className="w-8 h-8 text-indigo-500" />
              </div>
              <h1 className="text-2xl font-bold mb-3 text-white">Asset Manager</h1>
              <p className="text-slate-500 text-sm leading-relaxed mb-8">Synchronization with Creative Asset Library. Manage tags, HTML5 packages, and video transcodes.</p>
              <button className="w-full py-3 border border-slate-700 hover:bg-slate-800 text-slate-300 rounded-xl font-bold transition-all">
                Connect Asset Library
              </button>
            </div>
          </div>
        );
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
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
};

export default App;
