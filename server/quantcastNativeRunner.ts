// Local-only browser automation for Quantcast native creatives (Quantcast has no write API).
// Drives the user's installed Chrome with a saved Quantcast session; selectors come from a
// Playwright codegen recording of the manual flow. Never logs in by itself: the login page has
// a reCAPTCHA, so the user logs in once in a visible window and the session is reused.

import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright';
import { findQuantcastCreativeIds, getQuantcastNativeCreative } from '../api/_quantcast';
import { CHANGE_LABELS, diffNative } from '../services/quantcastNative';
import type {
  NativeAssignmentJob,
  NativeCreativeJob,
  NativeRunRequest,
  NativeUpdateJob,
  QcLanguage,
  RunState,
  RunStep,
} from '../services/quantcastNative';

const DIR = path.resolve('.quantcast');
const AUTH_FILE = path.join(DIR, 'auth.json');
const RUNS_DIR = path.join(DIR, 'runs');
const MANAGER = 'https://www.quantcast.com/ads/manager/accounts';
const CREATIVES = 'https://www.quantcast.com/ads/creatives/accounts';
const LOGIN_TIMEOUT_MS = 5 * 60_000;
const STEP_TIMEOUT_MS = 30_000;

let current: RunState | null = null;
let activeBrowser: Browser | null = null;
let stopRequested = false;

const loadPlaywright = async () => (await import('playwright')).chromium;

const launch = async () => {
  const chromium = await loadPlaywright();
  return chromium.launch({ channel: 'chrome', headless: false, slowMo: 120 });
};

export const hasSession = () => fs.existsSync(AUTH_FILE);
export const getRunState = () => current;
export const isRunning = () => current?.status === 'running';

const isLoginUrl = (url: string) => /\/user\/login/.test(url);

/** Opens a visible Chrome on Quantcast and waits until the user has logged in, then saves the session. */
export const loginInteractively = async (accountId: string): Promise<void> => {
  fs.mkdirSync(DIR, { recursive: true });
  const browser = await launch();
  try {
    const context = await browser.newContext(hasSession() ? { storageState: AUTH_FILE } : {});
    const page = await context.newPage();
    await page.goto(`${MANAGER}/${accountId}/campaigns`);
    await page.waitForURL((url) => url.pathname.startsWith('/ads/') && !isLoginUrl(url.href), { timeout: LOGIN_TIMEOUT_MS });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await context.storageState({ path: AUTH_FILE });
  } finally {
    await browser.close();
  }
};

const safeName = (name: string) => name.replace(/[^\w.-]+/g, '_').slice(0, 120);

export const screenshotPath = (runId: string, file: string): string | undefined => {
  if (!/^[\w-]+$/.test(runId) || !/^[\w.-]+\.png$/.test(file)) return undefined;
  const full = path.join(RUNS_DIR, runId, file);
  return fs.existsSync(full) ? full : undefined;
};

