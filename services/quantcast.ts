// Read-only Quantcast access through the /api/quantcast/graphql proxy. The proxy holds the
// Quantcast API key/secret and the caller's existing Google (CM360) access token doubles as
// proof of identity: no separate Quantcast login or consent screen is needed.

export class QuantcastError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const PAGE_SIZE = 100;
const ACCOUNT_MAP_KEY = 'quantcast_account_map';

const readAccountMap = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(ACCOUNT_MAP_KEY) || '{}');
  } catch {
    return {};
  }
};

/** Remembers which Quantcast account ID corresponds to a CM360 advertiser (there is no API to discover it). */
export const rememberQuantcastAccount = (cmAdvertiserId: string, qcAccountId: string) => {
  try {
    localStorage.setItem(ACCOUNT_MAP_KEY, JSON.stringify({ ...readAccountMap(), [cmAdvertiserId]: qcAccountId }));
  } catch {
    // ignore storage errors
  }
};

export const getRememberedQuantcastAccount = (cmAdvertiserId: string): string | undefined =>
  readAccountMap()[cmAdvertiserId];

const gql = async (googleAccessToken: string, query: string, variables: Record<string, unknown> = {}) => {
  const res = await fetch('/api/quantcast/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${googleAccessToken}` },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload.errors) {
    const detail = payload?.error?.message || payload?.errors?.[0]?.message || res.statusText;
    throw new QuantcastError(res.status, `Quantcast: ${detail}`);
  }
  return payload.data;
};

export interface QcCampaignSummary {
  id: string;
  name: string;
  state: string;
}

export interface QcCampaignWithAdSets extends QcCampaignSummary {
  adsets: {
    id: string;
    name: string;
    state: string;
    creativeAssignments: {
      creativeId: string;
      targetingType: string;
      state: string;
      creative?: { id: string; name: string; type: string; display?: { adServerTag?: { html?: string } } };
    }[];
  }[];
}

/** All (non-deleted-in-UI) campaigns of a Quantcast account, paginated. */
export const listCampaigns = async (googleAccessToken: string, accountId: string): Promise<QcCampaignSummary[]> => {
  const query = `query($id: Long!, $offset: Int!) {
    accounts(filter: { id: { eq: $id } }) {
      edges {
        campaigns(limit: ${PAGE_SIZE}, offset: $offset) {
          pageInfo { hasMore }
          edges { id name state }
        }
      }
    }
  }`;
  const all: QcCampaignSummary[] = [];
  let offset = 0;
  for (;;) {
    const data = await gql(googleAccessToken, query, { id: Number(accountId), offset });
    const account = data?.accounts?.edges?.[0];
    if (!account) {
      throw new QuantcastError(404, `No se encontró la cuenta de Quantcast ${accountId} o no es accesible con esta credencial.`);
    }
    all.push(...account.campaigns.edges.map((c: any) => ({ id: String(c.id), name: c.name, state: c.state })));
    if (!account.campaigns.pageInfo.hasMore) break;
    offset += PAGE_SIZE;
  }
  return all;
};

/**
 * Ad sets and creative assignments of several Quantcast campaigns in one batched call.
 * Ad sets and assignments beyond the first 100 per parent are not fetched; `truncated` flags that.
 */
export const listAdSetsWithCreatives = async (
  googleAccessToken: string,
  campaignIds: string[],
): Promise<{ campaigns: QcCampaignWithAdSets[]; truncated: boolean }> => {
  if (campaignIds.length === 0) return { campaigns: [], truncated: false };
  const query = `query($ids: [Long!]!) {
    campaigns(filter: { id: { in: $ids } }) {
      edges {
        id name state
        adsets(limit: ${PAGE_SIZE}) {
          pageInfo { hasMore }
          edges {
            id name state
            creativeAssignments(limit: ${PAGE_SIZE}) {
              pageInfo { hasMore }
              edges {
                creativeId targetingType state
                creative { id name type display { adServerTag { html } } }
              }
            }
          }
        }
      }
    }
  }`;
  const data = await gql(googleAccessToken, query, { ids: campaignIds.map(Number) });
  let truncated = false;
  const campaigns: QcCampaignWithAdSets[] = (data?.campaigns?.edges || []).map((c: any) => {
    if (c.adsets.pageInfo.hasMore) truncated = true;
    return {
      id: String(c.id),
      name: c.name,
      state: c.state,
      adsets: (c.adsets?.edges || []).map((a: any) => {
        if (a.creativeAssignments.pageInfo.hasMore) truncated = true;
        return {
          id: String(a.id),
          name: a.name,
          state: a.state,
          creativeAssignments: (a.creativeAssignments?.edges || []).map((ca: any) => ({
            creativeId: String(ca.creativeId),
            targetingType: ca.targetingType,
            state: ca.state,
            creative: ca.creative ? {
              id: String(ca.creative.id),
              name: ca.creative.name,
              type: ca.creative.type,
              display: ca.creative.display,
            } : undefined,
          })),
        };
      }),
    };
  });
  return { campaigns, truncated };
};

/** Extracts the CM360 placement ID from a Quantcast ad-server-tag's `data-dcm-placement` attribute. */
export const extractCmPlacementId = (tagHtml: string | undefined): string | undefined => {
  if (!tagHtml) return undefined;
  const match = tagHtml.match(/data-dcm-placement=['"][^'"]*\/B\d+\.(\d+)['"]/);
  return match?.[1];
};
