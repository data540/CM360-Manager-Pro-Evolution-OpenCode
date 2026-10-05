// Read-only Display & Video 360 API access (v4) through the /api/dv360 proxy.
// The DV360 scope is requested on demand, separately from the CM360 login.

import { DvCreative, DvInsertionOrder, DvLineItem } from './traffickingAudit';

const DV360_SCOPE = 'https://www.googleapis.com/auth/display-video';
const TOKEN_STORAGE_KEY = 'dv360_token';
const ADVERTISER_MAP_KEY = 'dv360_advertiser_map';
// The API rejects `filter` values longer than 500 characters.
const MAX_FILTER_LENGTH = 480;

export class Dv360Error extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface Dv360Advertiser {
  advertiserId: string;
  partnerId: string;
  displayName: string;
  adServerConfig?: { cmHybridConfig?: { cmAdvertiserIds?: string[] } };
}

const readStoredToken = (): string | null => {
  try {
    const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!raw) return null;
    const { token, expiresAt } = JSON.parse(raw);
    return Date.now() < expiresAt ? token : null;
  } catch {
    return null;
  }
};

export const clearDv360Token = () => {
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
};

/** Returns a valid DV360 token, opening Google's consent popup only when there is none. */
export const getDv360Token = (clientId: string): Promise<string> => {
  const stored = readStoredToken();
  if (stored) return Promise.resolve(stored);

  return new Promise((resolve, reject) => {
    const oauth2 = (window as any).google?.accounts?.oauth2;
    if (!oauth2) {
      reject(new Error('Google Identity Services no está cargado. Recarga la página.'));
      return;
    }
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: DV360_SCOPE,
      callback: (response: any) => {
        if (response.error) {
          reject(new Error(`No se concedió acceso a DV360 (${response.error}).`));
          return;
        }
        const expiresAt = Date.now() + (Number(response.expires_in || 3600) - 60) * 1000;
        try {
          localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify({ token: response.access_token, expiresAt }));
        } catch {
          // ignore storage errors
        }
        resolve(response.access_token);
      },
      error_callback: (err: any) => reject(new Error(`Ventana de Google cerrada o bloqueada (${err?.type || 'error'}).`)),
    });
    client.requestAccessToken();
  });
};

const dvGet = async (token: string, path: string, params: Record<string, string> = {}) => {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`/api/dv360/${path}${qs ? `?${qs}` : ''}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) clearDv360Token();
    const detail = data?.error?.message || res.statusText;
    const hint = res.status === 403
      ? ' Comprueba que tu usuario tiene acceso a este anunciante en DV360.'
      : res.status === 401 ? ' La sesión de DV360 ha caducado: vuelve a ejecutar la revisión.' : '';
    throw new Dv360Error(res.status, `DV360 ${res.status}: ${detail}.${hint}`);
  }
  return data;
};

const listAll = async <T>(token: string, path: string, key: string, params: Record<string, string> = {}): Promise<T[]> => {
  const items: T[] = [];
  let pageToken: string | undefined;
  do {
    const data = await dvGet(token, path, { ...params, pageSize: '200', ...(pageToken ? { pageToken } : {}) });
    items.push(...(data[key] || []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return items;
};

/** Splits `field="a" OR field="b" …` into filters under the API length limit. */
const orFilters = (field: string, ids: string[], suffix = ''): string[] => {
  const budget = MAX_FILTER_LENGTH - suffix.length - 2;
  const groups: string[][] = [];
  let current: string[] = [];
  ids.forEach((id) => {
    const part = `${field}="${id}"`;
    if (current.length && [...current, part].join(' OR ').length > budget) {
      groups.push(current);
      current = [];
    }
    current.push(part);
  });
  if (current.length) groups.push(current);
  return groups.map((g) => (suffix ? `(${g.join(' OR ')})${suffix}` : g.join(' OR ')));
};

const readAdvertiserMap = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(ADVERTISER_MAP_KEY) || '{}');
  } catch {
    return {};
  }
};

export const rememberDv360Advertiser = (cmAdvertiserId: string, dvAdvertiserId: string) => {
  try {
    localStorage.setItem(ADVERTISER_MAP_KEY, JSON.stringify({ ...readAdvertiserMap(), [cmAdvertiserId]: dvAdvertiserId }));
  } catch {
    // ignore storage errors
  }
};

export const getRememberedDv360Advertiser = (cmAdvertiserId: string): string | undefined =>
  readAdvertiserMap()[cmAdvertiserId];

export const getDv360Advertiser = (token: string, advertiserId: string): Promise<Dv360Advertiser> =>
  dvGet(token, `advertisers/${advertiserId}`);

/**
 * Finds the DV360 advertisers linked to a CM360 advertiser through `cmHybridConfig.cmAdvertiserIds`,
 * scanning every partner the user can access.
 */
export const findLinkedDv360Advertisers = async (token: string, cmAdvertiserId: string): Promise<Dv360Advertiser[]> => {
  const partners = await listAll<{ partnerId: string }>(token, 'partners', 'partners');
  const linked: Dv360Advertiser[] = [];
  for (const partner of partners) {
    const advertisers = await listAll<Dv360Advertiser>(token, 'advertisers', 'advertisers', {
      partnerId: partner.partnerId,
      filter: 'entityStatus="ENTITY_STATUS_ACTIVE" OR entityStatus="ENTITY_STATUS_PAUSED"',
    });
    linked.push(...advertisers.filter((a) => a.adServerConfig?.cmHybridConfig?.cmAdvertiserIds?.includes(cmAdvertiserId)));
  }
  return linked;
};

export const listInsertionOrders = (token: string, advertiserId: string) =>
  listAll<DvInsertionOrder>(token, `advertisers/${advertiserId}/insertionOrders`, 'insertionOrders', {
    filter: 'entityStatus="ENTITY_STATUS_ACTIVE" OR entityStatus="ENTITY_STATUS_PAUSED" OR entityStatus="ENTITY_STATUS_DRAFT"',
  });

/** Display line items of the given insertion orders. */
export const listDisplayLineItems = async (token: string, advertiserId: string, insertionOrderIds: string[]) => {
  const lineItems: DvLineItem[] = [];
  for (const filter of orFilters('insertionOrderId', insertionOrderIds, ' AND lineItemType="LINE_ITEM_TYPE_DISPLAY_DEFAULT"')) {
    lineItems.push(...await listAll<DvLineItem>(token, `advertisers/${advertiserId}/lineItems`, 'lineItems', { filter }));
  }
  return lineItems;
};

export const listCreativesByIds = async (token: string, advertiserId: string, creativeIds: string[]) => {
  const creatives: DvCreative[] = [];
  for (const filter of orFilters('creativeId', creativeIds)) {
    creatives.push(...await listAll<DvCreative>(token, `advertisers/${advertiserId}/creatives`, 'creatives', { filter }));
  }
  return creatives;
};
