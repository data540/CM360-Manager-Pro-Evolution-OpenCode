import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strToU8, zipSync } from 'fflate';
import { countryFromName, parseTrackingXlsx, findTrackingRule, parseTrackingRows, placementMatchesSupport, readCsvRows, readXlsxRows } from './trackingSheet';
import { buildCompletePlan } from './trafficPlanComplete';
import { detectMarketFromFolder } from './markets';

const CODES = new Set(['BR', 'CO', 'PE', 'MX', 'UY', 'ES']);
const CLICK_CO = 'https://fxj6.aireuropa.com/dynclick/aireuropa/?ead-publisher=Alkimiads&ead-name=Alkimiads-BF_Nov26_CO_ES&eurl=https%3A%2F%2Fwww.aireuropa.com%2Fco%2Fes';

// Header block and rows as they come in the client template (; separated, quoted <img> tag).
const CSV = [
  'NOTAS PARA UN CORRECTO TRAFICADO EN DISPLAY;;;;;;;;;;;;;;;;;',
  'PARÁMETROS TÉCNICOS;;PARÁMETROS PARA REPORTING;;;;;;;;;;;TRACKINGS DE SEGUIMIENTO [PRIORITARIO];;;;',
  'Dominio de tracking;Sitio;Nombre de soporte;Nombre de campaña;Ubicación;Banner;Formato del banner;Nombre del segmento;Valor del segmento;URL de destino;Plan de medios;Android: ID Publicitario;Apple: ID Publicitario;URL de clic (por redirección);URL de impresión;;URL de clic (tracking por parámetros);',
  'ESCRIBIR_DOMINIO_TRACKING;ESCRIBIR_SITIO_WEB;NOMBRE_SOPORTE;NOMBRE_CAMPAÑA;NOMBRE_UBICACIÓN;NOMBRE_BANNER;FORMATO_BANNER;;;URL_DESTINO;;;;https://ESCRIBIR/dynclick;x;;y;',
  'fxj6.aireuropa.com;aireuropa;Alkimiads;BF_Nov26_BR_BR;RON;BF_Nov26_BR_BR;1x1;;;https://www.aireuropa.com/br/br;BF_Nov26;;;https://fxj6.aireuropa.com/dynclick/aireuropa/?ead-name=Alkimiads-BF_Nov26_BR_BR;"<img src=""https://fxj6.aireuropa.com/dynview/x"" />";;https://www.aireuropa.com/br/br?ead=1;',
  `fxj6.aireuropa.com;aireuropa;Alkimiads;BF_Nov26_CO_ES;RON;BF_Nov26_CO_ES;1x1;;;https://www.aireuropa.com/co/es;BF_Nov26;;;${CLICK_CO};"<img />";;x;`,
  ';;;;;;;;;;;;;URL NO VÁLIDA;URL NO VÁLIDA;;URL NO VÁLIDA;',
  ';;;;;realvalladolid;;;;;;;;URL NO VÁLIDA;URL NO VÁLIDA;;URL NO VÁLIDA;',
].join('\r\n');

test('country is the token before the language: BF_Nov26_CO_ES → CO, BF_Nov26_BR_BR → BR', () => {
  assert.equal(countryFromName('BF_Nov26_CO_ES', CODES), 'CO');
  assert.equal(countryFromName('BF_Nov26_BR_BR', CODES), 'BR');
  assert.equal(countryFromName('Campaña MX', CODES), 'MX');
  assert.equal(countryFromName('Black Friday', CODES), undefined);
});

test('CSV template: header found by name, placeholders and empty rows ignored', () => {
  const sheet = parseTrackingRows(readCsvRows(CSV), CODES);
  assert.deepEqual(sheet.rules.map((r) => [r.support, r.country, r.format]), [['Alkimiads', 'BR', '1x1'], ['Alkimiads', 'CO', '1x1']]);
  assert.equal(sheet.rules[1].clickUrl, CLICK_CO);
  assert.equal(sheet.skipped.length, 0);
});

