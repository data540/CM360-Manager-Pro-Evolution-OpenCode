// Brand day ("bd") and brand week ("bw") placements come in pairs, one per side of the page
// (e.g. 456x1000 izq + dch).
// Both creatives share the same size, so the side written in the names is what pairs them.

export type Side = 'left' | 'right';

const LEFT = new Set(['izq', 'iz', 'izda', 'izqda', 'izqd', 'izquierda', 'izquierdo', 'left']);
const RIGHT = new Set(['der', 'dch', 'dcha', 'dcho', 'drch', 'drcha', 'dra', 'derecha', 'derecho', 'right']);

/** Lower-case words of a name, also split where letters meet digits (`izq456x1000` → izq, 456, x, 1000). */
const tokensOf = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\.[a-z0-9]{2,5}$/, '')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** Short words that can be something else in a name (site `der_standard`); placements need "bd" for them. */
const WEAK = new Set(['der', 'dra', 'iz']);

export type BrandKind = 'day' | 'week';

/** `bd` / `brandday` / `brand day` → day; `bw` / `brandweek` / `brand week` → week. */
const brandKindOfTokens = (tokens: string[]): BrandKind | undefined => {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === 'bd' || t === 'brandday' || (t === 'brand' && tokens[i + 1] === 'day')) return 'day';
    if (t === 'bw' || t === 'brandweek' || (t === 'brand' && tokens[i + 1] === 'week')) return 'week';
  }
  return undefined;
};
const isBrandDayTokens = (tokens: string[]) => !!brandKindOfTokens(tokens);

/** Side named in a file name, matched as whole words only. */
export const sideOf = (name: string, { strict = false } = {}): Side | undefined => {
  const tokens = tokensOf(name);
  const weakOk = !strict || isBrandDayTokens(tokens);
  const counts = (set: Set<string>) => tokens.some((t) => set.has(t) && (weakOk || !WEAK.has(t)));
  const left = counts(LEFT);
  const right = counts(RIGHT);
  if (left === right) return undefined; // none, or both (ambiguous)
  return left ? 'left' : 'right';
};

/** Side of a placement: short words like `der` only count in brand day / week ("bd" / "bw") placements. */
export const placementSideOf = (name: string) => sideOf(name, { strict: true });

export const brandKindOf = (name: string) => brandKindOfTokens(tokensOf(name));
/** Brand day or brand week. */
export const isBrandDay = (name: string) => isBrandDayTokens(tokensOf(name));
export const brandKindLabel = (kind: BrandKind | undefined) => (kind === 'week' ? 'brand week' : 'brand day');
export const brandKindShort = (kind: BrandKind | undefined) => (kind === 'week' ? 'BW' : 'BD');

/** Same side, or neither has one. A sided creative never goes to an unsided placement, nor the reverse. */
export const sidesMatch = (fileName: string, placementName: string) => sideOf(fileName) === placementSideOf(placementName);

export const sideLabel = (side: Side | undefined) => (side === 'left' ? 'Izq' : side === 'right' ? 'Dcha' : '');

/** Removes the side words so both halves of a brand day count as one "juego". */
export const stripSide = (name: string) =>
  name.replace(/(^|[^a-z0-9]+)([a-z]+)(?=[^a-z]|$)/gi, (m, _pre: string, word: string) =>
    (LEFT.has(word.toLowerCase()) || RIGHT.has(word.toLowerCase()) ? '' : m));

/** `456x1000_izq` for a sided file, so both halves of a brand day get distinct creative names. */
export const sizeWithSide = (size: string, fileName: string) => {
  const side = sideOf(fileName);
  return side ? `${size}_${side === 'left' ? 'izq' : 'dch'}` : size;
};

interface NoteFile { fileName: string; size?: string; kind?: string }
interface NotePlacement { id: string; name: string; size?: string; active?: boolean }

const sideText = (side: Side | undefined) => (side === 'left' ? 'izquierda' : side === 'right' ? 'derecha' : 'sin lado');

/**
 * Explains brand day placements that get no creative: no side in the name, or no file of that
 * side and size (with what the folder does have, e.g. the other size or the other side).
 */
export const brandDayNotes = (placements: NotePlacement[], files: NoteFile[]) => {
  const notes: { placementId: string; message: string }[] = [];
  const usable = files.filter((f) => f.size && f.kind !== 'unsupported');
  placements.forEach((p) => {
    if (p.active === false) return;
    const side = placementSideOf(p.name);
    if (!side) {
      if (isBrandDay(p.name)) {
        notes.push({ placementId: p.id, message: `${p.name} es un ${brandKindLabel(brandKindOf(p.name))} pero el nombre no dice el lado (izq / dch): solo recibirá creatividades sin lado.` });
      }
      return;
    }
    if (usable.some((f) => f.size === p.size && sideOf(f.fileName) === side)) return;
    const sameSide = [...new Set(usable.filter((f) => sideOf(f.fileName) === side).map((f) => f.size))];
    const sameSize = [...new Set(usable.filter((f) => f.size === p.size).map((f) => sideText(sideOf(f.fileName))))];
    const what = sameSide.length
      ? ` Hay creatividad ${sideText(side)} de ${sameSide.join(', ')}, pero el placement es ${p.size}.`
      : sameSize.length
        ? ` Hay creatividades de ${p.size}, pero ${sameSize.join(' / ')}.`
        : '';
    const kind = brandKindLabel(brandKindOf(p.name));
    notes.push({ placementId: p.id, message: `${kind[0].toUpperCase()}${kind.slice(1)} ${sideText(side)} ${p.name}: no hay creatividad ${sideText(side)} de ${p.size}.${what}` });
  });
  return notes;
};
