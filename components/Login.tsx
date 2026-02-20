
import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { 
  Shield, Key, Zap, Loader2, ArrowRight, AlertCircle, 
  Settings2, Info, CheckCircle2, Globe, Copy, Check, 
  ExternalLink, HelpCircle 
} from 'lucide-react';

const Login: React.FC = () => {
  const { login, loginWithToken, connectionStatus, enterDemoMode } = useApp();
  const [manualToken, setManualToken] = useState('');
  const [clientId, setClientId] = useState(localStorage.getItem('cm360_custom_client_id') || '');
  const [showManual, setShowManual] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  
  const loading = connectionStatus === 'Connecting';

  useEffect(() => {
    const handleError = (e: any) => {
      setError(e.detail);
    };
    window.addEventListener('cm360_auth_error', handleError);
    return () => window.removeEventListener('cm360_auth_error', handleError);
  }, []);

  const copyOrigin = () => {
    navigator.clipboard.writeText(window.location.origin);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualToken.trim()) return;
    setError(null);
    const result = await loginWithToken(manualToken.trim());
    if (!result.success) {
      setError(result.error || "Token inválido o expirado.");
    }
  };

  const handleLoginWithClientId = () => {
    setError(null);
    if (clientId.trim()) {
      localStorage.setItem('cm360_custom_client_id', clientId.trim());
    }
    login(clientId.trim() || undefined);
  };

  return (
    <div className="min-h-screen w-full bg-[#020617] flex items-center justify-center p-6 overflow-hidden relative font-sans">
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/10 rounded-full blur-[120px]" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-indigo-600/10 rounded-full blur-[120px]" />
      
      <div className="max-w-6xl w-full grid grid-cols-1 lg:grid-cols-2 gap-12 items-center relative z-10">
        <div className="max-w-xl">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center font-bold text-2xl text-white italic shadow-lg shadow-blue-500/20">CP</div>
            <h1 className="text-3xl font-bold tracking-tight text-white">CM360 <span className="text-blue-500">Pro</span></h1>
          </div>
          
          <h2 className="text-4xl md:text-6xl font-extrabold text-white mb-6 leading-tight">
            AdOps <br />
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-indigo-400">Precision.</span>
          </h2>
          
          <p className="text-slate-400 text-lg mb-10 leading-relaxed">
            Enterprise-grade placement builder. Connect your CM360 account to start automating your trafficking workflow.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 rounded-2xl bg-slate-900/50 border border-slate-800">
              <Zap className="w-6 h-6 text-blue-500 mb-3" />
              <p className="text-sm font-bold text-slate-200">Bulk Engine</p>
              <p className="text-xs text-slate-500 mt-1">Generate 100+ placements in seconds.</p>
            </div>
            <div className="p-4 rounded-2xl bg-slate-900/50 border border-slate-800">
              <Shield className="w-6 h-6 text-emerald-500 mb-3" />
              <p className="text-sm font-bold text-slate-200">Secure Sync</p>
              <p className="text-xs text-slate-500 mt-1">Native Google OAuth 2.0 Integration.</p>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <div className="glass rounded-[2.5rem] p-8 md:p-10 border border-white/10 shadow-2xl relative overflow-hidden">
            {loading ? (
              <div className="py-20 flex flex-col items-center justify-center text-center">
                <Loader2 className="w-12 h-12 text-blue-500 animate-spin mb-6" />
                <h3 className="text-xl font-bold text-white mb-2">Connecting to CM360</h3>
                <p className="text-slate-500 text-sm italic">Validating your AdOps profile...</p>
              </div>
            ) : (
              <>
                <div className="mb-8 flex justify-between items-start">
                  <div>
                    <h3 className="text-2xl font-bold text-white mb-2">Welcome Back</h3>
                    <p className="text-slate-500 text-sm">Select your authentication method.</p>
                  </div>
                  <HelpCircle className="w-5 h-5 text-slate-700 cursor-help" title="Configuración de API de Google" />
                </div>

                {error && (
                  <div className="mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 flex gap-3 animate-in fade-in slide-in-from-top-2">
                    <AlertCircle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-[11px] font-bold text-rose-500 uppercase tracking-wider mb-1">Diagnostic Error</p>
                      <p className="text-xs text-rose-200/90 leading-relaxed font-mono">{error}</p>
                    </div>
                  </div>
                )}

                <div className="space-y-4">
                  <button 
                    onClick={handleLoginWithClientId}
                    className="w-full group bg-white text-slate-950 font-bold py-4 px-6 rounded-2xl flex items-center justify-center gap-3 hover:bg-slate-100 transition-all active:scale-95 shadow-xl shadow-white/5"
                  >
                    <img src="https://www.gstatic.com/images/branding/product/1x/gsa_512dp.png" className="w-5 h-5" alt="Google" />
                    Sign in with Google
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </button>

                  <div className="grid grid-cols-2 gap-3">
                    <button 
                      onClick={() => setShowManual(!showManual)}
                      className={`py-3 rounded-2xl border transition-all text-xs font-bold flex items-center justify-center gap-2 ${
                        showManual ? 'bg-slate-800 border-slate-600 text-white' : 'border-slate-800 text-slate-500 hover:border-slate-700 hover:text-slate-300'
                      }`}
                    >
                      <Key className="w-3.5 h-3.5" /> Token Access
                    </button>
                    <button 
                      onClick={() => setShowConfig(!showConfig)}
                      className={`py-3 rounded-2xl border transition-all text-xs font-bold flex items-center justify-center gap-2 ${
                        showConfig ? 'bg-slate-800 border-slate-600 text-white' : 'border-slate-800 text-slate-500 hover:border-slate-700 hover:text-slate-300'
                      }`}
                    >
                      <Settings2 className="w-3.5 h-3.5" /> Custom Config
                    </button>
                  </div>

                  {showConfig && (
                    <div className="p-5 bg-slate-950/50 rounded-2xl border border-slate-800 animate-in zoom-in-95 duration-200">
                      <div className="flex items-center gap-2 mb-3">
                        <Globe className="w-3.5 h-3.5 text-blue-400" />
                        <label className="text-[10px] uppercase font-bold tracking-widest text-slate-400">Google Client ID</label>
                      </div>
                      <input 
                        type="text"
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-xs text-blue-300 focus:outline-none focus:border-blue-500 font-mono"
                        placeholder="000000000000-xxxxx.apps.googleusercontent.com"
                        value={clientId}
                        onChange={(e) => setClientId(e.target.value)}
                      />
                      <p className="text-[10px] text-slate-600 mt-3 leading-relaxed">
                        Usa tu propio Client ID si el predeterminado no funciona para tu dominio actual.
                      </p>
                    </div>
                  )}

                  {showManual && (
                    <form onSubmit={handleManualSubmit} className="p-5 bg-slate-950/50 rounded-2xl border border-slate-800 animate-in zoom-in-95 duration-200 space-y-3">
                      <div className="flex items-center gap-2">
                        <Shield className="w-3.5 h-3.5 text-emerald-400" />
                        <label className="text-[10px] uppercase font-bold tracking-widest text-slate-400">Manual OAuth Token</label>
                      </div>
                      <textarea 
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-xs text-emerald-300 focus:outline-none focus:border-emerald-500 font-mono min-h-[80px]"
                        placeholder="ya29.a0AfH6S..."
                        value={manualToken}
                        onChange={(e) => setManualToken(e.target.value)}
                      />
                      <button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 rounded-xl text-xs transition-colors">
                        Apply Token
                      </button>
                    </form>
                  )}

                  <div className="relative py-4">
                    <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-800/50"></div></div>
                    <div className="relative flex justify-center text-[10px] uppercase font-bold tracking-[0.2em] text-slate-700">
                      <span className="bg-[#0f172a] px-4">Development</span>
                    </div>
                  </div>

                  <button 
                    onClick={enterDemoMode}
                    className="w-full py-4 border border-dashed border-slate-800 rounded-2xl text-slate-600 hover:text-blue-400 hover:border-blue-500/50 transition-all text-sm font-bold flex items-center justify-center gap-2"
                  >
                    Enter Demo Sandbox
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="p-6 bg-slate-900/50 border border-slate-800 rounded-3xl space-y-4">
            <div className="flex gap-4">
              <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
                <Globe className="w-5 h-5 text-blue-500" />
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-bold text-slate-200 mb-1">Autorización del Dominio</h4>
                <p className="text-xs text-slate-500 leading-relaxed mb-4">
                  Esta URL debe estar en la lista de "JavaScript origins" de tu app de Google.
                </p>
                
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 mb-4 flex items-center justify-between gap-3 group">
                  <code className="text-[10px] text-blue-400 font-mono truncate flex-1">
                    {window.location.origin}
                  </code>
                  <button 
                    onClick={copyOrigin}
                    className="p-2 hover:bg-slate-800 rounded-lg text-slate-500 hover:text-blue-400 transition-all"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-800 space-y-3">
              <h5 className="text-[10px] uppercase font-bold text-slate-600 tracking-widest flex items-center gap-2">
                <Info className="w-3 h-3" /> Solución de problemas comunes
              </h5>
              <div className="space-y-2">
                <div className="flex items-start gap-2 text-[11px] text-slate-400">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1 shrink-0" />
                  <span><b>API Habilitada:</b> Busca "Campaign Manager 360 API" en Cloud Console y asegúrate de que esté activa.</span>
                </div>
                <div className="flex items-start gap-2 text-[11px] text-slate-400">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1 shrink-0" />
                  <span><b>Test Users:</b> Si tu app está en modo "Testing", añade tu email en la sección de "OAuth Consent Screen".</span>
                </div>
                <div className="flex items-start gap-2 text-[11px] text-slate-400 text-amber-400/80">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1 shrink-0" />
                  <span><b>Perfil CM360:</b> Tu email de Google debe tener acceso directo a un perfil dentro de <a href="https://campaignmanager.google.com" target="_blank" className="underline font-bold">CM360</a>.</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
