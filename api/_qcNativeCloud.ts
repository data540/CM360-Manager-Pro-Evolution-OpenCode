// Cloud runner for "Quantcast Nativa": drives a Browserbase remote Chrome so the team can upload and
// edit Quantcast native creatives from the Vercel app, watching (and taking over) through the live
// view. Works on the free plan, which has no keep-alive: a session ends as soon as our connection
// closes, so every step gets its own short session. The page first asks for a session ("open") to
// show its live view, then runs the step ("login" or "step") against it in a second call. Each user
// has a Browserbase Context (named after their email) that keeps their Quantcast login.

import os from 'node:os';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { HttpError, readRawBody, verifyCaller } from './_quantcast';
import { assignStep, creativeStep, installPopupGuards, isLoginUrl, MANAGER, STEP_TIMEOUT_MS, updateStep } from '../server/quantcastSteps';
import type { NativeAssignmentJob, NativeCreativeJob, NativeUpdateJob } from '../services/quantcastNative';

const BB_API = 'https://api.browserbase.com/v1';
// Free plan caps sessions at 15 minutes; one step needs far less.
const SESSION_TIMEOUT_S = 10 * 60;
// Stay under the 300 s function limit while waiting for the user to log in.
const LOGIN_WAIT_MS = 270_000;

const bbConfig = () => {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;
  if (!apiKey || !projectId) throw new HttpError(500, 'BROWSERBASE_API_KEY / BROWSERBASE_PROJECT_ID no están configuradas en el servidor.');
  return { apiKey, projectId };
};

const bb = async (pathName: string, init: { method?: string; body?: unknown } = {}) => {
  const { apiKey } = bbConfig();
  const res = await fetch(`${BB_API}${pathName}`, {
    method: init.method || 'GET',
    headers: { 'X-BB-API-Key': apiKey, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(502, `Browserbase ${res.status}: ${data?.message || data?.error || res.statusText}`);
  return data;
};

/** The caller's own Context: reuse the one they sent if it is theirs, otherwise create one. */
const userContext = async (email: string, contextId?: string): Promise<string> => {
  if (contextId && /^[\w-]+$/.test(contextId)) {
    const existing = await bb(`/contexts/${contextId}`).catch(() => undefined);
    if (existing && (!existing.name || existing.name === email)) return contextId;
  }
  const { projectId } = bbConfig();
  return String((await bb('/contexts', { method: 'POST', body: { projectId, name: email } })).id);
};

/** A live session opened by this caller, or a 403/410. */
const ownSession = async (email: string, sessionId: string) => {
  if (!/^[\w-]+$/.test(sessionId || '')) throw new HttpError(400, 'Falta el identificador de la sesión.');
  const session = await bb(`/sessions/${sessionId}`);
  if (session?.userMetadata?.email !== email) throw new HttpError(403, 'Esa sesión de navegador no es tuya.');
  if (!['RUNNING', 'PENDING'].includes(session.status)) throw new HttpError(410, 'La sesión del navegador ha terminado.');
  return session as { id: string; connectUrl: string };
};

const withPage = async <T>(connectUrl: string, fn: (page: Page) => Promise<T>): Promise<T> => {
  const { chromium } = await import('playwright-core');
  const browser: Browser = await chromium.connectOverCDP(connectUrl);
  try {
    const context = browser.contexts()[0];
    const page = context.pages()[0] || (await context.newPage());
    page.setDefaultTimeout(STEP_TIMEOUT_MS);
    return await fn(page);
  } finally {
    // Without keep-alive this also ends the session, which is when the Context (login) is saved.
    await browser.close().catch(() => undefined);
  }
};

const screenshot = async (page: Page) => {
  const buffer = await page.screenshot({ type: 'jpeg', quality: 55 }).catch(() => undefined);
  return buffer ? `data:image/jpeg;base64,${buffer.toString('base64')}` : undefined;
};

type StepBody =
  | { kind: 'creative'; job: NativeCreativeJob; driveToken: string }
  | { kind: 'update'; job: NativeUpdateJob }
  | { kind: 'assignment'; job: NativeAssignmentJob };

export const handleQcNativeCloud = async (req: any, res: any) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: { message: 'Solo se admite POST.' } });
    return;
  }
  try {
    const email = await verifyCaller(req);
    const raw = await readRawBody(req);
    const body = raw ? JSON.parse(raw) : {};
    const accountId = String(body.accountId || '9964009').replace(/\D/g, '');

    switch (body.action) {
      // New session with the user's Context; returns its live view so the page can show it.
      case 'open': {
        const contextId = await userContext(email, body.contextId);
        const { projectId } = bbConfig();
        const session = await bb('/sessions', {
          method: 'POST',
          body: {
            projectId,
            timeout: SESSION_TIMEOUT_S,
            userMetadata: { email, app: 'quantcast-nativa' },
            browserSettings: { context: { id: contextId, persist: true }, viewport: { width: 1440, height: 900 } },
          },
        });
        const urls = await bb(`/sessions/${session.id}/debug`);
        res.json({ sessionId: session.id, contextId, liveUrl: `${urls.debuggerFullscreenUrl}&navbar=false` });
        return;
      }
      // Opens Quantcast and waits (in this same call) until the user has logged in through the live view.
      case 'login': {
        const session = await ownSession(email, body.sessionId);
        const loggedIn = await withPage(session.connectUrl, async (page) => {
          await page.goto(`${MANAGER}/${accountId}/campaigns`).catch(() => undefined);
          if (!isLoginUrl(page.url())) return true;
          return page.waitForURL((url) => url.pathname.startsWith('/ads/') && !isLoginUrl(url.href), { timeout: LOGIN_WAIT_MS })
            .then(async () => {
              await page.waitForLoadState('networkidle').catch(() => undefined);
              return true;
            }, () => false);
        });
        res.json({ loggedIn });
        return;
      }
      case 'step': {
        const session = await ownSession(email, body.sessionId);
        const step = body.step as StepBody;
        const dryRun = !!body.dryRun;
        let popupsClosed = 0;
        const result = await withPage(session.connectUrl, async (page) => {
          page.on('dialog', (d) => d.accept().catch(() => undefined));
          await installPopupGuards(page, () => { popupsClosed++; });
          try {
            const message = step.kind === 'creative'
              ? await creativeStep(page, accountId, step.job, step.driveToken, path.join(os.tmpdir(), 'qc-native'), dryRun)
              : step.kind === 'update'
                ? await updateStep(page, accountId, step.job, dryRun)
                : await assignStep(page, accountId, step.job, dryRun);
            return { status: 'done', message, screenshot: await screenshot(page) };
          } catch (e: any) {
            const message = e?.message || String(e);
            const loggedOut = isLoginUrl(page.url());
            return { status: 'error', message, loggedOut, screenshot: await screenshot(page) };
          }
        });
        res.json({ ...result, popupsClosed });
        return;
      }
      // Releases a session the page opened but will not use (e.g. the user cancelled).
      case 'end': {
        await ownSession(email, body.sessionId);
        const { projectId } = bbConfig();
        await bb(`/sessions/${body.sessionId}`, { method: 'POST', body: { projectId, status: 'REQUEST_RELEASE' } }).catch(() => undefined);
        res.json({ ended: true });
        return;
      }
      default:
        res.status(400).json({ error: { message: 'Acción desconocida.' } });
    }
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    res.status(status).json({ error: { message: error?.message || 'Error desconocido en el navegador en la nube.' } });
  }
};