test('xlsx: shared strings, formula cached values and sparse cells are read', () => {
  const sharedStrings = '<sst><si><t>Nombre de soporte</t></si><si><t>Nombre de campaña</t></si><si><r><t>URL de clic </t></r><r><t>(por redirección)</t></r></si>'
    + '<si><t>Alkimiads</t></si><si><t>BF_Nov26_PE_ES</t></si></sst>';
  const sheet = '<worksheet><sheetData>'
    + '<row r="3"><c r="C3" t="s"><v>0</v></c><c r="D3" t="s"><v>1</v></c><c r="N3" t="s"><v>2</v></c></row>'
    + '<row r="4"><c r="C4" t="s"><v>3</v></c><c r="D4" t="s"><v>4</v></c>'
    + '<c r="N4" t="str"><f>CONCAT(A4)</f><v>https://fxj6.aireuropa.com/dynclick/aireuropa/?a=1&amp;eurl=x</v></c></row>'
    + '</sheetData></worksheet>';
  const xlsx = zipSync({
    'xl/workbook.xml': strToU8('<workbook><sheets><sheet name="Display" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/sharedStrings.xml': strToU8(sharedStrings),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
  });
  const rows = readXlsxRows(xlsx);
  assert.equal(rows[3][2], 'Alkimiads');
  const parsed = parseTrackingRows(rows, CODES);
  assert.deepEqual(parsed.rules.map((r) => [r.support, r.country, r.clickUrl]), [
    ['Alkimiads', 'PE', 'https://fxj6.aireuropa.com/dynclick/aireuropa/?a=1&eurl=x'],
  ]);
});

test('placements belong to the support by a name token or by their CM360 site', () => {
  assert.ok(placementMatchesSupport('ae-co_kpi360_bf_2026_dis_prs_alkimiads_desktop_gen_300x250_1', undefined, 'Alkimiads'));
  assert.ok(placementMatchesSupport('ae-co_kpi360_bf_2026_dis_prs_ron_desktop_gen_300x250_1', 'ALKIMIADS', 'Alkimiads'));
  // Must be named exactly the same: no partial matches.
  assert.ok(!placementMatchesSupport('ae-co_kpi360_bf_2026_dis_prs_ron_desktop_gen_300x250_1', 'Alkimiads Network', 'Alkimiads'));
  assert.ok(!placementMatchesSupport('ae-co_kpi360_bf_2026_dis_prs_alkimi_desktop_gen_300x250_1', undefined, 'Alkimiads'));
  assert.ok(!placementMatchesSupport('ae-co_kpi360_bf_2026_dis_prs_dv360_desktop_gen_300x250_1', 'DV360', 'Alkimiads'));
  const rules = parseTrackingRows(readCsvRows(CSV), CODES).rules;
  assert.equal(findTrackingRule(rules, 'CO', { name: 'x_alkimiads_300x250', size: '300x250' })?.clickUrl, CLICK_CO);
  assert.equal(findTrackingRule(rules, 'PE', { name: 'x_alkimiads_300x250', size: '300x250' }), undefined);
});

test('complete plan: Ads of the support get the tracking URL; untouched Ads only change their landing', () => {
  const rules = parseTrackingRows(readCsvRows(CSV), CODES).rules;
  const placement = (id: string, name: string) => ({ id, name, siteId: 's1', size: '300x250', compatibility: 'DISPLAY', active: true });
  const P_ALK = placement('p1', 'ae-co_kpi360_bf_2026_dis_prs_alkimiads_desktop_gen_300x250_1');
  const P_DV = placement('p2', 'ae-co_kpi360_bf_2026_dis_prs_dv360_desktop_gen_300x250_2');
  const P_ALK_OLD = { ...placement('p3', 'ae-co_kpi360_bf_2026_dis_prs_alkimiads_mobile_gen_320x50_3'), size: '320x50' };
  const file = { id: 'f1', fileName: 'bf_300x250.jpg', relativePath: 'Colombia/bf_300x250.jpg', bytes: 1, kind: 'image' as const, size: '300x250', sizeSource: 'name' as const, sizeMismatch: false };
  const plan = buildCompletePlan({
    campaign: { id: 'c1', name: 'ae-co_kpi360_bf_dis' },
    folderMarket: detectMarketFromFolder('Colombia'),
    files: [file],
    placements: [P_ALK, P_DV, P_ALK_OLD],
    ads: [{ id: 'a3', name: 'ad_old', isDefault: false, active: true, placementIds: ['p3'] }],
    sites: [],
    options: {
      prefix: '', suffix: '', includeDate: false, uploadDate: new Date(),
      setAsDefault: true, createMissingDefaultAds: true, defaultMode: 'replace', standardMode: 'add', trackingRules: rules,
    },
  });
  const std = (placementId: string) => plan.actions.find((a) => !a.isDefault && a.placementIds.includes(placementId));
  assert.equal(std('p1')?.clickUrl, CLICK_CO);
  assert.equal(std('p2')?.clickUrl, undefined);
  assert.deepEqual([std('p3')?.kind, std('p3')?.clickUrl, std('p3')?.fileIds.length], ['landing', CLICK_CO, 0]);
  assert.ok(plan.actions.filter((a) => a.isDefault).every((a) => !a.clickUrl), 'Default Ads keep their own landing rule');
});

test('a support named differently from CM360 is an error, with the closest name as a hint', () => {
  const rules = parseTrackingRows(readCsvRows(CSV), CODES).rules;
  const file = { id: 'f1', fileName: 'bf_300x250.jpg', relativePath: 'Colombia/bf_300x250.jpg', bytes: 1, kind: 'image' as const, size: '300x250', sizeSource: 'name' as const, sizeMismatch: false };
  const build = (placementName: string) => buildCompletePlan({
    campaign: { id: 'c1', name: 'ae-co_kpi360_bf_dis' },
    folderMarket: detectMarketFromFolder('Colombia'),
    files: [file],
    placements: [{ id: 'p1', name: placementName, siteId: 's1', size: '300x250', compatibility: 'DISPLAY', active: true }],
    ads: [],
    sites: [],
    options: {
      prefix: '', suffix: '', includeDate: false, uploadDate: new Date(),
      setAsDefault: false, createMissingDefaultAds: false, defaultMode: 'replace', standardMode: 'add', trackingRules: rules,
    },
  });
  const similar = build('ae-co_kpi360_bf_2026_dis_prs_alkimi_desktop_gen_300x250_1');
  const error = similar.issues.find((i) => i.code === 'tracking_support_mismatch');
  assert.equal(error?.severity, 'error');
  assert.match(error!.message, /«Alkimiads» no se llama igual que en CM360 \(«alkimi»\)/);
  assert.equal(similar.actions[0].clickUrl, undefined, 'its URL is not applied');
  assert.equal(similar.blocked, false, 'the rest of the plan can still run');

  const none = build('ae-co_kpi360_bf_2026_dis_prs_dv360_desktop_gen_300x250_1');
  assert.match(none.issues.find((i) => i.code === 'tracking_support_mismatch')!.message, /ningún placement de la campaña es del soporte «Alkimiads»/);

  const ok = build('ae-co_kpi360_bf_2026_dis_prs_alkimiads_desktop_gen_300x250_1');
  assert.ok(!ok.issues.some((i) => i.code === 'tracking_support_mismatch'));
});

test('xlsx with hidden template sheets first: the visible sheet with data is used', () => {
  const hiddenTemplate = '<worksheet><sheetData><row r="1"><c r="C1" t="inlineStr"><is><t>Nombre de soporte</t></is></c>'
    + '<c r="N1" t="inlineStr"><is><t>URL de clic (por redirección)</t></is></c></row>'
    + '<row r="2"><c r="C2" t="inlineStr"><is><t>NOMBRE_SOPORTE</t></is></c></row></sheetData></worksheet>';
  const real = '<worksheet><sheetData>'
    + '<row r="18"><c r="C18" t="inlineStr"><is><t>Nombre de soporte</t></is></c><c r="D18" t="inlineStr"><is><t>Nombre de campaña</t></is></c>'
    + '<c r="N18" t="inlineStr"><is><t>URL de clic (por redirección)</t></is></c></row>'
    + '<row r="19" spans="1:17"/>'
    + '<row r="20"><c r="C20" t="inlineStr"><is><t>Alkimiads</t></is></c><c r="D20" t="inlineStr"><is><t>BF_Nov26_MX_ES</t></is></c>'
    + '<c r="N20" t="str"><f>A1</f><v>https://fxj6.aireuropa.com/dynclick/aireuropa/?x=1</v></c></row>'
    + '</sheetData></worksheet>';
  const xlsx = zipSync({
    'xl/workbook.xml': strToU8('<workbook><sheets><sheet name="Versión 4" sheetId="15" state="hidden" r:id="rId1"/>'
      + '<sheet name="Trafficking_BF_Nov26 Alkimiads" sheetId="1" r:id="rId2"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/>'
      + '<Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': strToU8(hiddenTemplate),
    'xl/worksheets/sheet2.xml': strToU8(real),
  });
  const parsed = parseTrackingXlsx(xlsx, CODES);
  assert.equal(parsed.sheetName, 'Trafficking_BF_Nov26 Alkimiads');
  assert.deepEqual(parsed.rules.map((r) => [r.row, r.support, r.country]), [[20, 'Alkimiads', 'MX']]);
});

test('several files (one per support): rules keep their file, same row numbers do not collide, conflicts are flagged', async () => {
  const { mergeTrackingFiles, withSource, ruleKey, describeRule } = await import('./trackingSheet');
  const csv = (support: string, country: string, url: string) => [
    'Nombre de soporte;Nombre de campaña;x;x;x;x;x;x;x;x;x;x;URL de clic (por redirección)',
    `${support};BF_Nov26_${country}_ES;;;;;;;;;;;${url}`,
  ].join('\n');
  const alk = withSource('Alkimiads.xlsx', parseTrackingRows(readCsvRows(csv('Alkimiads', 'CO', 'https://a.example/1')), CODES));
  const conf = withSource('ElConfidencial.xlsx', parseTrackingRows(readCsvRows(csv('elconfidencial', 'CO', 'https://e.example/1')), CODES));
  const dup = withSource('Alkimiads_v2.xlsx', parseTrackingRows(readCsvRows(csv('Alkimiads', 'CO', 'https://a.example/2')), CODES));

  const merged = mergeTrackingFiles([{ fileName: 'Alkimiads.xlsx', sheet: alk }, { fileName: 'ElConfidencial.xlsx', sheet: conf }]);
  assert.equal(merged.rules.length, 2);
  assert.notEqual(ruleKey(merged.rules[0]), ruleKey(merged.rules[1]), 'same row in two files → different keys');
  assert.equal(describeRule(merged.rules[1]), 'ElConfidencial.xlsx · fila 2');
  assert.deepEqual(merged.conflicts, []);
  assert.equal(findTrackingRule(merged.rules, 'CO', { name: 'ae-co_x_elconfidencial_300x250' })?.clickUrl, 'https://e.example/1');

  const withDup = mergeTrackingFiles([{ fileName: 'Alkimiads.xlsx', sheet: alk }, { fileName: 'Alkimiads_v2.xlsx', sheet: dup }]);
  assert.equal(withDup.conflicts.length, 1);
  assert.match(withDup.conflicts[0], /Alkimiads CO.*Alkimiads\.xlsx · fila 2 y Alkimiads_v2\.xlsx · fila 2/);
  assert.equal(findTrackingRule(withDup.rules, 'CO', { name: 'x_alkimiads_300x250' })?.clickUrl, 'https://a.example/1', 'first file wins');
});

test('tracking spreadsheets in the Drive folder are kept apart from the creatives', async () => {
  const { groupDriveFiles } = await import('./driveFolders');
  const entry = (name: string, path: string[], mimeType = 'image/png') => ({ id: name, name, mimeType, path, bytes: 10 });
  const result = groupDriveFiles('BF Nov26', [
    entry('Colombia', [], 'application/vnd.google-apps.folder'),
    entry('banner_300x250.png', ['Colombia']),
    entry('Trafficking_BF_Nov26 Alkimiads.xlsx', ['Colombia'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    entry('Tracking El Confidencial', [], 'application/vnd.google-apps.spreadsheet'),
  ] as any);
  assert.deepEqual(result.trackingFiles.map((f) => f.name), ['Trafficking_BF_Nov26 Alkimiads.xlsx', 'Tracking El Confidencial']);
  assert.deepEqual(result.groups.flatMap((g) => g.files.map((f) => f.fileName)), ['banner_300x250.png']);
});
