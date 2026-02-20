
import React, { useEffect } from 'react';
import { CheckCircle2, XCircle, X, ExternalLink, Loader2 } from 'lucide-react';

interface ToastProps {
  show: boolean;
  type: 'success' | 'error' | 'loading';
  message: string;
  details?: string;
  link?: string;
  onClose: () => void;
}

const Toast: React.FC<ToastProps> = ({ show, type, message, details, link, onClose }) => {
  useEffect(() => {
    if (show && type !== 'loading') {
      const timer = setTimeout(onClose, 6000);
      return () => clearTimeout(timer);
    }
  }, [show, type, onClose]);

  if (!show) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[200] animate-in slide-in-from-right-10 duration-300">
      <div className={`flex items-start gap-4 p-4 rounded-2xl border shadow-2xl min-w-[320px] max-w-md backdrop-blur-md ${
        type === 'success' ? 'bg-emerald-950/90 border-emerald-500/30 text-emerald-200' :
        type === 'error' ? 'bg-rose-950/90 border-rose-500/30 text-rose-200' :
        'bg-slate-900/90 border-slate-700/50 text-slate-200'
      }`}>
        <div className="shrink-0 mt-0.5">
          {type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-400" />}
          {type === 'error' && <XCircle className="w-5 h-5 text-rose-400" />}
          {type === 'loading' && <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />}
        </div>
        
        <div className="flex-1">
          <h4 className="text-sm font-bold leading-tight">{message}</h4>
          {details && <p className="text-xs mt-1 opacity-70 leading-relaxed">{details}</p>}
          
          {link && (
            <a 
              href={link} 
              target="_blank" 
              rel="noopener noreferrer"
              className="mt-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-white hover:underline"
            >
              Verify in CM360 <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>

        <button 
          onClick={onClose}
          className="shrink-0 p-1 hover:bg-white/10 rounded-lg transition-colors"
        >
          <X className="w-4 h-4 opacity-50" />
        </button>
      </div>
    </div>
  );
};

export default Toast;
