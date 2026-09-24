import React, { useState } from 'react';
import { X, Megaphone } from 'lucide-react';
import { Placement, Creative } from '../types';

interface CreateAdModalProps {
  placements: Placement[];
  creatives: Creative[];
  defaultPlacementId?: string;
  onClose: () => void;
  onCreate: (params: { placementId: string; name: string; creativeId?: string }) => Promise<{ success: boolean; error?: string }>;
}

const CreateAdModal: React.FC<CreateAdModalProps> = ({ placements, creatives, defaultPlacementId, onClose, onCreate }) => {
  const [placementId, setPlacementId] = useState(defaultPlacementId || '');
  const [name, setName] = useState('');
  const [creativeId, setCreativeId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!placementId || !name.trim()) {
      setError('Selecciona un Placement y escribe un nombre para el Ad.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    const result = await onCreate({
      placementId,
      name: name.trim(),
      creativeId: creativeId || undefined,
    });
    setIsSubmitting(false);

    if (result.success) {
      onClose();
    } else {
      setError(result.error || 'No se pudo crear el Ad.');
    }
  };

  return (
    <div className="fixed inset-0 z-[101] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 w-full max-w-xl shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        <div className="flex justify-between items-start mb-6">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center">
              <Megaphone className="w-4.5 h-4.5 text-blue-400" />
            </div>
            <h3 className="text-xl font-bold text-white">Crear Ad</h3>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-5">
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-500 mb-2">Placement</label>
            <select
              value={placementId}
              onChange={(e) => setPlacementId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
            >
              <option value="">Selecciona un placement...</option>
              {placements.map((placement) => (
                <option key={placement.id} value={placement.id}>{placement.name}</option>
              ))}
            </select>
            {placements.length === 0 && (
              <p className="text-xs text-slate-500 mt-1.5">Esta campaña no tiene placements cargados.</p>
            )}
          </div>

          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-500 mb-2">Nombre del Ad</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="p. ej. Client_Campaign_Placement_v1"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-500 mb-2">Creative (opcional)</label>
            <select
              value={creativeId}
              onChange={(e) => setCreativeId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
            >
              <option value="">Sin creative asignada</option>
              {creatives.map((creative) => (
                <option key={creative.id} value={creative.id}>{creative.name}</option>
              ))}
            </select>
          </div>

          {error && (
            <p className="text-xs text-rose-300 bg-rose-600/10 border border-rose-500/30 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        <div className="flex justify-end gap-3 mt-8">
          <button
            onClick={onClose}
            className="px-4 py-2.5 text-sm font-bold text-slate-400 hover:text-white transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Creando...' : 'Crear Ad'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CreateAdModal;
