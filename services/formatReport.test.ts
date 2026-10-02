import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strToU8, zipSync } from 'fflate';
import { countryFromCampaign, parseCsv, parseTrafficSheet, parseXlsx } from './trafficSheet';
import { buildFormatReport, matchSites, outletKey, type ReportAd } from './formatReport';
import type { PlanPlacement } from './trafficPlan';
import type { DetectedFile } from './creativeDetection';

// Excerpt of the real Eulerian template the user sent (Trafficking_TimeToFly_SEPT26_ConnectedTV.csv).
const CLICK = (site: string, tail = '') =>
  `https://fxj6.aireuropa.com/dynclick/aireuropa/?ead-publisher=${site}&eurl=https%3A%2F%2Fwww.aireuropa.com%2Fes%2Fes%2Faea%2Fofertas%2Ftime-to-fly.html%3Futm_source%3D${site}%26utm_campaign%3DTimetoFly_SEP26_ES-ES${tail}`;
const SAMPLE = [
  'NOTAS PARA UN CORRECTO TRAFICADO EN DISPLAY;;;;;;;;;;;;;;;;;',
  ';;;;;;;;;;;;;;;;;',
  'El nombre de campaña debe ser único por soporte;;;;;;;;;;;;;;;;;',
  'PARÁMETROS OBLIGATORIOS;;PARÁMETROS OPCIONALES;;;;;;;;;;;;;;;',
  'PARÁMETROS TÉCNICOS;;PARÁMETROS PARA REPORTING;;;;;;;;;;;TRACKINGS DE SEGUIMIENTO [PRIORITARIO];;;TRACKINGS DE SEGUIMIENTO [SECUNDARIO];',
  'Dominio de tracking;Sitio;Nombre de soporte;Nombre de campaña;Ubicación;Banner;Formato del banner;Nombre del segmento;Valor del segmento;URL de destino;Plan de medios;Android: ID Publicitario;Apple: ID Publicitario;URL de clic (por redirección);URL de impresión;;URL de clic (tracking por parámetros);',
  'ESCRIBIR_DOMINIO_TRACKING;ESCRIBIR_SITIO_WEB;NOMBRE_SOPORTE;NOMBRE_CAMPAÑA;NOMBRE_UBICACIÓN;NOMBRE_BANNER;FORMATO_BANNER;NOMBRE_SEGMENTO;VALOR_SEGMENTO;URL_DESTINO;NOMBRE_PLAN_MEDIOS;ADID;IDFA;https://x;"<img src=""https://x"" />";;URL_DESTINO?x;',
  `fxj6.aireuropa.com;aireuropa;CTV_Disney;TimetoFly_SEP26_ES-ES;ConectedTV;TimeToFly;1x1;;;https://www.aireuropa.com/es/es/aea/ofertas/time-to-fly.html?utm_source=CTV_Disney;TimeToFly;;;${CLICK('CTV_Disney')};"<img src=""https://fxj6.aireuropa.com/dynview/aireuropa/1x1.b"" />";;x;`,
  `fxj6.aireuropa.com;aireuropa;CTV_Netflix;TimetoFly_SEP26_ES-ES;ConectedTV;TimeToFly;1x1;;;https://www.aireuropa.com/es/es/aea/ofertas/time-to-fly.html?utm_source=CTV_Netflix ;TimeToFly;;;${CLICK('CTV_Netflix', '%20')};"<img src=""x"" />";;x;`,
  ';;;;;;;;;;;;;URL NO VÁLIDA;URL NO VÁLIDA;;URL NO VÁLIDA;',
  ';;;;;realvalladolid;;;;;;;;URL NO VÁLIDA;URL NO VÁLIDA;;URL NO VÁLIDA;',
  ';;;;;;;;;;;;;URL NO VÁLIDA;URL NO VÁLIDA;;URL NO VÁLIDA;',
].join('\r\n');

// --- sheet parsing --------------------------------------------------------------------------

