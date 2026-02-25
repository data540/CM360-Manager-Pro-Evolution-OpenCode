
import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { BatchItem, Placement } from '../types';
import { normalizeNamingRules } from '../services/gemini';
import { 
  X, ChevronRight, ChevronLeft, Check, AlertCircle, 
  Layers, Database, Wand2, Download, Plus, Trash2, Loader2, Upload, FileText
} from 'lucide-react';

interface BulkCreateWizardProps {
  onClose: () => void;
}

import { UploadCloud, File, CheckCircle, AlertTriangle, Trash2, Loader2 } from 'lucide-react';

interface CreativeUploaderProps {
  onClose: () => void;
}

interface UploadItem {
  id: string;
  file: File;
  name: string;
  status: 'pending' | 'uploading' | 'success' | 'error';
  error?: string;
}

const CreativeUploader: React.FC<CreativeUploaderProps> = ({ onClose }) => {
  const { selectedCampaign, selectedAdvertiser, uploadCreative } = useApp();
  const [items, setItems] = useState<UploadItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newItems: UploadItem[] = Array.from(e.target.files).map(file => ({
        id: `creative-${Math.random().toString(36).substr(2, 9)}`,
        file,
        name: file.name.replace(/\.[^/.]+$/, ""), // Remove extension
        status: 'pending',
      }));
      setItems(prev => [...prev, ...newItems]);
    }
  };

  const handleUpload = async () => {
    if (!selectedAdvertiser) {
      alert("Please select an advertiser first.");
      return;
    }
    setIsUploading(true);

    for (const item of items) {
      if (item.status === 'pending') {
        setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: 'uploading' } : i));
        
        const result = await uploadCreative(item.file, item.name, item.file.type);

        setItems(prev => prev.map(i => i.id === item.id ? {
          ...i,
          status: result.success ? 'success' : 'error',
          error: result.error,
        } : i));
      }
    }
    setIsUploading(false);
  };

  const removeItem = (id: string) => {
    setItems(prev => prev.filter(item => item.id !== id));
  };
  const { selectedAdvertiser, uploadCreative } = useApp();
  const [items, setItems] = useState<UploadItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newItems: UploadItem[] = Array.from(e.target.files).map(file => ({
        id: `creative-${Math.random().toString(36).substr(2, 9)}`,
        file,
        name: file.name.replace(/\.[^/.]+$/, ""), // Remove extension
        status: 'pending',
      }));
      setItems(prev => [...prev, ...newItems]);
    }
  };

  const handleUpload = async () => {
    if (!selectedAdvertiser) {
      // This is a good place to show a toast or a more integrated message
      alert("Please select an advertiser first.");
      return;
    }
    setIsUploading(true);

    for (const item of items) {
      if (item.status === 'pending') {
        setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: 'uploading' } : i));
        
        // Assuming uploadCreative is now correctly defined in the context
        const result = await uploadCreative(item.file, item.name, item.file.type);

        setItems(prev => prev.map(i => i.id === item.id ? {
          ...i,
          status: result.success ? 'success' : 'error',
          error: result.error,
        } : i));
      }
    }
    setIsUploading(false);
  };

  const removeItem = (id: string) => {
    setItems(prev => prev.filter(item => item.id !== id));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="bg-slate-900 w-full max-w-3xl rounded-2xl border border-slate-800 shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        <div className="p-6 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <UploadCloud className="w-5 h-5 text-blue-500" />
              Upload Creatives
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Advertiser: <span className="text-blue-400 font-bold">{selectedAdvertiser?.name || 'N/A'}</span>
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-8 space-y-6">
          <div>
            <label htmlFor="file-upload" className="group cursor-pointer p-8 border-2 border-dashed border-slate-800 hover:border-blue-500/50 rounded-2xl flex flex-col items-center justify-center text-center transition-colors">
              <div className="w-16 h-16 bg-slate-800/50 group-hover:bg-blue-600/10 rounded-full flex items-center justify-center mb-4 transition-all">
                <UploadCloud className="w-8 h-8 text-slate-500 group-hover:text-blue-400" />
              </div>
              <p className="font-bold text-slate-300">Drag & drop files here</p>
              <p className="text-xs text-slate-500">or click to browse</p>
            </label>
            <input id="file-upload" type="file" multiple onChange={handleFileSelect} className="hidden" />
          </div>

          {items.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Upload Queue ({items.length})</h3>
              <div className="bg-slate-950 rounded-xl border border-slate-800 max-h-64 overflow-y-auto">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-slate-800/50">
                    {items.map(item => (
                      <tr key={item.id}>
                        <td className="p-4 flex items-center gap-3">
                          <File className="w-5 h-5 text-slate-600" />
                          <input 
                            value={item.name}
                            onChange={(e) => {
                              setItems(prev => prev.map(i => i.id === item.id ? { ...i, name: e.target.value } : i));
                            }}
                            className="bg-transparent focus:outline-none w-full text-slate-300"
                          />
                        </td>
                        <td className="p-4 text-right w-48">
                          {item.status === 'pending' && <span className="text-xs font-bold text-slate-500">Pending</span>}
                          {item.status === 'uploading' && <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />}
                          {item.status === 'success' && <CheckCircle className="w-4 h-4 text-emerald-500" />}
                          {item.status === 'error' && <AlertTriangle className="w-4 h-4 text-rose-500" title={item.error} />}
                        </td>
                        <td className="p-4 text-right w-16">
                          <button onClick={() => removeItem(item.id)} className="text-slate-600 hover:text-rose-500">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="p-6 border-t border-slate-800 bg-slate-900/50 flex justify-end items-center">
          <div className="flex gap-3">
            <button 
              onClick={onClose}
              className="px-6 py-2.5 rounded-xl text-slate-400 hover:text-white transition-all font-bold text-sm"
            >
              Cancel
            </button>
            <button 
              onClick={handleUpload}
              disabled={isUploading || items.length === 0 || items.every(i => i.status !== 'pending')}
              className="flex items-center gap-2 px-8 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-sm transition-all disabled:opacity-50 shadow-lg shadow-blue-600/20"
            >
              {isUploading ? 'Uploading...' : `Upload ${items.filter(i => i.status === 'pending').length} Creatives`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CreativeUploader;
