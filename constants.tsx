
import { Advertiser, Campaign, Site, Placement, Creative } from './types';

export const MOCK_ADVERTISERS: Advertiser[] = [
  { id: 'adv-1', name: 'Global Tech Corp' },
  { id: 'adv-2', name: 'Luxury Fashion Group' },
  { id: 'adv-3', name: 'Mainstream Beverages' },
  { id: 'adv-4', name: 'EcoTravel Solutions' },
  { id: 'adv-5', name: 'Fintech Wizards' },
];

export const MOCK_CAMPAIGNS: Campaign[] = [
  { id: 'camp-1', advertiserId: 'adv-1', name: 'Q4 Product Launch - Global', status: 'Active', startDate: '2024-10-01', endDate: '2024-12-31', budget: 500000, objective: 'Awareness', updatedAt: '2023-11-20' },
  { id: 'camp-2', advertiserId: 'adv-1', name: 'Retargeting Always-On', status: 'Active', startDate: '2024-01-01', endDate: '2024-12-31', budget: 200000, objective: 'Conversion', updatedAt: '2023-11-15' },
  { id: 'camp-3', advertiserId: 'adv-2', name: 'Spring Collection 2024', status: 'Draft', startDate: '2024-03-01', endDate: '2024-05-31', budget: 150000, objective: 'Consideration', updatedAt: '2023-11-18' },
];

export const MOCK_SITES: Site[] = [
  { id: 'site-1', name: 'YouTube', url: 'youtube.com' },
  { id: 'site-2', name: 'The New York Times', url: 'nytimes.com' },
  { id: 'site-3', name: 'Twitch', url: 'twitch.tv' },
  { id: 'site-4', name: 'Spotify', url: 'spotify.com' },
  { id: 'site-5', name: 'Hulu', url: 'hulu.com' },
];

export const MOCK_PLACEMENTS: Placement[] = [
  { id: 'plc-1', campaignId: 'camp-1', name: 'US_YT_PreRoll_15s_Tech_A', siteId: 'site-1', size: 'Video', type: 'Video', compatibility: 'IN_STREAM_VIDEO', status: 'Active', startDate: '2024-10-01', endDate: '2024-12-31', createdAt: '2023-09-15', updatedAt: '2023-09-15' },
  { id: 'plc-2', campaignId: 'camp-1', name: 'UK_NYT_Leaderboard_728x90', siteId: 'site-2', size: '728x90', type: 'Display', compatibility: 'DISPLAY', status: 'Active', startDate: '2024-10-01', endDate: '2024-12-31', createdAt: '2023-09-15', updatedAt: '2023-09-15' },
];

export const MOCK_CREATIVES: Creative[] = [
  { id: 'crt-1', name: 'Tech_Launch_Hero_728x90', type: 'HTML5', size: '728x90', status: 'Active', thumbnailUrl: 'https://picsum.photos/seed/ad1/200/200', placementIds: ['plc-2'] },
  { id: 'crt-2', name: 'Launch_Video_15s_FullHD', type: 'Video', size: '1920x1080', status: 'Active', thumbnailUrl: 'https://picsum.photos/seed/ad2/200/200', placementIds: ['plc-1'] },
];

export const NAMING_TOKENS = [
  'Country', 'Brand', 'Funnel', 'Channel', 'Device', 'Format', 'Size', 'Site', 'CampaignShort', 'DateRange'
];

export const CM360_SIZES = {
  Display: [
    '300x250', '728x90', '160x600', '300x600', '320x50', '300x50', '970x250', '970x90', '336x280', '468x60', '120x600', '250x250', '200x200', '120x240', '180x150', '125x125'
  ],
  Video: [
    '1920x1080', '1280x720', '640x480', 'Video/VPAID'
  ],
  Native: [
    'Native', 'Flexible'
  ]
};

export const PLACEMENT_STRATEGIES = [
  'Standard', 'Premium', 'Direct', 'Programmatic', 'Social', 'Search'
];

export const NAMING_TAXONOMY = {
  ISO: ['ar', 'be', 'br', 'ch', 'cl', 'co', 'de', 'do', 'ec', 'es', 'fr', 'gb', 'it', 'mx', 'nl', 'pa', 'pe', 'pt', 'py', 'us', 'uy', 'bo'],
  Campañas: ['ttf-ene', 'ttf-abr', 'ttf-sep', 'bf', 'ao', 'promperu', 'panama', 'business', 'turista', 'ref-latam', 'ref-francia', 'dreamliners', 'cyber-days', 'holiday', 'raices-latam', 'honduras', 'rep-dominicana', 'brand-awareness', 'ip-latam'],
  Canales: ['dis', 'nat', 'vid', 'dooh', 'ctv', 'aud', 'netflix', 'disney', 'prime', 'email', 'youtube'],
  Sites: ['kpi360', 'alkimiads', 'elpais', 'as', 'eldiario', 'okdiario', 'eleconomista', 'edatv', 'larazon', 'prensaiberica', 'eldebate', 'vidoomy', 'prisa', 'wemass', '20minutos', 'clarin', 'elcronista', 'forbes', 'tapas', 'veepee', 'mediaset', 'ctv-premium', 'sport', 'abc', 'elespañol', 'elmundo'],
  Funnel: ['prs', 'rtg', 'bd-home', 'bd-anot', 'bw', 'ron', 'ros', 'deal'],
  Device: ['desktop', 'mobile', 'all'],
  Tech: ['dv360', 'dv360-prem', 'quantcast', 'taboola', 'outbrain', 'stackadapt', 'ttd', 'amazon', 'directo', 'microsoft', 'mediasmart', 'addor'],
  Formats: ['gen', 'rich', 'dyn', 'vid']
};

export const CM360_ERROR_MAPPING: Record<string, { title: string, description: string }> = {
  '100012': {
    title: 'Conflicto de Tipo y Rol',
    description: 'El tipo de archivo no coincide con la función asignada. Se ha corregido la nomenclatura interna de "HTML" para evitar este conflicto en archivos de imagen y banners.'
  },
  '100008': {
    title: 'Nombre Duplicado',
    description: 'Ya existe una creatividad con este nombre en este anunciante. Cambia el nombre base.'
  },
  '100013': {
    title: 'Dimensiones Incorrectas',
    description: 'El tamaño del archivo no coincide con las dimensiones especificadas en la configuración.'
  },
  '100005': {
    title: 'Permiso Denegado',
    description: 'Tu perfil de CM360 no tiene permisos de escritura o el anunciante está bloqueado.'
  },
  '401': {
    title: 'Sesión Expirada',
    description: 'Tu token de acceso ha caducado. Por favor, cierra sesión y vuelve a entrar.'
  },
  '403': {
    title: 'Acceso Prohibido',
    description: 'No tienes los scopes necesarios o la API de CM360 no está habilitada en tu proyecto.'
  },
  'Network error': {
    title: 'Error de Red',
    description: 'No se pudo contactar con los servidores de Google. Revisa tu conexión.'
  },
  'default': {
    title: 'Error Desconocido',
    description: 'Ha ocurrido un problema inesperado en la API de Campaign Manager.'
  }
};
