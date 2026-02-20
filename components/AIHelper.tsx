
import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { getAdOpsAssistantResponse } from '../services/gemini';
import { Send, Cpu, User, Sparkles, Loader2, Trash2 } from 'lucide-react';

const AIHelper: React.FC = () => {
  const [messages, setMessages] = useState<{ role: 'user' | 'model'; text: string }[]>([
    { role: 'model', text: 'Hi! I am your CM360 AdOps Assistant. How can I help you today with your campaign management or naming conventions?' }
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  const handleSend = async () => {
    if (!input.trim() || isTyping) return;

    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: userMessage }]);
    setIsTyping(true);

    const history = messages.map(m => ({
      role: m.role,
      parts: [{ text: m.text }]
    }));

    const response = await getAdOpsAssistantResponse(userMessage, history);
    
    setIsTyping(false);
    setMessages(prev => [...prev, { role: 'model', text: response || 'Sorry, I encountered an error.' }]);
  };

  const chips = [
    "Normalize naming for Spain campaign",
    "Suggest structure for Video placements",
    "Fix common naming characters",
    "Check for duplicate naming logic"
  ];

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950/40 max-w-4xl mx-auto border-x border-slate-800">
      <div className="p-4 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center">
            <Cpu className="w-6 h-6 text-blue-500" />
          </div>
          <div>
            <h2 className="font-bold text-slate-100">AdOps Assistant</h2>
            <p className="text-[11px] text-slate-500 uppercase font-bold tracking-wider">AI Copilot • Online</p>
          </div>
        </div>
        <button 
          onClick={() => setMessages([{ role: 'model', text: 'History cleared. How can I help you?' }])}
          className="p-2 text-slate-500 hover:text-rose-400 transition-colors"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-6 space-y-6 scroll-smooth"
      >
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-4 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${
              m.role === 'model' ? 'bg-blue-600/20 text-blue-400' : 'bg-slate-700 text-slate-300'
            }`}>
              {m.role === 'model' ? <Sparkles className="w-4 h-4" /> : <User className="w-4 h-4" />}
            </div>
            <div className={`max-w-[80%] rounded-2xl p-4 text-sm leading-relaxed ${
              m.role === 'model' 
                ? 'bg-slate-800/50 text-slate-200 border border-slate-700/50' 
                : 'bg-blue-600 text-white shadow-lg shadow-blue-500/10'
            }`}>
              <div className="whitespace-pre-wrap">
                {m.text}
              </div>
            </div>
          </div>
        ))}
        {isTyping && (
          <div className="flex gap-4">
            <div className="shrink-0 w-8 h-8 rounded-lg bg-blue-600/20 text-blue-400 flex items-center justify-center">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="bg-slate-800/50 rounded-2xl p-4 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
              <span className="text-sm text-slate-500">Reasoning...</span>
            </div>
          </div>
        )}
      </div>

      <div className="p-4 border-t border-slate-800 bg-slate-900/40 backdrop-blur-md">
        <div className="flex gap-2 overflow-x-auto mb-4 pb-2 no-scrollbar">
          {chips.map(chip => (
            <button 
              key={chip}
              onClick={() => setInput(chip)}
              className="shrink-0 px-3 py-1.5 rounded-full border border-slate-700 bg-slate-800 text-xs text-slate-400 hover:text-white hover:border-blue-500/50 transition-all"
            >
              {chip}
            </button>
          ))}
        </div>
        <div className="relative">
          <input 
            type="text"
            placeholder="Ask anything about CM360 management..."
            className="w-full bg-slate-900 border border-slate-700 rounded-xl py-3 pl-4 pr-14 text-sm text-slate-200 focus:outline-none focus:border-blue-500/50 transition-all placeholder:text-slate-600"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          />
          <button 
            onClick={handleSend}
            disabled={!input.trim() || isTyping}
            className="absolute right-2 top-2 p-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-600 text-white transition-all"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default AIHelper;
