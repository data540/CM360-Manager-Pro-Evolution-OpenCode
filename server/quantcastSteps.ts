// Quantcast native creative steps on an already open Playwright page. Shared by the local runner
// (user's Chrome) and the cloud runner (Browserbase), so both follow the same validated flow.
// Selectors come from a codegen recording plus read-only probes of the Quantcast UI.

import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright-core';
import { findQuantcastCreativeIds, getQuantcastNativeCreative } from '../api/_quantcast';
import { CHANGE_LABELS, diffNative } from '../services/quantcastNative';
import type { NativeAssignmentJob, NativeCreativeJob, NativeUpdateJob, QcLanguage } from '../services/quantcastNative';

export const MANAGER = 'https://www.quantcast.com/ads/manager/accounts';
export const CREATIVES = 'https://www.quantcast.com/ads/creatives/accounts';
export const STEP_TIMEOUT_MS = 30_000;
const CONFIRM_TIMEOUT_MS = 60_000;

export const isLoginUrl = (url: string) => /\/user\/login/.test(url);

const assertLoggedIn = (page: Page) => {
  if (isLoginUrl(page.url())) throw new Error('La sesión de Quantcast ha caducado: vuelve a iniciar sesión y relanza.');
};

export const safeName = (name: string) => name.replace(/[^\w.-]+/g, '_').slice(0, 120);

const downloadDriveImage = async (driveToken: string, fileId: string, target: string) => {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${driveToken}` } });
  if (!res.ok) throw new Error(`No se pudo descargar la imagen de Drive (HTTP ${res.status}).`);
  fs.writeFileSync(target, Buffer.from(await res.arrayBuffer()));
};

// --- Popups ---------------------------------------------------------------------------------

// Wording of feedback/survey popups only: must not match the native form or the ad set editor.
const FEEDBACK_TEXT = /feedback|survey|how likely|how would you rate|tell us what you think|share your thoughts|rate your experience/i;
const CLOSE_NAME = /^(close|dismiss|no,? thanks|not now|skip|maybe later|×|✕|x)$/i;
const SURVEY_IFRAME = 'iframe[title*="feedback" i], iframe[title*="survey" i], iframe[id*="survey" i], iframe[src*="survey" i], iframe[src*="feedback" i]';

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
export const installPopupGuards = async (page: Page, onClosed: () => void) => {
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

  await page.addLocatorHandler(page.locator(SURVEY_IFRAME).first(), async (popup) => {
    if (!(await closeWithin(page.frameLocator(SURVEY_IFRAME).first()))) await page.keyboard.press('Escape');
    if (await popup.isVisible().catch(() => false)) await popup.evaluate((el) => { (el as HTMLElement).style.display = 'none'; });
    onClosed();
  }, { noWaitAfter: true });
};

// --- Form helpers ---------------------------------------------------------------------------

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

const waitForCreative = async (accountId: string, name: string): Promise<string> => {
  const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
  for (;;) {
    const ids = await findQuantcastCreativeIds(accountId, name).catch(() => []);
    if (ids.length) return ids[ids.length - 1];
    if (Date.now() > deadline) throw new Error('Quantcast cerró el formulario pero la creatividad no aparece creada tras 60 s.');
    await new Promise((r) => setTimeout(r, 2_000));
  }
};

// --- Steps ----------------------------------------------------------------------------------

/**
 * Uploads one native creative unless one with that name already exists. Returns the log message.
 * The image is downloaded from Drive into `workDir` first.
 */
export const creativeStep = async (
  page: Page,
  accountId: string,
  job: NativeCreativeJob,
  driveToken: string,
  workDir: string,
  dryRun: boolean,
): Promise<string> => {
  const existing = await findQuantcastCreativeIds(accountId, job.name);
  if (existing.length) return `Ya existía (ID ${existing.join(', ')}): no se vuelve a subir, solo se asocia.`;

  fs.mkdirSync(workDir, { recursive: true });
  const imagePath = path.join(workDir, `${Date.now()}-${safeName(job.image.fileName)}`);
  await downloadDriveImage(driveToken, job.image.fileId, imagePath);

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

  if (dryRun) return 'Formulario rellenado (prueba: no se guarda).';
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  // The form closes on success; on validation errors it stays open.
  await nameInput.waitFor({ state: 'detached', timeout: 60_000 }).catch(async () => {
    const alerts = await page.locator('[role="alert"], [class*="error" i]').allInnerTexts().catch(() => []);
    throw new Error(`Quantcast no aceptó la creatividad${alerts.length ? `: ${alerts.join(' | ').slice(0, 300)}` : ' (el formulario sigue abierto).'}`);
  });
  // The form closes before the save finishes: navigating away right now would abort it (this lost
  // the last creative of every run). Stay on the page until the read API confirms it exists.
  return `Creatividad creada (ID ${await waitForCreative(accountId, job.name)}).`;
};

/** Edits an existing native creative (found by its ID in the library) and confirms the result via the API. */
export const updateStep = async (page: Page, accountId: string, job: NativeUpdateJob, dryRun: boolean): Promise<string> => {
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
      const pending = diffNative({
        title: c.title ?? '',
        description: c.description ?? '',
        advertiser: c.advertiser ?? '',
        landingUrl: c.landingUrl ?? '',
        impressionPixel: c.impressionPixel ?? '',
        language: c.language,
      }, { language: current.language, native: current.native || {} });
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
  const adSetCell = page.getByText(job.adSetName, { exact: true }).first();
  // Expand the campaign row to show its ad sets (chevron in the same row), unless already expanded.
  if (!(await adSetCell.isVisible().catch(() => false))) {
    await campaignCell.locator('xpath=ancestor::*[.//*[normalize-space(text())="chevron_right"]][1]')
      .getByText('chevron_right').first().click();
  }
  await adSetCell.waitFor({ timeout: STEP_TIMEOUT_MS });
  await adSetCell.click();
  // The side panel opens on whatever tab it likes (often "Analysis by Q"); "Edit Ad Set" lives in Details.
  await page.getByRole('tab', { name: 'Details', exact: true }).click();
  await page.getByRole('button', { name: /Edit Ad Set/ }).first().click();
  await page.getByTestId('form-field-creativeAssignments').waitFor({ timeout: STEP_TIMEOUT_MS });
};

/** Replaces (or adds to) the creatives of one ad set. */
export const assignStep = async (page: Page, accountId: string, job: NativeAssignmentJob, dryRun: boolean): Promise<string> => {
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