test('the real template is read: header found below the notes, placeholders and empty rows skipped', () => {
  const { rows, errors } = parseTrafficSheet(parseCsv(SAMPLE));
  assert.deepEqual(errors, []);
  assert.deepEqual(rows.map((r) => [r.site, r.format, r.campaign, r.country]), [
    ['CTV_Disney', '1x1', 'TimetoFly_SEP26_ES-ES', 'ES'],
    ['CTV_Netflix', '1x1', 'TimetoFly_SEP26_ES-ES', 'ES'],
  ]);
  assert.match(rows[0].clickUrl, /^https:\/\/fxj6\.aireuropa\.com\/dynclick\//);
  assert.equal(rows[0].impressionTag, '<img src="https://fxj6.aireuropa.com/dynview/aireuropa/1x1.b" />');
  assert.equal(rows[0].rowNumber, 8);
});

test('trailing spaces in the landing and %20 in the click URL are reported', () => {
  const { rows } = parseTrafficSheet(parseCsv(SAMPLE));
  assert.deepEqual(rows[0].warnings, []);
  assert.equal(rows[1].landingUrl.endsWith(' '), false);
  assert.equal(rows[1].warnings.length, 2);
});

test('a file without the expected header is rejected with a clear error', () => {
  const { rows, errors } = parseTrafficSheet(parseCsv('a;b;c\n1;2;3'));
  assert.equal(rows.length, 0);
  assert.match(errors[0], /cabecera/);
});

test('country is taken from the campaign suffix', () => {
  assert.equal(countryFromCampaign('TimetoFly_SEP26_ES-ES'), 'ES');
  assert.equal(countryFromCampaign('DV360-Ruta_GVA-CH-EN'), 'CH');
  assert.equal(countryFromCampaign('TimetoFly_SEP26'), undefined);
});

test('xlsx with shared strings is read like the CSV', () => {
  const sheet = '<worksheet><sheetData>'
    + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>'
    + '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="inlineStr"><is><t>300x250</t></is></c><c r="C2" t="s"><v>3</v></c></row>'
    + '</sheetData></worksheet>';
  const strings = '<sst><si><t>Nombre de soporte</t></si><si><t>URL de clic (por redirección)</t></si><si><t>elpais</t></si><si><t>https://a.com/?x=1&amp;y=2</t></si></sst>';
  const xlsx = zipSync({ 'xl/worksheets/sheet1.xml': strToU8(sheet), 'xl/sharedStrings.xml': strToU8(strings) });
  const grid = parseXlsx(xlsx);
  assert.deepEqual(grid, [['Nombre de soporte', '', 'URL de clic (por redirección)'], ['elpais', '300x250', 'https://a.com/?x=1&y=2']]);
});

// --- report ---------------------------------------------------------------------------------

const placement = (id: string, siteId: string, siteName: string, size: string | undefined, extra: Partial<PlanPlacement> = {}): PlanPlacement => ({
  id, name: `p_${id}`, siteId, siteName, size, compatibility: 'DISPLAY', active: true, ...extra,
});
const ad = (id: string, placementIds: string[], creativeIds: string[] = ['c1']): ReportAd => ({ id, active: true, placementIds, creativeIds });
const file = (size: string, kind: DetectedFile['kind'] = 'html5'): DetectedFile => ({
  id: size, fileName: `${size}.zip`, relativePath: size, bytes: 1, kind, size, sizeSource: 'name', sizeMismatch: false,
});

const sheetRows = (...specs: [string, string][]) =>
  parseTrafficSheet([['Nombre de soporte', 'Formato del banner'], ...specs]).rows;

test('outlets match CM360 sites by meaningful words, ignoring channel prefixes', () => {
  const sites = [{ id: '1', name: 'Disney+' }, { id: '2', name: 'Netflix' }, { id: '3', name: 'El País' }];
  assert.deepEqual(matchSites('CTV_Disney', sites).map((s) => s.id), ['1']);
  assert.deepEqual(matchSites('elpais', sites).map((s) => s.id), ['3']);
  assert.deepEqual(matchSites('CTV_Samsung', sites), []);
});

test('each sheet row gets ok / no creative / placement missing / site not found', () => {
  const report = buildFormatReport({
    sheetRows: sheetRows(['elpais', '300x250'], ['elpais', '728x90'], ['elpais', '970x250'], ['CTV_Samsung', '1x1']),
    placements: [
      placement('p1', '3', 'El País', '300x250'),
      placement('p2', '3', 'El País', '728x90'),
    ],
    ads: [ad('a1', ['p1']), ad('a2', ['p2'], [])],
  });
  assert.deepEqual(report.rows.map((r) => r.status), ['ok', 'no_creative', 'placement_missing', 'site_not_found']);
  // These test rows carry no URLs, so each one also warns "fila sin URL".
  assert.deepEqual(report.counts, { site_not_found: 1, placement_missing: 1, no_creative: 1, ok: 1, missingInFolder: 0, rowWarnings: 4 });
});

test('1x1 rows (CTV) match video placements of the site', () => {
  const report = buildFormatReport({
    sheetRows: sheetRows(['CTV_Netflix', '1x1']),
    placements: [placement('v1', '2', 'Netflix', undefined, { compatibility: 'IN_STREAM_VIDEO' })],
    ads: [],
  });
  assert.deepEqual([report.rows[0].status, report.rows[0].placementIds], ['no_creative', ['v1']]);
});

test('1x1 rows also match real 1x1 display placements, since 1x1 is not always video', () => {
  const report = buildFormatReport({
    sheetRows: sheetRows(['CTV_Netflix', '1x1']),
    placements: [
      placement('v1', '2', 'Netflix', undefined, { compatibility: 'IN_STREAM_VIDEO' }),
      placement('d1', '2', 'Netflix', '1x1'),
      placement('d2', '2', 'Netflix', '300x250'),
    ],
    ads: [ad('a1', ['v1', 'd1'])],
    files: [file('1x1', 'image')],
  });
  assert.deepEqual([report.rows[0].status, report.rows[0].placementIds, report.rows[0].inFolder], ['ok', ['v1', 'd1'], true]);
});

test('placements of the campaign that the sheet does not ask for are listed; inactive ones are not', () => {
  const report = buildFormatReport({
    sheetRows: sheetRows(['elpais', '300x250']),
    placements: [
      placement('p1', '3', 'El País', '300x250'),
      placement('p2', '3', 'El País', '160x600'),
      placement('p3', '3', 'El País', '320x50', { active: false }),
    ],
    ads: [ad('a1', ['p1', 'p2'])],
  });
  assert.deepEqual(report.notInSheet.map((x) => [x.placement.id, x.hasCreative]), [['p2', true]]);
});

test('the folder tells which missing formats already have a creative ready', () => {
  const report = buildFormatReport({
    sheetRows: sheetRows(['elpais', '300x250'], ['elpais', '728x90'], ['CTV_Netflix', '1x1']),
    placements: [
      placement('p1', '3', 'El País', '300x250'),
      placement('p2', '3', 'El País', '728x90'),
      placement('v1', '2', 'Netflix', undefined, { compatibility: 'IN_STREAM_VIDEO' }),
    ],
    ads: [],
    files: [file('300x250'), file('1920x1080', 'video')],
  });
  assert.deepEqual(report.rows.map((r) => r.inFolder), [true, false, true]);
  assert.equal(report.counts.missingInFolder, 1);
});

test('ambiguous outlets can be resolved with a manual choice', () => {
  const placements = [placement('p1', '10', 'Disney+', '300x250'), placement('p2', '11', 'Disney Channel', '300x250')];
  const rows = sheetRows(['CTV_Disney', '300x250']);
  const ambiguous = buildFormatReport({ sheetRows: rows, placements, ads: [] });
  assert.equal(ambiguous.rows[0].status, 'site_not_found');
  assert.equal(ambiguous.rows[0].siteCandidates.length, 2);
  const resolved = buildFormatReport({ sheetRows: rows, placements, ads: [], siteOverrides: { [outletKey('CTV_Disney')]: '10' } });
  assert.deepEqual([resolved.rows[0].siteName, resolved.rows[0].status], ['Disney+', 'no_creative']);
});
