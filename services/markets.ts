// Air Europa markets: each country is its own CM360 advertiser ("Air Europa XX") and its
// campaigns start with `ae-xx`. Folder names of the creatives are country names in Spanish,
// except a few abbreviations (RD, USA, UK), so each market lists the folder aliases it accepts.

export interface Market {
  code: string;
  advertiserId: string;
  advertiserName: string;
  /** First token of every campaign name of this market, e.g. `ae-ch`. */
  campaignPrefix: string;
  aliases: string[];
}

const market = (code: string, advertiserId: string, aliases: string[]): Market => ({
  code,
  advertiserId,
  advertiserName: `Air Europa ${code}`,
  campaignPrefix: `ae-${code.toLowerCase()}`,
  aliases: [code.toLowerCase(), ...aliases],
});

export const MARKETS: Market[] = [
  market('AR', '14022478', ['argentina']),
  market('BE', '13730638', ['belgica']),
  market('BO', '15371531', ['bolivia']),
  market('BR', '13731877', ['brasil', 'brazil']),
  market('CH', '13683980', ['suiza', 'switzerland']),
  market('CO', '13730659', ['colombia']),
  market('DE', '13730650', ['alemania', 'germany']),
  market('DO', '14063878', ['rd', 'republica dominicana', 'dominicana']),
  market('EC', '13731883', ['ecuador']),
  market('ES', '13731874', ['espana', 'spain']),
  market('FR', '13730641', ['francia', 'france']),
  market('IT', '13730647', ['italia', 'italy']),
  market('MX', '14052571', ['mexico']),
  market('NL', '13670859', ['holanda', 'paises bajos', 'netherlands']),
  market('PA', '14055241', ['panama']),
  market('PE', '13669923', ['peru']),
  market('PT', '13730656', ['portugal']),
  market('PY', '14676125', ['paraguay']),
  market('SV', '17593878', ['el salvador', 'salvador']),
  market('UK', '13731880', ['reino unido', 'united kingdom', 'gb']),
  market('US', '13737701', ['usa', 'eeuu', 'estados unidos']),
  market('UY', '13730653', ['uruguay']),
  market('ZA', '17502295', ['sudafrica', 'south africa']),
];

/** Lowercase, accents removed, `_`/`-` treated as spaces, collapsed whitespace. */
export const normalizeLabel = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Market of a creatives folder. The folder name must be the country (`Suiza`, `RD`, `España`),
 * optionally followed by more words (`Suiza octubre`); also accepts `Air Europa CH`.
 */
export const detectMarketFromFolder = (folderName: string): Market | undefined => {
  const name = normalizeLabel(folderName).replace(/^air europa /, '');
  return MARKETS.find((m) => m.aliases.some((alias) => name === alias || name.startsWith(`${alias} `)));
};

export const marketByAdvertiserId = (advertiserId: string): Market | undefined =>
  MARKETS.find((m) => m.advertiserId === String(advertiserId));

/** Market a campaign belongs to, from its `ae-xx` prefix. */
export const marketOfCampaign = (campaignName: string): Market | undefined => {
  const prefix = campaignName.trim().toLowerCase().split('_')[0];
  return MARKETS.find((m) => m.campaignPrefix === prefix);
};
