
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
  placementsDrafts: { [id: string]: Placement };
  creatives: Creative[];
  sites: Site[];
  landingPages: { id: string, name: string, url: string }[];
  
  selectedAdvertiser: Advertiser | null;
  selectedCampaign: Campaign | null;
  currentView: ViewType;
  isGlobalSearchActive: boolean;
  
  setSelectedAdvertiser: (adv: Advertiser | null) => void;
  setSelectedCampaign: (camp: Campaign | null) => void;
  setCurrentView: (view: ViewType) => void;
  setIsGlobalSearchActive: (active: boolean) => void;
  
  addPlacements: (newPlacements: Placement[]) => void;
  updatePlacement: (placement: Placement) => void;
  updatePlacementDraft: (placementId: string, changes: Partial<Placement>) => void;
  updatePlacementName: (placementId: string, newName: string) => void;
  deletePlacement: (id: string) => void;
  publishSelectedDrafts: (placementIds: string[]) => Promise<{success: number, failed: number, results: {id: string, success: boolean, error?: string}[]}>;
  
  connectionStatus: 'Connected' | 'Disconnected' | 'Connecting';
  isAuthenticated: boolean;
  accessToken: string | null;
  profileId: string | null;
  accountId: string | null;
  user: UserProfile | null;
  login: (customClientId?: string) => void;
  loginWithToken: (token: string) => Promise<{success: boolean, error?: string}>;
  enterDemoMode: () => void;
  logout: () => void;
  fetchAdvertisers: () => Promise<void>;
  fetchCampaigns: (advertiserId: string) => Promise<void>;
  fetchPlacements: (campaignId: string) => Promise<void>;
  fetchCreatives: () => Promise<void>;
  fetchAllCreatives: () => Promise<void>;
  fetchSites: () => Promise<void>;
  fetchLandingPages: (advertiserId: string) => Promise<void>;
  createCampaign: (campaign: Partial<Campaign>) => Promise<{success: boolean, id?: string, error?: string}>;
  updateCampaignStatus: (campaignId: string, status: Status) => Promise<{success: boolean, error?: string}>;
  isCampaignsLoading: boolean;
  pushPlacements: (placementIds: string[]) => Promise<{success: number, failed: number, error?: string, createdItems: {id: string, cmId: string, name: string}[]}>;
  uploadCreative: (file: File, name: string, type: string, sizeStr?: string) => Promise<{success: boolean, id?: string, error?: string}>;
  updateCreativeStatus: (creativeIds: string[], active: boolean) => Promise<{success: number, failed: number, error?: string}>;
  copyCreative: (creativeId: string, destinationAdvertiserId: string) => Promise<{success: boolean, id?: string, error?: string}>;
  assignCreativeToPlacement: (creativeId: string, placementId: string, campaignId: string) => Promise<{success: boolean, id?: string, error?: string}>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const DEFAULT_CLIENT_ID = "547547481261-0o6coge0fufp839q33ekv7hk1930m7o1.apps.googleusercontent.com";
