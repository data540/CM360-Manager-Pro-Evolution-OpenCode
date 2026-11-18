// Finds the market (country) inside a free-text name of the client's tracking files, e.g.
//   BF_Nov26_CO_ES            → CO   (country + language)
//   BlackFriday_2026-BEL_EN   → BE   (3-letter abbreviation + language)
//   BlackFriday_2026-SUI-EN   → CH   (Spanish abbreviation: SUIza)
//   BlackFriday_2026-USA-EN   → US
//   TimeToFly_20250421        → none (not tied to a country)
//
// A token is a country when it is, for one single market: its 2-letter code, an ISO 3166 alpha-3
// code, the first 3 letters of one of its names (Spanish or English, e.g. HOL→Holanda), or a
// full name. Abbreviations that could mean two markets are not used. When the name ends in
// "<country> <language>", the token before the language wins; otherwise the last country token.

import { MARKETS, normalizeLabel, type Market } from './markets';

/** Language suffixes seen in the client's names (`_EN`, `-ES`…). Some are also country codes. */
const LANGUAGES = new Set(['EN', 'ES', 'PT', 'FR', 'IT', 'DE', 'NL', 'CA', 'EU', 'GL', 'BR']);

/** ISO 3166-1 alpha-3 and other usual abbreviations that are not a prefix of the names. */
const EXTRA_CODES: Record<string, string> = {
  CHE: 'CH', SWI: 'CH', DEU: 'DE', GER: 'DE', DOM: 'DO', ESP: 'ES', NLD: 'NL', PRT: 'PT',
  PRY: 'PY', SLV: 'SV', GBR: 'UK', GB: 'UK', ENG: 'UK', URY: 'UY', ZAF: 'ZA', RSA: 'ZA',
  EEUU: 'US', USA: 'US', RD: 'DO',
};

const compact = (value: string) => normalizeLabel(value).replace(/ /g, '').toUpperCase();

const buildIndex = (markets: Market[]) => {
  const exact = new Map<string, string>();
  const prefixes = new Map<string, Set<string>>();
  markets.forEach((m) => {
    exact.set(m.code, m.code);
    m.aliases.forEach((alias) => {
      const name = compact(alias);
      if (name.length > 2) exact.set(name, m.code);
      // Spanish / English abbreviation: first 3 letters of each word of the name (BEL, HOL, SUI…).
      normalizeLabel(alias).split(' ').filter((w) => w.length >= 4).forEach((word) => {
        const prefix = word.slice(0, 3).toUpperCase();
        prefixes.set(prefix, new Set([...(prefixes.get(prefix) || []), m.code]));
      });
    });
  });
  Object.entries(EXTRA_CODES).forEach(([code, market]) => {
    if (markets.some((m) => m.code === market)) exact.set(code, market);
  });
  return { exact, prefixes };
};

const INDEX = buildIndex(MARKETS);

/** The market code a single token stands for, if it is unambiguous. */
export const marketOfToken = (token: string): string | undefined => {
  const t = compact(token);
  if (!t || /^\d+$/.test(t)) return undefined;
  const exact = INDEX.exact.get(t);
  if (exact) return exact;
  if (t.length === 3) {
    const candidates = INDEX.prefixes.get(t);
    if (candidates?.size === 1) return [...candidates][0];
  }
  return undefined;
};

/** Words of a name, split on `_`, `-`, spaces, dots… and on camelCase is not done on purpose. */
const tokensOf = (name: string) => (name || '').split(/[^A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ]+/).filter(Boolean);

export const resolveCountry = (name: string): string | undefined => {
  const tokens = tokensOf(name);
  if (!tokens.length) return undefined;
  // "<country> <language>" at the end: BF_Nov26_CO_ES, …-BEL_EN, …_BR_BR.
  if (tokens.length >= 2) {
    const last = compact(tokens[tokens.length - 1]);
    const before = marketOfToken(tokens[tokens.length - 2]);
    if (before && (LANGUAGES.has(last) || marketOfToken(last))) return before;
  }
  // Otherwise the last token that is a country (a lone language code counts as its country).
  for (let i = tokens.length - 1; i >= 0; i--) {
    const market = marketOfToken(tokens[i]);
    if (market) return market;
  }
  return undefined;
};
