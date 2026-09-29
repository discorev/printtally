// The PRO-1100's twelve ink channels in cartridge order, with the names and colours the UI shows.
// Presentation only: the ledger knows channels by code; unknown codes fall back to the code itself.
export interface InkChannel { code: string; name: string; colour: string | null } // null: Chroma Optimiser is clear

export const INK_CHANNELS: InkChannel[] = [
  { code: 'PM', name: 'Photo Magenta', colour: '#E98BBE' }, { code: 'R', name: 'Red', colour: '#D8322B' },
  { code: 'C', name: 'Cyan', colour: '#009FD9' }, { code: 'PGY', name: 'Photo Grey', colour: '#B4B6B8' },
  { code: 'MBK', name: 'Matte Black', colour: '#1F1F1F' }, { code: 'PBK', name: 'Photo Black', colour: '#2A2A31' },
  { code: 'B', name: 'Blue', colour: '#2B47A8' }, { code: 'CO', name: 'Chroma Optimiser', colour: null },
  { code: 'GY', name: 'Grey', colour: '#7A7C80' }, { code: 'Y', name: 'Yellow', colour: '#F2C300' },
  { code: 'M', name: 'Magenta', colour: '#D6197A' }, { code: 'PC', name: 'Photo Cyan', colour: '#82D2EE' },
];
const byCode = new Map(INK_CHANNELS.map(channel => [channel.code, channel]));
export const inkChannel = (code: string): InkChannel => byCode.get(code) ?? { code, name: code, colour: '#8E948F' };
/** Sorts anything with a channel code into cartridge order; unknown channels go last, alphabetically. */
export function byChannelOrder<T>(items: T[], code: (item: T) => string): T[] {
  const rank = (c: string) => { const i = INK_CHANNELS.findIndex(channel => channel.code === c); return i < 0 ? INK_CHANNELS.length : i; };
  return [...items].sort((a, b) => rank(code(a)) - rank(code(b)) || code(a).localeCompare(code(b)));
}
/** How strongly a patch is tinted for the ink a print used (0 = none, 1 = full colour), as in the mockup's wedge. */
export const inkTint = (nl: number | null): number => {
  const mlUsed = (nl ?? 0) / 1e6;
  return mlUsed <= 0 ? 0 : Math.min(1, 0.14 + 0.86 * Math.min(1, mlUsed / 0.28));
};
export const withAlpha = (hex: string, alpha: number): string => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${alpha})`;
};
