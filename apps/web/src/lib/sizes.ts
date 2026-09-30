// The PRO-1100's own paper size list (de-duplicated), used to name a job's size and to offer sizes
// when setting up a stock item. Millimetres, portrait.
export interface PaperSize { name: string; widthMm: number; heightMm: number }
export const SIZE_GROUPS: [group: string, sizes: PaperSize[]][] = ([
  ['ISO', [['A2', 420, 594], ['A3', 297, 420], ['A3+', 329, 483], ['A4', 210, 297], ['A5', 148, 210], ['B3', 364, 515], ['B4', 257, 364], ['B5', 182, 257], ['210×594 mm', 210, 594]]],
  ['Inches', [['4×6 in', 101.6, 152.4], ['5×7 in', 127, 177.8], ['7×10 in', 177.8, 254], ['8×10 in', 203.2, 254], ['Letter 8.5×11 in', 215.9, 279.4],
    ['Legal 8.5×14 in', 215.9, 355.6], ['9×13 in', 228.6, 330.2], ['10×12 in', 254, 304.8], ['11×14 in', 279.4, 355.6], ['11×17 in', 279.4, 431.8],
    ['Square 12×12 in', 304.8, 304.8], ['13×19 in (Super B)', 330.2, 482.6], ['14×17 in', 355.6, 431.8], ['US Photo 16×20 in', 406.4, 508],
    ['17×22 in (ANSI C)', 431.8, 558.8], ['17×25 in', 431.8, 635]]],
  ['Japanese', [['L 89×127 mm', 89, 127], ['2L 127×178 mm', 127, 178], ['Hagaki 100×148 mm', 100, 148], ['Hagaki 2 200×148 mm', 200, 148]]],
] as [string, [string, number, number][]][]).map(([group, list]) => [group, list.map(([name, widthMm, heightMm]) => ({ name, widthMm, heightMm }))]);
export const ROLL_WIDTHS_IN = [17, 24, 36, 44];

const ALL = SIZE_GROUPS.flatMap(([, list]) => list);
const near = (a: number, b: number) => Math.abs(a - b) <= 1.5;
const inches = (mmValue: number) => Math.round((mmValue / 25.4) * 10) / 10;

/** The printer's name for a width × height in micrometres, either way round: "A4", "Square 12×12 in",
 *  else inches when both sides are whole inches ("17×36 in"), else millimetres ("300×400 mm"). */
export function sizeName(widthUm: number | string | null, heightUm: number | string | null): string {
  if (!widthUm || !heightUm) return 'Unknown size';
  const w = Number(widthUm) / 1000, h = Number(heightUm) / 1000;
  const match = ALL.find(s => (near(s.widthMm, w) && near(s.heightMm, h)) || (near(s.widthMm, h) && near(s.heightMm, w)));
  if (match) return match.name;
  const [a, b] = [Math.min(w, h), Math.max(w, h)];
  if (Number.isInteger(inches(a)) && Number.isInteger(inches(b))) return `${inches(a)}×${inches(b)} in`;
  return `${Math.round(a)}×${Math.round(b)} mm`;
}
/** The short form for list columns and the cost table: "Square 12×12 in" → "12×12", "13×19 in (Super B)" → "13×19". */
export const sizeCode = (name: string): string => name.replace(/^(Square|US Photo|Letter|Legal) /, '').replace(/ \(.*\)$/, '')
  .replace(/ in$/, '').replace(/^(Hagaki 2|Hagaki|2L|L) .*mm$/, '$1');
export const isSquare = (widthUm: number | string | null, heightUm: number | string | null): boolean =>
  !!widthUm && !!heightUm && Math.abs(Number(widthUm) - Number(heightUm)) <= 1500;
/** A roll's width label: 431800 → '17"'. */
export const rollWidth = (widthUm: number): string => `${Math.round(widthUm / 25400)}"`;