const downloadDriveImage = async (driveToken: string, fileId: string, target: string) => {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${driveToken}` } });
  if (!res.ok) throw new Error(`No se pudo descargar la imagen de Drive (HTTP ${res.status}).`);
  fs.writeFileSync(target, Buffer.from(await res.arrayBuffer()));
};

const assertLoggedIn = (page: Page) => {
  if (isLoginUrl(page.url())) throw new Error('La sesión de Quantcast ha caducado: pulsa «Iniciar sesión en Quantcast» y vuelve a lanzar.');
};

// --- Popups ---------------------------------------------------------------------------------

// Wording of feedback/survey popups only: must not match the native form or the ad set editor.
const FEEDBACK_TEXT = /feedback|survey|how likely|how would you rate|tell us what you think|share your thoughts|rate your experience/i;
const CLOSE_NAME = /^(close|dismiss|no,? thanks|not now|skip|maybe later|×|✕|x)$/i;

const closeWithin = async (scope: Page | ReturnType<Page['frameLocator']> | ReturnType<Page['locator']>) => {
  const close = scope.getByRole('button', { name: CLOSE_NAME })
    .or(scope.locator('[aria-label*="close" i], [aria-label*="dismiss" i], [class*="close" i]'))
    .first();
  if (await close.isVisible().catch(() => false)) {
    await close.click({ timeout: 3_000 }).catch(() => undefined);
    return true;
  }
  return false;
};

/** Closes Quantcast's feedback popup whenever it shows up, before the next action runs. */
const installPopupGuards = async (page: Page, onClosed: () => void) => {
  const modal = page.locator('[role="dialog"], [role="alertdialog"], .matter-modal-wrap, [class*="modal" i], [class*="survey" i], [id*="pendo" i]')
    .filter({ hasText: FEEDBACK_TEXT })
    .filter({ hasNot: page.getByPlaceholder('Please enter the name') })
    .filter({ hasNot: page.getByTestId('form-field-creativeAssignments') })
    .first();
  await page.addLocatorHandler(modal, async (popup) => {
    if (!(await closeWithin(popup))) await page.keyboard.press('Escape');
    if (await popup.isVisible().catch(() => false)) await popup.evaluate((el) => { (el as HTMLElement).style.display = 'none'; });
    onClosed();
  }, { noWaitAfter: true });

  const frame = page.locator('iframe[title*="feedback" i], iframe[title*="survey" i], iframe[id*="survey" i], iframe[src*="survey" i], iframe[src*="feedback" i]').first();
  await page.addLocatorHandler(frame, async (popup) => {
    const inner = page.frameLocator('iframe[title*="feedback" i], iframe[title*="survey" i], iframe[id*="survey" i], iframe[src*="survey" i], iframe[src*="feedback" i]').first();
    if (!(await closeWithin(inner))) await page.keyboard.press('Escape');
    if (await popup.isVisible().catch(() => false)) await popup.evaluate((el) => { (el as HTMLElement).style.display = 'none'; });
    onClosed();
  }, { noWaitAfter: true });
};

// --- Steps ----------------------------------------------------------------------------------

// The language dropdown is a non-searchable virtual list (rc-virtual-list): only ~12 options exist in
// the DOM at a time, so the wheel has to scroll the list holder (not the field, which also has
// title="English") until the wanted option is rendered.
const selectLanguage = async (page: Page, language: QcLanguage) => {
  const field = page.getByTestId('form-field-language').locator('.matter-select-selector');
  if (await field.count()) await field.first().click();
  else await page.locator('.matter-select-selection-item[title="English"]').first().click();
  const holder = page.locator('.matter-select-dropdown:not(.matter-select-dropdown-hidden) .rc-virtual-list-holder').first();
  const option = page.locator(`.matter-select-item-option[title="${language}"]`).first();
  await holder.hover();
  // The list opens scrolled to the current value, so the wanted one may be above or below it.
  for (const delta of [120, -120]) {
    for (let i = 0; i < 60 && !(await option.isVisible().catch(() => false)); i++) {
      await page.mouse.wheel(0, delta);
      await page.waitForTimeout(100);
    }
  }
  if (!(await option.isVisible().catch(() => false))) {
    throw new Error(`No encuentro «${language}» en el desplegable de idioma de Quantcast.`);
  }
  await option.click();
  await page.locator(`.matter-select-selection-item[title="${language}"]`).first().waitFor({ timeout: 5_000 }).catch(() => {
    throw new Error(`El idioma no quedó en «${language}».`);
  });
};

const uploadCreative = async (page: Page, accountId: string, job: NativeCreativeJob, imagePath: string, dryRun: boolean) => {
  await page.goto(`${CREATIVES}/${accountId}/creatives`);
  assertLoggedIn(page);
  await page.getByRole('button', { name: 'Upload Creatives' }).click();
  await page.getByText('Upload native creatives').click();

  const nameInput = page.getByPlaceholder('Please enter the name');
  await nameInput.fill(job.name);

  const imageField = page.getByTestId('form-field-native.mainImage');
  const fileInput = imageField.locator('input[type="file"]');
  if (await fileInput.count()) {
    await fileInput.first().setInputFiles(imagePath);
  } else {
    const chooser = page.waitForEvent('filechooser');
    await imageField.getByRole('button').first().click();
    await (await chooser).setFiles(imagePath);
  }

  await page.getByPlaceholder('Please enter the title').fill(job.title);
  await page.getByPlaceholder('Please enter the description').fill(job.description);
  await page.getByPlaceholder('Please enter the advertiser').fill(job.advertiser);
  await page.getByPlaceholder('https://www.example.com/mypage').fill(job.landingUrl);

  if (job.language !== 'English') await selectLanguage(page, job.language);

  await page.getByPlaceholder('Please enter an image pixel').fill(job.impressionPixel);

  if (dryRun) return undefined;
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  // The form closes on success; on validation errors it stays open.
  await nameInput.waitFor({ state: 'detached', timeout: 60_000 }).catch(async () => {
    const alerts = await page.locator('[role="alert"], [class*="error" i]').allInnerTexts().catch(() => []);
    throw new Error(`Quantcast no aceptó la creatividad${alerts.length ? `: ${alerts.join(' | ').slice(0, 300)}` : ' (el formulario sigue abierto).'}`);
  });
  // The form closes before the save finishes: navigating away right now would abort it (this lost
  // the last creative of every run). Stay on the page until the read API confirms it exists.
  return waitForCreative(accountId, job.name);
};

const CONFIRM_TIMEOUT_MS = 60_000;

const waitForCreative = async (accountId: string, name: string): Promise<string> => {
  const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
  for (;;) {
    const ids = await findQuantcastCreativeIds(accountId, name).catch(() => []);
    if (ids.length) return ids[ids.length - 1];
    if (Date.now() > deadline) throw new Error('Quantcast cerró el formulario pero la creatividad no aparece creada tras 60 s.');
    await new Promise((r) => setTimeout(r, 2_000));
  }
};

/** Edits an existing native creative (found by its ID in the library) and confirms the result via the API. */
const updateCreative = async (page: Page, accountId: string, job: NativeUpdateJob, dryRun: boolean) => {
  await page.goto(`${CREATIVES}/${accountId}/creatives`);
  assertLoggedIn(page);
  await page.getByPlaceholder('Search for a creative').fill(job.name);
  const idText = page.getByText(`Creative Id: ${job.creativeId}`, { exact: true });
  await idText.waitFor({ timeout: STEP_TIMEOUT_MS }).catch(() => {
    throw new Error(`No encuentro la creatividad ${job.creativeId} en la librería de Quantcast.`);
  });
  await idText.hover();
  await idText.locator('xpath=ancestor::*[.//*[normalize-space(text())="edit"]][1]').getByText('edit', { exact: true }).first().click();

  const titleField = page.getByPlaceholder('Please enter the title');
  await titleField.waitFor({ timeout: STEP_TIMEOUT_MS });
  const drawer = titleField.locator('xpath=ancestor::*[.//button[normalize-space(.)="Save"]][1]');
  const c = job.changes;
  if (c.title !== undefined) await titleField.fill(c.title);
  if (c.description !== undefined) await page.getByPlaceholder('Please enter the description').fill(c.description);
  if (c.advertiser !== undefined) await page.getByPlaceholder('Please enter the advertiser').fill(c.advertiser);
  if (c.landingUrl !== undefined) await page.getByPlaceholder('https://www.example.com/mypage').fill(c.landingUrl);
  if (c.language !== undefined) await selectLanguage(page, c.language);
  if (c.impressionPixel !== undefined) await page.getByPlaceholder('Please enter an image pixel').first().fill(c.impressionPixel);

  if (dryRun) {
    await drawer.getByRole('button', { name: 'Cancel', exact: true }).click().catch(() => undefined);
    return 'Campos cambiados en el formulario (prueba: se cancela sin guardar).';
  }
  await drawer.getByRole('button', { name: 'Save', exact: true }).click();
  await titleField.waitFor({ state: 'detached', timeout: 60_000 }).catch(async () => {
    const alerts = await page.locator('[role="alert"], [class*="error" i]').allInnerTexts().catch(() => []);
    throw new Error(`Quantcast no aceptó los cambios${alerts.length ? `: ${alerts.join(' | ').slice(0, 300)}` : ' (el formulario sigue abierto).'}`);
  });

  // Same reason as for uploads: the drawer closes before the save completes. Confirm against the API.
  const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
  for (;;) {
    const current = await getQuantcastNativeCreative(accountId, job.creativeId).catch(() => undefined);
    if (current) {
      const n = current.native || {};
      const pending = diffNative({
        title: c.title ?? '',
        description: c.description ?? '',
        advertiser: c.advertiser ?? '',
        landingUrl: c.landingUrl ?? '',
        impressionPixel: c.impressionPixel ?? '',
        language: c.language,
      }, { language: current.language, native: n });
      if (Object.keys(pending.changes).length === 0) return `${Object.keys(c).length} campo(s) actualizado(s) y confirmado(s).`;
      if (Date.now() > deadline) {
        throw new Error(`Guardado, pero Quantcast no refleja: ${Object.keys(pending.changes).map((k) => CHANGE_LABELS[k as keyof typeof CHANGE_LABELS]).join(', ')}.`);
      }
    } else if (Date.now() > deadline) {
      throw new Error('No se pudo comprobar el resultado en la API de Quantcast.');
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
};

const openAdSetEditor = async (page: Page, accountId: string, job: NativeAssignmentJob) => {
  await page.goto(`${MANAGER}/${accountId}/campaigns`);
  assertLoggedIn(page);
  await page.getByPlaceholder('Search Campaigns').fill(job.campaignName);
  const campaignCell = page.getByText(job.campaignName, { exact: true }).first();
  await campaignCell.waitFor({ timeout: STEP_TIMEOUT_MS });
  // Expand the campaign row to show its ad sets (chevron in the same row).
  await campaignCell.locator('xpath=ancestor::*[.//*[normalize-space(text())="chevron_right"]][1]')
    .getByText('chevron_right').first().click();
  const adSetCell = page.getByText(job.adSetName, { exact: true }).first();
  await adSetCell.waitFor({ timeout: STEP_TIMEOUT_MS });
  await adSetCell.click();
  // The side panel opens on whatever tab it likes (often "Analysis by Q"); "Edit Ad Set" lives in Details.
  await page.getByRole('tab', { name: 'Details', exact: true }).click();
  await page.getByRole('button', { name: /Edit Ad Set/ }).first().click();
  await page.getByTestId('form-field-creativeAssignments').waitFor({ timeout: STEP_TIMEOUT_MS });
};

const assignCreatives = async (page: Page, accountId: string, job: NativeAssignmentJob, dryRun: boolean) => {
  await openAdSetEditor(page, accountId, job);
  const assignments = page.getByTestId('form-field-creativeAssignments');
  const deleteButtons = assignments.getByRole('button', { name: 'delete' });
  const before = await deleteButtons.count();
  if (dryRun) return `Ad set abierto: ${before} creatividad(es) asignadas ahora${job.replace ? ', se sustituirían' : ''}.`;

  if (job.replace) {
    for (let guard = 0; (await deleteButtons.count()) > 0 && guard < 200; guard++) {
      await deleteButtons.first().click();
      await page.waitForTimeout(250);
    }
  }

  for (const name of job.creativeNames) {
    await page.getByRole('button', { name: 'add Creative' }).click();
    const search = page.getByPlaceholder('Search for a creative');
    const nameCell = page.getByText(name, { exact: true }).last();
    // A just-created creative can take a moment to reach the UI search index: search again before failing.
    let found = false;
    for (let attempt = 0; attempt < 6 && !found; attempt++) {
      await search.fill('');
      await search.fill(name);
      found = await nameCell.waitFor({ timeout: 15_000 }).then(() => true, () => false);
    }
    if (!found) throw new Error(`No aparece la creatividad «${name}» en el buscador de Quantcast (90 s).`);
    await nameCell.locator('xpath=ancestor::*[.//input[@type="checkbox"]][1]').locator('input[type="checkbox"]').first().check();
    await page.getByRole('button', { name: 'Attach' }).click();
  }

  await page.locator('[data-test="saveBtn"]').click();
  await assignments.waitFor({ state: 'detached', timeout: 60_000 }).catch(() => {
    throw new Error('El ad set no se guardó (el formulario sigue abierto).');
  });
  return `${job.replace ? `${before} quitada(s), ` : ''}${job.creativeNames.length} asociada(s).`;
};

// --- Run ------------------------------------------------------------------------------------

export const stopRun = async () => {
  stopRequested = true;
  await activeBrowser?.close().catch(() => undefined);
};

export const startRun = (request: NativeRunRequest): RunState => {
  if (isRunning()) throw new Error('Ya hay una ejecución en marcha.');
  if (!hasSession()) throw new Error('No hay sesión de Quantcast guardada: inicia sesión primero.');

  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(RUNS_DIR, runId);
  fs.mkdirSync(runDir, { recursive: true });
  const steps: RunStep[] = [
    ...request.creatives.map((c, i): RunStep => ({ id: `c${i}`, kind: 'creative', label: c.name, status: 'pending' })),
    ...(request.updates || []).map((u, i): RunStep => ({
      id: `u${i}`, kind: 'update', label: `${u.name} (ID ${u.creativeId})`, status: 'pending',
    })),
    ...request.assignments.map((a, i): RunStep => ({
      id: `a${i}`, kind: 'assignment', label: `${a.adSetName} ← ${a.creativeNames.length} creatividad(es)`, status: 'pending',
    })),
  ];
  current = { runId, status: 'running', dryRun: request.dryRun, steps };
  stopRequested = false;

  void (async () => {
    const state = current!;
    const set = (id: string, patch: Partial<RunStep>) => {
      state.steps = state.steps.map((s) => (s.id === id ? { ...s, ...patch } : s));
    };
    const failedCreatives = new Set<string>();
    let shot = 0;
    const capture = async (page: Page, label: string) => {
      const file = `${String(++shot).padStart(2, '0')}-${safeName(label)}.png`;
      await page.screenshot({ path: path.join(runDir, file), fullPage: true }).catch(() => undefined);
      return file;
    };

    try {
      activeBrowser = await launch();
      const context = await activeBrowser.newContext({ storageState: AUTH_FILE, viewport: { width: 1440, height: 900 } });
      context.setDefaultTimeout(STEP_TIMEOUT_MS);
      const page = await context.newPage();
      page.on('dialog', (d) => d.accept().catch(() => undefined));
      await installPopupGuards(page, () => {
        state.popupsClosed = (state.popupsClosed || 0) + 1;
      });

      for (const [i, job] of request.creatives.entries()) {
        if (stopRequested) break;
        const id = `c${i}`;
        set(id, { status: 'running', message: 'Comprobando si ya existe en Quantcast…' });
        try {
          const existing = await findQuantcastCreativeIds(request.accountId, job.name);
          if (existing.length) {
            set(id, { status: 'done', message: `Ya existía (ID ${existing.join(', ')}): no se vuelve a subir, solo se asocia.` });
            continue;
          }
          set(id, { message: 'Descargando imagen de Drive…' });
          const imagePath = path.join(runDir, `${i}-${safeName(job.image.fileName)}`);
          await downloadDriveImage(request.driveToken, job.image.fileId, imagePath);
          set(id, { message: 'Rellenando el formulario…' });
          if (!request.dryRun) set(id, { message: 'Guardando y esperando confirmación de Quantcast…' });
          const creativeId = await uploadCreative(page, request.accountId, job, imagePath, request.dryRun);
          set(id, {
            status: 'done',
            message: request.dryRun ? 'Formulario rellenado (prueba: no se guarda).' : `Creatividad creada (ID ${creativeId}).`,
            screenshot: await capture(page, job.name),
          });
        } catch (e: any) {
          failedCreatives.add(job.name);
          set(id, { status: 'error', message: e?.message || String(e), screenshot: await capture(page, `error-${job.name}`) });
        }
      }

      for (const [i, job] of (request.updates || []).entries()) {
        if (stopRequested) break;
        const id = `u${i}`;
        set(id, { status: 'running', message: request.dryRun ? 'Rellenando cambios…' : 'Editando y esperando confirmación de Quantcast…' });
        try {
          const message = await updateCreative(page, request.accountId, job, request.dryRun);
          set(id, { status: 'done', message, screenshot: await capture(page, `update-${job.name}`) });
        } catch (e: any) {
          set(id, { status: 'error', message: e?.message || String(e), screenshot: await capture(page, `error-update-${job.name}`) });
        }
      }

      for (const [i, job] of request.assignments.entries()) {
        if (stopRequested) break;
        const id = `a${i}`;
        const missing = job.creativeNames.filter((n) => failedCreatives.has(n));
        if (missing.length && !request.dryRun) {
          set(id, { status: 'skipped', message: `No se asocia: falló la subida de ${missing.length} creatividad(es).` });
          continue;
        }
        set(id, { status: 'running', message: 'Abriendo el ad set…' });
        try {
          const message = await assignCreatives(page, request.accountId, job, request.dryRun);
          set(id, { status: 'done', message, screenshot: await capture(page, job.adSetName) });
        } catch (e: any) {
          set(id, { status: 'error', message: e?.message || String(e), screenshot: await capture(page, `error-${job.adSetName}`) });
        }
      }

      await context.storageState({ path: AUTH_FILE }).catch(() => undefined);
      state.steps = state.steps.map((s) => (s.status === 'pending' ? { ...s, status: 'skipped', message: 'Detenido.' } : s));
      state.status = stopRequested ? 'stopped' : 'finished';
    } catch (e: any) {
      state.status = stopRequested ? 'stopped' : 'failed';
      state.error = stopRequested ? undefined : e?.message || String(e);
    } finally {
      await activeBrowser?.close().catch(() => undefined);
      activeBrowser = null;
    }
  })();

  return current;
};
