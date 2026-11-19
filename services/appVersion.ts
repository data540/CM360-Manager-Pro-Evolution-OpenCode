// A tab opened before a deploy keeps running the old code until it is reloaded. Before writing to
// CM360 we compare the bundle this tab loaded with the one the server publishes now.

const BUNDLE = /<script\b[^>]*\bsrc="(\/assets\/index-[^"]+\.js)"/;

/** Bundle path in an index.html, e.g. `/assets/index-BQ4-NQiS.js`. */
export const bundleOf = (html: string) => html.match(BUNDLE)?.[1];

const loadedBundle = () =>
  document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]')?.getAttribute('src') || undefined;

/** True only when both bundles are known and differ (dev server, offline or errors → false). */
export const isAppOutdated = async (): Promise<boolean> => {
  try {
    const loaded = loadedBundle();
    if (!loaded) return false;
    const res = await fetch(`/?v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return false;
    const published = bundleOf(await res.text());
    return !!published && published !== loaded;
  } catch {
    return false;
  }
};

export const OUTDATED_MESSAGE =
  'Hay una versión nueva de la app publicada y esta pestaña usa la anterior. Recarga la página (F5) y vuelve a generar el plan antes de ejecutar: no se ha tocado nada en CM360.';
