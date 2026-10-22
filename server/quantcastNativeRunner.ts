// Local-only browser automation for Quantcast native creatives (Quantcast has no write API).
// Drives the user's installed Chrome with a saved Quantcast session. Never logs in by itself: the
// login page has a reCAPTCHA, so the user logs in once in a visible window and the session is reused.
// The steps themselves live in quantcastSteps.ts (shared with the Browserbase cloud runner).

import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright';
import type { NativeRunRequest, RunState, RunStep } from '../services/quantcastNative';
import { assignStep, creativeStep, installPopupGuards, isLoginUrl, MANAGER, safeName, STEP_TIMEOUT_MS, updateStep } from './quantcastSteps';

const DIR = path.resolve('.quantcast');
const AUTH_FILE = path.join(DIR, 'auth.json');
const RUNS_DIR = path.join(DIR, 'runs');
const LOGIN_TIMEOUT_MS = 5 * 60_000;

let current: RunState | null = null;
let activeBrowser: Browser | null = null;
let stopRequested = false;

const launch = async () => {
  const { chromium } = await import('playwright');
  return chromium.launch({ channel: 'chrome', headless: false, slowMo: 120 });
};

export const hasSession = () => fs.existsSync(AUTH_FILE);
export const getRunState = () => current;
export const isRunning = () => current?.status === 'running';

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

export const screenshotPath = (runId: string, file: string): string | undefined => {
  if (!/^[\w-]+$/.test(runId) || !/^[\w.-]+\.png$/.test(file)) return undefined;
  const full = path.join(RUNS_DIR, runId, file);
  return fs.existsSync(full) ? full : undefined;
};

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
        set(id, { status: 'running', message: request.dryRun ? 'Rellenando el formulario…' : 'Subiendo y esperando confirmación de Quantcast…' });
        try {
          const message = await creativeStep(page, request.accountId, job, request.driveToken, runDir, request.dryRun);
          set(id, { status: 'done', message, screenshot: await capture(page, job.name) });
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
          const message = await updateStep(page, request.accountId, job, request.dryRun);
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
          const message = await assignStep(page, request.accountId, job, request.dryRun);
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
