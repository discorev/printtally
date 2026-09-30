import type { CSSProperties } from 'react';
import { cx } from '../lib/cx.ts';
import { INK_CHANNELS, inkChannel, inkTint, withAlpha } from '../lib/inks.ts';

// A neutral paper tone for every paper: the API doesn't record paper tones (yet), and real papers are all
// within a few shades of this.
export const PAPER_TONE = '#F4F3EE';

export type SwatchSize = 'tiny' | 'sm' | 'big'; // 12×14 (cost table) · 16×21 (rows, pickers) · 44×58 (papers list, docket paper section)
export interface PaperSwatchProps {
  tone?: string; size?: SwatchSize;
  shape?: 'sheet' | 'square' | 'roll'; deckle?: boolean;
  /** Hatched and dashed: no paper set up (or the cost is unknown). */
  none?: boolean; className?: string;
}
/** The "sheet": a tiny sheet of the paper in its tone. Square, roll and deckle-edged variants. */
export function PaperSwatch({ tone = PAPER_TONE, size = 'sm', shape = 'sheet', deckle, none, className }: PaperSwatchProps) {
  return <span aria-hidden style={{ '--tone': tone }}
    className={cx('sheet', size !== 'sm' && size, shape === 'square' && 'sq', shape === 'roll' && 'roll', deckle && 'deckle', none && 'none', className)} />;
}

/** One ink channel's patch. `volumeNl` tints it by how much a print used (cost table, wedge); without it
 *  the patch is the full colour (Ink list). Chroma Optimiser is hatched. size: 14px or 22px (Ink list). */
export function InkSwatch({ channel, volumeNl, size = 'sm', className }: { channel: string; volumeNl?: number | null; size?: 'sm' | 'lg'; className?: string }) {
  const { colour } = inkChannel(channel), tint = volumeNl === undefined ? 1 : inkTint(volumeNl);
  const style: CSSProperties = colour ? { '--fill': tint ? withAlpha(colour, tint) : 'transparent' } : { '--o': volumeNl === undefined ? 1 : tint || 0.18 };
  return <span aria-hidden style={style} className={cx('patch', !colour && 'co', size === 'lg' ? 'lg size-[22px] rounded-[2px]' : 'size-3.5', className)} />;
}

/** The ink wedge: twelve patches in cartridge order, tinted by the ml a print used of each. */
export function InkWedge({ ink, big, className }: { ink: { channel: string; volume_nl: number | null }[]; big?: boolean; className?: string }) {
  const used = new Map(ink.map(line => [line.channel, line.volume_nl]));
  return (
    <span aria-hidden className={cx('inline-grid items-end', big ? 'grid-cols-[repeat(12,22px)] gap-1' : 'grid-cols-[repeat(12,9px)] gap-0.5', className)}>
      {INK_CHANNELS.map(({ code }) => <InkSwatch key={code} channel={code} volumeNl={used.get(code) ?? 0} className={big ? 'h-[30px]! w-auto!' : 'h-3.5! w-auto!'} />)}
    </span>
  );
}
