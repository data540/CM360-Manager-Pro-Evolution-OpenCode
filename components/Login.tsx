
import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { AlertCircle, ArrowRight, Bolt, KeyRound, Loader2, LogIn, Rocket, Target } from 'lucide-react';

const Login: React.FC = () => {
  const { login, loginWithToken, connectionStatus } = useApp();
  const [manualToken, setManualToken] = useState('');
  const [showManual, setShowManual] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loading = connectionStatus === 'Connecting';

  useEffect(() => {
    const handleError = (e: any) => {
      setError(e.detail);
    };
    window.addEventListener('cm360_auth_error', handleError);
    return () => window.removeEventListener('cm360_auth_error', handleError);
  }, []);

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualToken.trim()) return;
    setError(null);
    const result = await loginWithToken(manualToken.trim());
    if (!result.success) {
      setError(result.error || "Token inválido o expirado.");
    }
  };

  const handleGoogleSignIn = () => {
    setError(null);
    login();
  };

  return (
    <div className="min-h-screen w-full bg-[#050607] overflow-auto relative">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_14%,rgba(16,185,129,0.24),rgba(5,6,7,0)_36%)]" />
      <div className="relative z-10 mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-10">
        <div className="mx-auto w-full max-w-[460px] rounded-[28px] border border-white/10 bg-[#080a0c]/95 shadow-[0_30px_120px_rgba(0,0,0,0.55)] md:max-w-[520px]">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-4 md:px-5">
            <div className="flex items-center gap-2">
              <img
                src="/cm-traffic-studio-logo-dark.svg"
                alt="CM Traffic Studio"
                className="h-10 w-auto max-w-[230px] object-contain"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            </div>
            <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/15 px-3 py-2 text-center text-xs font-bold text-emerald-300">
              Acceso
              <br />
              Expertos
            </div>
          </div>

          <div className="px-4 pb-8 pt-7 md:px-6 md:pt-10">
            <div className="mx-auto w-fit rounded-full border border-emerald-400/25 bg-emerald-500/10 px-4 py-2 text-center text-[11px] font-bold uppercase tracking-[0.12em] text-emerald-300">
              Disponible para agencias en España
            </div>

            <div className="mt-8 text-center">
              <h1 className="text-[56px] font-extrabold leading-[0.9] tracking-tight text-white md:text-[64px]">
                CM Traffic
                <span className="block text-emerald-400">Studio</span>
              </h1>
              <p className="mx-auto mt-6 max-w-[340px] text-[29px] leading-relaxed text-slate-300">
                La potencia del <span className="font-bold italic text-white">bulk</span>, la precisión de un experto.
              </p>
            </div>

            <div className="mt-8 space-y-3">
              <button
                onClick={handleGoogleSignIn}
                disabled={loading}
                className="w-full rounded-2xl bg-gradient-to-r from-emerald-400 to-emerald-500 px-5 py-4 text-lg font-extrabold text-[#03140f] shadow-[0_10px_30px_rgba(16,185,129,0.35)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70"
              >
                <span className="inline-flex items-center gap-2">
                  {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogIn className="h-5 w-5" />}
                  Sign in with Google
                </span>
              </button>

              <button
                onClick={() => setShowManual((value) => !value)}
                className="w-full rounded-2xl border border-slate-700 bg-[#1f2a40] px-5 py-4 text-lg font-bold text-slate-100 transition hover:border-slate-500"
              >
                <span className="inline-flex items-center gap-2">
                  <KeyRound className="h-5 w-5" />
                  Token Access
                </span>
              </button>
            </div>

            {showManual && (
              <form onSubmit={handleManualSubmit} className="mt-4 rounded-2xl border border-slate-800 bg-[#0b0d10] p-4">
                <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-slate-400">Manual OAuth Token</label>
                <textarea
                  className="min-h-[90px] w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-emerald-300 font-mono focus:border-emerald-500 focus:outline-none"
                  placeholder="ya29.a0AfH6S..."
                  value={manualToken}
                  onChange={(e) => setManualToken(e.target.value)}
                />
                <button type="submit" className="mt-3 w-full rounded-xl bg-emerald-500 py-2.5 text-sm font-bold text-[#042017] transition hover:bg-emerald-400">
                  Apply Token
                </button>
              </form>
            )}

            {error && (
              <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">
                <p className="mb-1 inline-flex items-center gap-2 font-bold uppercase tracking-wider text-rose-300">
                  <AlertCircle className="h-4 w-4" /> Access Error
                </p>
                <p className="font-mono">{error}</p>
              </div>
            )}

            <p className="mx-auto mt-8 max-w-[360px] text-center text-[28px] leading-relaxed text-slate-300">
              Acceso inmediato sin fricción para profesionales.
            </p>

            <section className="mt-14 text-center">
              <div className="mt-8 space-y-3 text-left">
                <div className="rounded-2xl border border-slate-700 bg-[#1a1d24] p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-400/15 text-emerald-300"><Rocket className="h-4 w-4" /></div>
                    <div>
                      <p className="text-2xl font-extrabold text-white">Bulk Power</p>
                      <p className="mt-1 text-[13px] text-slate-300">Gestión masiva de campañas con un solo clic. Sin latencia.</p>
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-700 bg-[#1a1d24] p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-400/15 text-emerald-300"><Target className="h-4 w-4" /></div>
                    <div>
                      <p className="text-2xl font-extrabold text-white">Expert Precision</p>
                      <p className="mt-1 text-[13px] text-slate-300">Algoritmos para una segmentación exacta en mercado español.</p>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="mt-10 grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-slate-800 bg-[#111317] p-3">
                <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Ahorro</p>
                <p className="mt-1 text-5xl font-black text-white">85%</p>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-[#111317] p-3">
                <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Precisión</p>
                <p className="mt-1 text-5xl font-black text-white">99.9%</p>
              </div>
              <div className="col-span-2 rounded-2xl border border-emerald-400/35 bg-gradient-to-r from-emerald-500/12 to-emerald-400/5 p-3">
                <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-300">Crecimiento B2B</p>
                <p className="mt-1 text-right text-5xl font-black text-white">+120%</p>
              </div>
            </section>

            <section className="mt-14 text-center">
              <h3 className="text-5xl font-extrabold tracking-tight text-white">¿Listo para escalar?</h3>
              <p className="mx-auto mt-4 max-w-[340px] text-[16px] text-slate-300">Únete a la élite del marketing B2B en España hoy mismo.</p>
              <button
                onClick={handleGoogleSignIn}
                className="mt-6 w-full rounded-2xl bg-gradient-to-r from-emerald-400 to-emerald-500 px-5 py-4 text-lg font-extrabold text-[#03140f] shadow-[0_10px_30px_rgba(16,185,129,0.3)] transition hover:brightness-105"
              >
                <span className="inline-flex items-center gap-2">Empezar ahora <ArrowRight className="h-5 w-5" /></span>
              </button>
            </section>

            <footer className="mt-12 border-t border-white/10 pt-8 text-center">
              <div className="flex items-center justify-center gap-2 text-white">
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-400 text-[#04120e]"><Bolt className="h-3.5 w-3.5" /></div>
                <span className="text-lg font-extrabold">CM TRAFFIC STUDIO</span>
              </div>
              <div className="mt-5 flex items-center justify-center gap-5 text-[12px] text-slate-400">
                <span>Privacidad</span>
                <span>Términos</span>
                <span>Seguridad</span>
                <span>Contacto</span>
              </div>
              <p className="mt-6 text-[10px] uppercase tracking-[0.16em] text-slate-600">2024 CM Traffic Studio. Madrid, España.</p>
            </footer>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
