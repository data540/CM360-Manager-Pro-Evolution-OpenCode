
import React, { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import { Advertiser, Campaign, Placement, Creative, ViewType, Site } from '../types';
import { MOCK_ADVERTISERS, MOCK_CAMPAIGNS, MOCK_PLACEMENTS, MOCK_CREATIVES, MOCK_SITES } from '../constants';

interface UserProfile {
  name: string;
  email: string;
  picture: string;
}

interface AppContextType {
  advertisers: Advertiser[];
  campaigns: Campaign[];
  placements: Placement[];
  creatives: Creative[];
  sites: Site[];
  
  selectedAdvertiser: Advertiser | null;
  selectedCampaign: Campaign | null;
  currentView: ViewType;
  
  setSelectedAdvertiser: (adv: Advertiser | null) => void;
  setSelectedCampaign: (camp: Campaign | null) => void;
  setCurrentView: (view: ViewType) => void;
  
  addPlacements: (newPlacements: Placement[]) => void;
  updatePlacement: (placement: Placement) => void;
  deletePlacement: (id: string) => void;
  
  connectionStatus: 'Connected' | 'Disconnected' | 'Connecting';
  isAuthenticated: boolean;
  accessToken: string | null;
  profileId: string | null;
  user: UserProfile | null;
  login: (customClientId?: string) => void;
  loginWithToken: (token: string) => Promise<{success: boolean, error?: string}>;
  enterDemoMode: () => void;
  logout: () => void;
  fetchAdvertisers: () => Promise<void>;
  fetchCampaigns: (advertiserId: string) => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const DEFAULT_CLIENT_ID = "547547481261-0o6coge0fufp839q33ekv7hk1930m7o1.apps.googleusercontent.com";
const CM360_SCOPES = "https://www.googleapis.com/auth/dfareporting openid profile email";

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [advertisers, setAdvertisers] = useState<Advertiser[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [creatives, setCreatives] = useState<Creative[]>([]);
  const [sites] = useState<Site[]>(MOCK_SITES);
  
  const [selectedAdvertiser, setSelectedAdvertiser] = useState<Advertiser | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [currentView, setCurrentView] = useState<ViewType>('Placements');
  const [connectionStatus, setConnectionStatus] = useState<'Connected' | 'Disconnected' | 'Connecting'>('Disconnected');
  
  const [accessToken, setAccessToken] = useState<string | null>(localStorage.getItem('cm360_token'));
  const [profileId, setProfileId] = useState<string | null>(localStorage.getItem('cm360_profile_id'));
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(!!localStorage.getItem('cm360_token'));
  const [user, setUser] = useState<UserProfile | null>(() => {
    const saved = localStorage.getItem('cm360_user');
    return saved ? JSON.parse(saved) : null;
  });

  const [tokenClient, setTokenClient] = useState<any>(null);

  const initGsi = (clientId: string) => {
    if (typeof window !== 'undefined' && (window as any).google?.accounts?.oauth2) {
      try {
        const client = (window as any).google.accounts.oauth2.initTokenClient({
          client_id: clientId || DEFAULT_CLIENT_ID,
          scope: CM360_SCOPES,
          callback: async (response: any) => {
            if (response.error) {
              console.error("GSI Error Callback:", response);
              setConnectionStatus('Disconnected');
              return;
            }
            const result = await handleAuthSuccess(response.access_token);
            if (!result.success) {
               // El error se maneja dentro de handleAuthSuccess y se muestra en la UI vía eventos o estado si fuera necesario
               console.error("Auth flow failed:", result.error);
            }
          },
        });
        setTokenClient(client);
        return client;
      } catch (e) {
        console.error("Failed to init GSI client", e);
        return null;
      }
    }
    return null;
  };

  useEffect(() => {
    const checkGsi = () => {
      const customId = localStorage.getItem('cm360_custom_client_id');
      if ((window as any).google?.accounts?.oauth2) {
        initGsi(customId || DEFAULT_CLIENT_ID);
      } else {
        setTimeout(checkGsi, 500);
      }
    };
    checkGsi();
  }, []);

  const handleAuthSuccess = async (token: string): Promise<{success: boolean, error?: string}> => {
    setConnectionStatus('Connecting');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 segundos de timeout

    try {
      console.log("🔍 Iniciando validación de token...");
      
      // 1. Validar usuario (UserInfo)
      console.log("👤 Verificando identidad del usuario...");
      const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal
      });
      
      if (!userInfoRes.ok) {
        const errData = await userInfoRes.json().catch(() => ({}));
        console.error("❌ Error en UserInfo:", userInfoRes.status, errData);
        throw new Error(`Error de Identidad (${userInfoRes.status}): El token no tiene permisos para leer tu perfil de Google. Revisa los Scopes.`);
      }
      const userData = await userInfoRes.json();
      console.log("✅ Usuario identificado:", userData.email);

      // 2. Buscar Perfiles en CM360
      console.log("📊 Buscando perfiles de CM360...");
      const profilesRes = await fetch('https://dfareporting.googleapis.com/dfareporting/v4/userprofiles', {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal
      });
      
      const profilesData = await profilesRes.json();
      
      if (!profilesRes.ok) {
        console.error("❌ Error en UserProfiles:", profilesRes.status, profilesData);
        if (profilesRes.status === 403) {
          throw new Error("ERROR 403: Acceso denegado. Debes habilitar 'Campaign Manager 360 API' en tu consola de Google Cloud.");
        }
        if (profilesRes.status === 401) {
          throw new Error("ERROR 401: El token ha expirado o es inválido.");
        }
        throw new Error(`API Error: ${profilesData.error?.message || 'Error desconocido al conectar con CM360'}`);
      }
      
      if (profilesData.items && profilesData.items.length > 0) {
        console.log("✅ Perfil encontrado:", profilesData.items[0].profileId);
        const pid = profilesData.items[0].profileId;
        const userProfile = { 
          name: userData.name || "User", 
          email: userData.email || "No email", 
          picture: userData.picture || `https://api.dicebear.com/7.x/initials/svg?seed=${userData.name}`
        };
        
        setAccessToken(token);
        setProfileId(pid);
        setUser(userProfile);
        setIsAuthenticated(true);
        setConnectionStatus('Connected');
        
        localStorage.setItem('cm360_token', token);
        localStorage.setItem('cm360_profile_id', pid);
        localStorage.setItem('cm360_user', JSON.stringify(userProfile));
        
        fetchAdvertisersInternal(token, pid);
        return { success: true };
      } else {
        console.warn("⚠️ No se encontraron perfiles de CM360 para este usuario.");
        throw new Error("SIN PERFIL: Tu cuenta de Google no está asociada a ningún perfil de Campaign Manager 360.");
      }
    } catch (error: any) {
      clearTimeout(timeoutId);
      const isTimeout = error.name === 'AbortError';
      const message = isTimeout 
        ? "TIEMPO AGOTADO: Google no responde. Revisa tu conexión a internet o intenta de nuevo."
        : error.message;
        
      console.error("🚨 Fallo en la autenticación:", message);
      setConnectionStatus('Disconnected');
      window.dispatchEvent(new CustomEvent('cm360_auth_error', { detail: message }));
      return { success: false, error: message };
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const fetchAdvertisersInternal = async (token: string, pid: string) => {
    try {
      console.log("📡 Cargando anunciantes...");
      const res = await fetch(`https://dfareporting.googleapis.com/dfareporting/v4/userprofiles/${pid}/advertisers?maxResults=100`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.advertisers) {
        setAdvertisers(data.advertisers.map((a: any) => ({ id: a.id, name: a.name })));
        console.log(`✅ ${data.advertisers.length} anunciantes cargados.`);
      }
    } catch (e) {
      console.error("Fetch advertisers error:", e);
    }
  };

  const fetchCampaignsInternal = async (token: string, pid: string, advertiserId: string) => {
    try {
      console.log(`📡 Cargando campañas para el anunciante ${advertiserId}...`);
      const res = await fetch(`https://dfareporting.googleapis.com/dfareporting/v4/userprofiles/${pid}/campaigns?advertiserIds=${advertiserId}&maxResults=100&archived=false`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.campaigns) {
        const mappedCampaigns: Campaign[] = data.campaigns.map((c: any) => ({
          id: c.id,
          advertiserId: c.advertiserId,
          name: c.name,
          status: 'Active', // CM360 doesn't have a simple status string like this in the base object usually
          startDate: c.startDate,
          endDate: c.endDate,
          budget: 0,
          objective: '',
          updatedAt: new Date().toISOString()
        }));
        setCampaigns(mappedCampaigns);
        console.log(`✅ ${mappedCampaigns.length} campañas cargadas.`);
      } else {
        setCampaigns([]);
        console.log("ℹ️ No se encontraron campañas activas para este anunciante.");
      }
    } catch (e) {
      console.error("Fetch campaigns error:", e);
    }
  };

  useEffect(() => {
    if (isAuthenticated && accessToken && profileId && selectedAdvertiser) {
      fetchCampaignsInternal(accessToken, profileId, selectedAdvertiser.id);
    }
  }, [selectedAdvertiser, isAuthenticated, accessToken, profileId]);

  const fetchAdvertisers = async () => {
    if (accessToken && profileId) await fetchAdvertisersInternal(accessToken, profileId);
  };

  const fetchCampaigns = async (advertiserId: string) => {
    if (accessToken && profileId) await fetchCampaignsInternal(accessToken, profileId, advertiserId);
  };

  const loginWithToken = async (token: string) => {
    return await handleAuthSuccess(token);
  };

  const enterDemoMode = () => {
    setAdvertisers(MOCK_ADVERTISERS);
    setCampaigns(MOCK_CAMPAIGNS);
    setPlacements(MOCK_PLACEMENTS);
    setCreatives(MOCK_CREATIVES);
    setUser({
      name: "AdOps Demo User",
      email: "demo@adops.pro",
      picture: "https://api.dicebear.com/7.x/bottts/svg?seed=demo"
    });
    setIsAuthenticated(true);
    setConnectionStatus('Disconnected');
  };

  const login = (customClientId?: string) => {
    const client = customClientId ? initGsi(customClientId) : tokenClient;
    if (client) {
      client.requestAccessToken({ prompt: 'consent' });
    } else {
      const errorMsg = "Google Identity Services no se ha cargado correctamente. Recarga la página.";
      window.dispatchEvent(new CustomEvent('cm360_auth_error', { detail: errorMsg }));
    }
  };

  const logout = () => {
    setIsAuthenticated(false);
    setAccessToken(null);
    setProfileId(null);
    setUser(null);
    setConnectionStatus('Disconnected');
    localStorage.clear();
  };

  const addPlacements = (newPlacements: Placement[]) => setPlacements(prev => [...prev, ...newPlacements]);
  const updatePlacement = (updated: Placement) => setPlacements(prev => prev.map(p => p.id === updated.id ? updated : p));
  const deletePlacement = (id: string) => setPlacements(prev => prev.filter(p => p.id !== id));

  return (
    <AppContext.Provider value={{
      advertisers, campaigns, placements, creatives, sites,
      selectedAdvertiser, selectedCampaign, currentView,
      setSelectedAdvertiser, setSelectedCampaign, setCurrentView,
      addPlacements, updatePlacement, deletePlacement,
      connectionStatus, isAuthenticated, accessToken, profileId, user, login, loginWithToken, enterDemoMode, logout,
      fetchAdvertisers, fetchCampaigns
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within an AppProvider');
  return context;
};