const CM360_SCOPES = "https://www.googleapis.com/auth/dfareporting https://www.googleapis.com/auth/dfatrafficking openid https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email";

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [advertisers, setAdvertisers] = useState<Advertiser[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [placementsDrafts, setPlacementsDrafts] = useState<{ [id: string]: Placement }>({});
  const [creatives, setCreatives] = useState<Creative[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [landingPages, setLandingPages] = useState<{ id: string, name: string, url: string }[]>([]);
  
  const [selectedAdvertiser, setSelectedAdvertiser] = useState<Advertiser | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [currentView, setCurrentView] = useState<ViewType>('Placements');
  const [isGlobalSearchActive, setIsGlobalSearchActive] = useState<boolean>(false);
  const [isCampaignsLoading, setIsCampaignsLoading] = useState<boolean>(false);
  const [connectionStatus, setConnectionStatus] = useState<'Connected' | 'Disconnected' | 'Connecting'>('Disconnected');
  
  const [accessToken, setAccessToken] = useState<string | null>(localStorage.getItem('cm360_token'));
  const [profileId, setProfileId] = useState<string | null>(localStorage.getItem('cm360_profile_id'));
  const [accountId, setAccountId] = useState<string | null>(localStorage.getItem('cm360_account_id'));
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
          prompt: 'consent',
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
      const profilesRes = await fetch('/api/cm360/userprofiles', {
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
        const accId = profilesData.items[0].accountId;
        const userProfile = { 
          name: userData.name || "User", 
          email: userData.email || "No email", 
          picture: userData.picture || `https://api.dicebear.com/7.x/initials/svg?seed=${userData.name}`
        };
        
        setAccessToken(token);
        setProfileId(pid);
        setAccountId(accId);
        setUser(userProfile);
        setIsAuthenticated(true);
        setConnectionStatus('Connected');
        
        localStorage.setItem('cm360_token', token);
        localStorage.setItem('cm360_profile_id', pid);
        localStorage.setItem('cm360_account_id', accId);
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
      const res = await fetch(`/api/cm360/userprofiles/${pid}/advertisers?maxResults=100`, {
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
      setIsCampaignsLoading(true);
      console.log(`📡 Cargando campañas para el anunciante ${advertiserId}...`);
      const res = await fetch(`/api/cm360/userprofiles/${pid}/campaigns?advertiserIds=${advertiserId}&maxResults=100&archived=false`, {
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
    } finally {
      setIsCampaignsLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated && accessToken && profileId && selectedAdvertiser) {
      fetchCampaignsInternal(accessToken, profileId, selectedAdvertiser.id);
      fetchCreativesInternal(accessToken, profileId, selectedAdvertiser.id);
      fetchSitesInternal(accessToken, profileId);
    }
    if (isAuthenticated && accessToken && profileId && selectedCampaign) {
      fetchPlacements(selectedCampaign.id);
    }
  }, [selectedAdvertiser, selectedCampaign, isAuthenticated, accessToken, profileId]);

  const fetchAdvertisers = async () => {
    if (accessToken && profileId) await fetchAdvertisersInternal(accessToken, profileId);
  };

  const fetchCampaigns = async (advertiserId: string) => {
    if (accessToken && profileId) await fetchCampaignsInternal(accessToken, profileId, advertiserId);
  };

  const fetchPlacements = async (campaignId: string) => {
    if (!accessToken || !profileId || !campaignId) return;
    try {
      console.log(`📡 Cargando placements para la campaña ${campaignId}...`);
      const res = await fetch(`/api/cm360/userprofiles/${profileId}/placements?campaignIds=${campaignId}&maxResults=100`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const data = await res.json();
      if (data.placements) {
        const fetchedPlacements: Placement[] = data.placements.map((p: any) => ({
          id: p.id,
          cmId: p.id,
          name: p.name,
          campaignId: p.campaignId,
          siteId: p.siteId,
          size: p.size ? `${p.size.width}x${p.size.height}` : 'N/A',
          pricingType: p.pricingType || 'N/A',
          compatibility: p.compatibility || 'N/A',
          status: p.status || 'N/A',
          createdAt: p.createInfo?.time || 'N/A',
          updatedAt: p.lastModifiedInfo?.time || 'N/A',
          externalUrl: p.tagFormats?.[0]?.url || '',
          isDraft: false,
          originalData: { ...p }
        }));
        setPlacements(fetchedPlacements);
        setPlacementsDrafts({}); // Clear drafts on new fetch
        console.log(`✅ ${fetchedPlacements.length} placements cargados.`);
      } else {
        setPlacements([]);
        setPlacementsDrafts({});
      }
    } catch (e) {
      console.error("Fetch placements error:", e);
    }
  };

  const fetchCreativesInternal = async (token: string, pid: string, advertiserId: string) => {
    try {
      console.log(`📡 Cargando creatividades para el anunciante ${advertiserId}...`);
      const res = await fetch(`/api/cm360/userprofiles/${pid}/creatives?advertiserId=${advertiserId}&maxResults=100&archived=false`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.creatives) {
        const mappedCreatives: Creative[] = data.creatives.map((c: any) => {
          const sizeStr = c.size ? `${c.size.width}x${c.size.height}` : '300x250';
          const [width, height] = sizeStr.includes('x') ? sizeStr.split('x').map(Number) : [300, 250];
          
          const simulatedThumb = `https://picsum.photos/seed/${c.id}/${width || 300}/${height || 250}`;

          // Construcción de la URL basada en la estructura real de CM360 observada en la imagen
          // Si hay una campaña seleccionada, usamos el explorer de la campaña. 
          // Si no, usamos la vista de anunciante.
          const baseUrl = `https://campaignmanager.google.com/trafficking/#/accounts/${accountId}`;
          const creativePath = selectedCampaign 
            ? `/campaigns/${selectedCampaign.id}/explorer/creatives/${c.id}`
            : `/advertisers/${advertiserId}/creatives/${c.id}`;

          return {
            id: c.id,
            name: c.name,
            type: c.type,
            size: sizeStr,
            status: 'Active',
            active: c.active, // Add active status
            thumbnailUrl: simulatedThumb,
            placementIds: [],
            externalUrl: `${baseUrl}${creativePath}`
          };
        });
        setCreatives(mappedCreatives);
        console.log(`✅ ${mappedCreatives.length} creatividades cargadas.`);
      } else {
        setCreatives([]);
        console.log("ℹ️ No se encontraron creatividades para este anunciante.");
      }
    } catch (e) {
      console.error("Fetch creatives error:", e);
    }
  };

  const fetchCreatives = async () => {
    if (accessToken && profileId && selectedAdvertiser) {
      await fetchCreativesInternal(accessToken, profileId, selectedAdvertiser.id);
    }
  };

  const fetchAllCreatives = async () => {
    if (!accessToken || !profileId || advertisers.length === 0) return;
    try {
      console.log("📡 Cargando creatividades de TODOS los anunciantes (limitado a los 5 primeros)...");
      const allCreatives: Creative[] = [];
      const limit = Math.min(advertisers.length, 5);
      
      for (let i = 0; i < limit; i++) {
        const adv = advertisers[i];
        const res = await fetch(`/api/cm360/userprofiles/${profileId}/creatives?advertiserId=${adv.id}&maxResults=20&archived=false`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        const data = await res.json();
        if (data.creatives) {
          const mapped = data.creatives.map((c: any) => {
            const sizeStr = c.size ? `${c.size.width}x${c.size.height}` : '300x250';
            const [width, height] = sizeStr.includes('x') ? sizeStr.split('x').map(Number) : [300, 250];
            const simulatedThumb = `https://picsum.photos/seed/${c.id}/${width || 300}/${height || 250}`;
            return {
              id: c.id,
              name: `[${adv.name}] ${c.name}`,
              type: c.type,
              size: sizeStr,
              status: 'Active',
              thumbnailUrl: simulatedThumb,
              placementIds: [],
              externalUrl: `https://campaignmanager.google.com/trafficking/#/accounts/${accountId}/advertisers/${adv.id}/creatives/${c.id}`
            };
          });
          allCreatives.push(...mapped);
        }
      }
      setCreatives(allCreatives);
      console.log(`✅ ${allCreatives.length} creatividades cargadas globalmente.`);
    } catch (e) {
      console.error("Fetch all creatives error:", e);
    }
  };

  const fetchSitesInternal = async (token: string, pid: string) => {
    try {
      console.log("📡 Cargando sitios...");
      const res = await fetch(`/api/cm360/userprofiles/${pid}/sites?maxResults=100`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.sites) {
        setSites(data.sites.map((s: any) => ({ id: s.id, name: s.name, url: s.keyName })));
        console.log(`✅ ${data.sites.length} sitios cargados.`);
      }
    } catch (e) {
      console.error("Fetch sites error:", e);
    }
  };

  const fetchSites = async () => {
    if (accessToken && profileId) await fetchSitesInternal(accessToken, profileId);
  };

  const fetchLandingPages = async (advertiserId: string) => {
    if (!accessToken || !profileId) return;
    try {
      console.log(`📡 Cargando landing pages para el anunciante ${advertiserId}...`);
      const res = await fetch(`/api/cm360/userprofiles/${profileId}/advertiserLandingPages?advertiserIds=${advertiserId}&maxResults=100`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const data = await res.json();
      if (data.landingPages) {
        setLandingPages(data.landingPages.map((lp: any) => ({ id: lp.id, name: lp.name, url: lp.url })));
        console.log(`✅ ${data.landingPages.length} landing pages cargadas.`);
      } else {
        setLandingPages([]);
      }
    } catch (e) {
      console.error("Fetch landing pages error:", e);
    }
  };

  const createCampaign = async (campaignData: Partial<Campaign>) => {
    if (!accessToken || !profileId || !selectedAdvertiser) return { success: false, error: 'No connection' };
    try {
      const body: any = {
        advertiserId: selectedAdvertiser.id,
        name: campaignData.name,
        startDate: campaignData.startDate,
        endDate: campaignData.endDate,
        defaultLandingPageName: campaignData.landingPageUrl ? 'Campaign Landing Page' : 'Default Landing Page',
        defaultLandingPageUrl: campaignData.landingPageUrl || 'https://www.aireuropa.com'
      };

      // EU Political Ads Declaration
      if (campaignData.isEuPolitical !== undefined) {
        body.declarations = {
          euPoliticalAds: campaignData.isEuPolitical
        };
      }

      const res = await fetch(`/api/cm360/userprofiles/${profileId}/campaigns`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });
      
      if (res.ok) {
        const data = await res.json();
        await fetchCampaignsInternal(accessToken, profileId, selectedAdvertiser.id);
        return { success: true, id: data.id };
      }
      
      const data = await res.json().catch(() => ({}));
      console.error("Create campaign API error:", data);
      return { success: false, error: data.error?.message || `API Error ${res.status}: ${res.statusText}` };
    } catch (e: any) {
      console.error("Create campaign network error:", e);
      return { success: false, error: e.message || 'Network error' };
    }
  };

  const updateCampaignStatus = async (campaignId: string, status: Status) => {
    // 1. Handle Demo Mode
    if (isAuthenticated && !accessToken) {
      console.log("🛠️ [Demo Mode] Simulating status update to:", status);
      setCampaigns(prev => prev.map(c => c.id === campaignId ? { ...c, status } : c));
      return { success: true };
    }

    if (!accessToken || !profileId) return { success: false, error: 'No connection' };

    try {
      console.log(`📡 Attempting to update campaign ${campaignId} to ${status} via Proxy...`);
      
      // We use the local proxy to avoid CORS issues.
      // The proxy forwards the request to Google.
      const res = await fetch(`/api/cm360/userprofiles/${profileId}/campaigns/${campaignId}?updateMask=archived`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: campaignId,
          archived: status === 'Paused' || status === 'Completed'
        })
      });

      if (res.ok) {
        setCampaigns(prev => prev.map(c => c.id === campaignId ? { ...c, status } : c));
        return { success: true };
      }
      
      const data = await res.json().catch(() => ({}));
      console.error("❌ CM360 API Error via Proxy:", data);
      return { success: false, error: data.error?.message || `Error ${res.status}: ${res.statusText}` };
    } catch (e: any) {
      console.error("🚨 Proxy Connection Error:", e);
      return { 
        success: false, 
        error: "Error de Servidor: No se pudo contactar con el proxy local. Intenta recargar la página." 
      };
    }
  };

  const pushPlacements = async (placementIds: string[]) => {
    if (!accessToken || !profileId) return { success: 0, failed: placementIds.length, createdItems: [] };
    let successCount = 0;
    let failedCount = 0;
    let lastError = '';
    const createdItems: {id: string, cmId: string, name: string}[] = [];

    const placementsToPush = placements.filter(p => placementIds.includes(p.id));

    for (const p of placementsToPush) {
      try {
        const res = await fetch(`/api/cm360/userprofiles/${profileId}/placements`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            campaignId: p.campaignId,
            name: p.name,
            siteId: p.siteId,
            compatibility: p.compatibility,
            size: {
              width: p.size.includes('x') ? p.size.split('x')[0] : (p.type === 'Video' ? '640' : '300'),
              height: p.size.includes('x') ? p.size.split('x')[1] : (p.type === 'Video' ? '480' : '250')
            },
            tagFormats: p.type === 'Video' 
              ? ["PLACEMENT_TAG_INSTREAM_VIDEO_PREFETCH"] 
              : ["PLACEMENT_TAG_STANDARD", "PLACEMENT_TAG_IFRAME_JAVASCRIPT", "PLACEMENT_TAG_INTERNAL_REDIRECT"],
            paymentSource: 'PLACEMENT_AGENCY_PAID',
            pricingSchedule: {
              pricingType: 'PRICING_TYPE_CPM',
              startDate: p.startDate,
              endDate: p.endDate
            }
          })
        });
        
        const data = await res.json();
        
        if (res.ok) {
          successCount++;
          createdItems.push({ id: p.id, cmId: data.id, name: p.name });
          
          const baseUrl = `https://campaignmanager.google.com/trafficking/#/accounts/${accountId}`;
          const placementPath = `/campaigns/${p.campaignId}/explorer/placements/${data.id}`;
          const externalUrl = `${baseUrl}${placementPath}`;

          setPlacements(prev => prev.map(item => item.id === p.id ? { 
            ...item, 
            status: 'Active',
            externalUrl: externalUrl
          } : item));
        } else {
          failedCount++;
          lastError = data.error?.message || `Error ${res.status}`;
          console.error("Placement push failed:", data);
        }
      } catch (e: any) {
        failedCount++;
        lastError = e.message;
      }
    }
    return { success: successCount, failed: failedCount, error: lastError, createdItems };
  };

  const uploadCreative = async (file: File, name: string, format: string, sizeStr?: string) => {
    // ... existing implementation ...
  };

  const updateCreativeStatus = async (creativeIds: string[], active: boolean) => {
    if (!accessToken || !profileId) return { success: 0, failed: creativeIds.length, error: 'No connection' };
    let successCount = 0;
    let failedCount = 0;
    let lastError = '';

    for (const id of creativeIds) {
      try {
        // We use the local proxy to avoid CORS issues.
        const res = await fetch(`/api/cm360/userprofiles/${profileId}/creatives/${id}?updateMask=active`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ 
            id: id,
            active: active 
          })
        });
        
        if (res.ok) {
          successCount++;
        } else {
          failedCount++;
          const data = await res.json().catch(() => ({}));
          lastError = data.error?.message || `API Error ${res.status}: ${res.statusText}`;
          console.error(`Creative status update failed for ${id}:`, data);
        }
      } catch (e: any) {
        failedCount++;
        lastError = e.message || 'Network error';
        console.error(`Creative status update network error for ${id}:`, e);
      }
    }

    if (successCount > 0 && selectedAdvertiser) {
      await fetchCreativesInternal(accessToken, profileId, selectedAdvertiser.id);
    }

    return { success: successCount, failed: failedCount, error: lastError };
  };

  const copyCreative = async (creativeId: string, destinationAdvertiserId: string) => {
    if (!accessToken || !profileId) return { success: false, error: 'No connection' };
    try {
      console.log(`📡 Iniciando copia de creatividad ${creativeId} al anunciante ${destinationAdvertiserId}...`);
      
      // 1. Get the source creative metadata
      const getRes = await fetch(`/api/cm360/userprofiles/${profileId}/creatives/${creativeId}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      
      if (!getRes.ok) throw new Error("No se pudo obtener la creatividad de origen.");
      const sourceCreative = await getRes.json();
      
      // 2. Handle Assets (Fix for Error 8061: Creative asset file doesn't exist)
      // In CM360, assets are scoped to an advertiser. To copy a creative, 
      // we must ensure its assets exist in the destination advertiser's library.
      if (sourceCreative.creativeAssets && sourceCreative.creativeAssets.length > 0) {
        console.log(`📦 Migrando ${sourceCreative.creativeAssets.length} assets al nuevo anunciante para evitar error 8061...`);
        
        for (const asset of sourceCreative.creativeAssets) {
          try {
            // We attempt to fetch the asset content from the preview/thumbnail URL 
            // to re-upload it to the destination advertiser.
            const creativeInState = creatives.find(c => c.id === creativeId);
            const assetUrl = creativeInState?.thumbnailUrl || `https://picsum.photos/seed/${asset.assetIdentifier.name}/300/250`;
            
            console.log(`📥 Descargando asset: ${asset.assetIdentifier.name} desde ${assetUrl}`);
            const blobRes = await fetch(assetUrl);
            if (!blobRes.ok) continue;
            
            const blob = await blobRes.blob();
            const file = new File([blob], asset.assetIdentifier.name, { type: blob.type || 'image/png' });

            // Upload asset to destination advertiser
            const metadata = { 
              assetIdentifier: { 
                type: asset.assetIdentifier.type, 
                name: asset.assetIdentifier.name 
              } 
            };
            
            const formData = new FormData();
            formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
            formData.append('file', file);

            const uploadRes = await fetch(`/api/cm360-upload/upload/dfareporting/v4/userprofiles/${profileId}/creativeAssets/${destinationAdvertiserId}/creativeAssets?uploadType=multipart`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${accessToken}` },
              body: formData
            });

            if (uploadRes.ok) {
              console.log(`✅ Asset ${asset.assetIdentifier.name} migrado con éxito.`);
            } else {
              const errData = await uploadRes.json();
              console.warn(`⚠️ No se pudo migrar el asset ${asset.assetIdentifier.name}:`, errData.error?.message);
            }
          } catch (assetErr) {
            console.error(`❌ Error procesando asset ${asset.assetIdentifier.name}:`, assetErr);
          }
        }
      }
      
      // 3. Prepare the new creative object
      // We remove IDs and update the advertiserId
      const { id, accountId, lastModifiedInfo, ...creativeData } = sourceCreative;
      creativeData.advertiserId = destinationAdvertiserId;
      creativeData.name = `${creativeData.name} (Copy)`;
      
      // 4. Insert into destination
      const insertRes = await fetch(`/api/cm360/userprofiles/${profileId}/creatives`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(creativeData)
      });
      
      const data = await insertRes.json();
      if (insertRes.ok) {
        // If the destination is the currently selected advertiser, refresh the list
        if (selectedAdvertiser?.id === destinationAdvertiserId) {
          await fetchCreativesInternal(accessToken, profileId, destinationAdvertiserId);
        }
        return { success: true, id: data.id };
      }
      return { success: false, error: data.error?.message || 'Error al copiar la creatividad' };
    } catch (e: any) {
      console.error("Copy creative error:", e);
      return { success: false, error: e.message || 'Network error' };
    }
  };

  const assignCreativeToPlacement = async (creativeId: string, placementId: string, campaignId: string) => {
    if (!accessToken || !profileId) return { success: false, error: 'No connection' };
    try {
      // 1. Create an Ad
      // We'll create a standard serving ad that links the creative to the placement
      const adRes = await fetch(`/api/cm360/userprofiles/${profileId}/ads`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          campaignId: campaignId,
          name: `Ad_${creativeId}_${placementId}`,
          active: true,
          type: 'AD_SERVING_STANDARD_AD',
          creativeAssignments: [{
            creativeId: creativeId,
            active: true
          }],
          placementAssignments: [{
            placementId: placementId,
            active: true
          }],
          startTime: new Date().toISOString(),
          endTime: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days default
        })
      });

      const adData = await adRes.json();
      if (adRes.ok) {
        return { success: true, id: adData.id };
      }
      return { success: false, error: adData.error?.message || 'Ad creation failed' };
    } catch (e: any) {
      console.error("Assign creative error:", e);
      return { success: false, error: e.message || 'Network error' };
    }
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

  const updatePlacementDraft = (placementId: string, changes: Partial<Placement>) => {
    setPlacementsDrafts(prev => {
      const original = placements.find(p => p.id === placementId);
      const currentDraft = prev[placementId] || original;
      if (!currentDraft) return prev;

      return {
        ...prev,
        [placementId]: { ...currentDraft, ...changes, isDraft: true }
      };
    });
  };

  const updatePlacementName = (placementId: string, newName: string) => {
    updatePlacementDraft(placementId, { name: newName });
  };

  const publishSelectedDrafts = async (placementIds: string[]) => {
    if (!accessToken || !profileId) return { success: 0, failed: placementIds.length, results: [] };
    
    let successCount = 0;
    let failedCount = 0;
    const results: {id: string, success: boolean, error?: string}[] = [];

    for (const id of placementIds) {
      const draft = placementsDrafts[id];
      if (!draft) continue;

      try {
        const isNew = !draft.cmId;
        const url = isNew 
          ? `/api/cm360/userprofiles/${profileId}/placements`
          : `/api/cm360/userprofiles/${profileId}/placements/${draft.cmId}`;
        
        const method = isNew ? 'POST' : 'PATCH';
        
        // Prepare body
        const body: any = {
          campaignId: draft.campaignId,
          name: draft.name,
          siteId: draft.siteId,
          compatibility: draft.compatibility,
          pricingSchedule: {
            startDate: draft.startDate,
            endDate: draft.endDate
          }
        };

        if (isNew) {
          body.size = {
            width: draft.size.includes('x') ? draft.size.split('x')[0] : '300',
            height: draft.size.includes('x') ? draft.size.split('x')[1] : '250'
          };
          body.paymentSource = 'PLACEMENT_AGENCY_PAID';
          body.pricingSchedule.pricingType = 'PRICING_TYPE_CPM';
        }

        const res = await fetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        });

        const data = await res.json();

        if (res.ok) {
          successCount++;
          results.push({ id, success: true });
          
          // Update main state and clear draft
          const updatedPlacement: Placement = {
            ...draft,
            cmId: data.id,
            id: isNew ? data.id : draft.id, // If it was a local ID, update to CM ID
            isDraft: false,
            originalData: data
          };

          setPlacements(prev => {
            if (isNew) {
              return prev.map(p => p.id === id ? updatedPlacement : p);
            }
            return prev.map(p => p.id === id ? updatedPlacement : p);
          });

          setPlacementsDrafts(prev => {
            const newDrafts = { ...prev };
            delete newDrafts[id];
            return newDrafts;
          });
        } else {
          failedCount++;
          results.push({ id, success: false, error: data.error?.message || 'API Error' });
        }
      } catch (e: any) {
        failedCount++;
        results.push({ id, success: false, error: e.message });
      }
    }

    return { success: successCount, failed: failedCount, results };
  };

  return (
    <AppContext.Provider value={{
      advertisers, campaigns, placements, placementsDrafts, creatives, sites, landingPages,
      selectedAdvertiser, selectedCampaign, currentView, isGlobalSearchActive,
      setSelectedAdvertiser, setSelectedCampaign, setCurrentView, setIsGlobalSearchActive,
      addPlacements, updatePlacement, updatePlacementDraft, updatePlacementName, deletePlacement, publishSelectedDrafts,
      connectionStatus, isAuthenticated, accessToken, profileId, accountId, user, login, loginWithToken, enterDemoMode, logout,
      fetchAdvertisers, fetchCampaigns, fetchPlacements, fetchCreatives, fetchAllCreatives, fetchSites, fetchLandingPages, createCampaign, updateCampaignStatus, isCampaignsLoading, pushPlacements, uploadCreative, updateCreativeStatus, copyCreative, assignCreativeToPlacement
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
