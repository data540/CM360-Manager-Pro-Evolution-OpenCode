// Word search for campaign names: every typed word must appear in the name, in any order,
// ignoring case, accents and the `-` / `_` separators of the naming convention
// ("black friday dis" finds `ae-es_kpi360_black-friday_dis`).

export interface SearchableCampaign {
  id: string;
  name: string;
  startDate?: string;
  endDate?: string;
}

export const normalizeForSearch = (value: string) =>
  (value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[_\-./]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Ended = its end date is before `today` (`YYYY-MM-DD`). */
export const campaignEnded = (c: SearchableCampaign, today: string) => !!c.endDate && c.endDate < today;

export const searchCampaigns = <T extends SearchableCampaign>(campaigns: T[], query: string, today: string): T[] => {
  const words = normalizeForSearch(query).split(' ').filter(Boolean);
  const matches = words.length
    ? campaigns.filter((c) => {
      const name = normalizeForSearch(c.name);
      const compact = name.replace(/ /g, '');
      // A word may also be typed without separators: "blackfriday".
      return words.every((w) => name.includes(w) || compact.includes(w));
    })
    : campaigns;
  // Running / upcoming campaigns first, ended ones last; alphabetical inside each group.
  return [...matches].sort((a, b) =>
    Number(campaignEnded(a, today)) - Number(campaignEnded(b, today)) || a.name.localeCompare(b.name));
};
