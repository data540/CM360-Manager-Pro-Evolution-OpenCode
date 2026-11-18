import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marketOfToken, resolveCountry } from './countryResolver';

test('names of the client tracking files resolve to their market', () => {
  const cases: Record<string, string | undefined> = {
    'BF_Nov26_CO_ES': 'CO', 'BF_Nov26_BR_BR': 'BR', 'BF_Nov26_MX_ES': 'MX', 'BF_Nov26_UY_ES': 'UY',
    'BlackFriday_2026-BEL_EN': 'BE', 'BlackFriday_2026-HOL_EN': 'NL', 'BlackFriday_2026-SUI-EN': 'CH', 'BlackFriday_2026-USA-EN': 'US',
    'BlackFriday_2026-ALE_DE': 'DE', 'BlackFriday_2026-POR_PT': 'PT', 'BlackFriday_2026-RD_ES': 'DO', 'BlackFriday_2026-UK_EN': 'UK',
    'Campaña Bélgica': 'BE', 'BF_Nov26_NL': 'NL',
    'TimeToFly_20250421': undefined, 'Black Friday': undefined,
  };
  for (const [name, expected] of Object.entries(cases)) assert.equal(resolveCountry(name), expected, name);
});

test('every folder country of the agency resolves, by 3-letter abbreviation and by name', () => {
  const folders: Record<string, string> = {
    ARG: 'AR', BRA: 'BR', COL: 'CO', ECU: 'EC', PAN: 'PA', PAR: 'PY', PER: 'PE', URU: 'UY', USA: 'US',
    ALE: 'DE', BEL: 'BE', FRA: 'FR', HOL: 'NL', ITA: 'IT', POR: 'PT', SUI: 'CH', UK: 'UK', RD: 'DO',
    Argentina: 'AR', Belgica: 'BE', Holanda: 'NL', Suiza: 'CH', Panama: 'PA', Peru: 'PE',
  };
  for (const [token, code] of Object.entries(folders)) assert.equal(marketOfToken(token), code, token);
});

test('ordinary words of campaign names are not taken as countries', () => {
  for (const token of ['BF', 'NOV', 'BLA', 'DIS', 'RON', 'NAT', 'VID', 'EN', '2026', 'Black', 'Friday', 'TimeToFly']) {
    assert.equal(marketOfToken(token), undefined, token);
  }
});
