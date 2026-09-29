import type { ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { cx } from '../lib/cx.ts';
import { useCanEdit } from '../connection/index.ts';

/** The pre-printed form voice: slab small caps ("COST", "PAPER", "SEPTEMBER 2026"). With `lockable`, a lock
 *  follows it while editing is paused. */
export function SectionLabel({ children, lockable, className }: { children: ReactNode; lockable?: boolean; className?: string }) {
  const canEdit = useCanEdit();
  return (
    <div className={cx('font-slab text-[11px] leading-4 font-semibold tracking-[.09em] text-muted uppercase', className)}>
      {children}{lockable && !canEdit && <Lock size={11} strokeWidth={1.6} aria-label="Editing paused" className="ml-1.5 inline align-[-1px]" />}
    </div>
  );
}

/** A meta/stat line: muted 13px text; wrap emphasised figures in <b> (ink colour, medium weight). */
export const Meta = ({ children, className }: { children: ReactNode; className?: string }) =>
  <span className={cx('text-[13px] text-muted [&_b]:font-medium [&_b]:text-ink', className)}>{children}</span>;
/** Secondary copy under a title or in a section (muted 13/18). tone: amber for warnings, green for "Saved", red for waste. */
export const Sub = ({ children, tone, className }: { children: ReactNode; tone?: 'amber' | 'green' | 'red'; className?: string }) =>
  <div className={cx('text-[13px] leading-[18px]', tone ? TONES[tone] : 'text-muted', className)}>{children}</div>;
const TONES = { amber: 'text-amber', green: 'text-green', red: 'text-red' };
/** " · " between parts of a meta line. */
export const Dot = () => <> · </>;

/** A small outlined flag: Cancelled (red), Hidden (muted), Paper corrected (green), Missed (amber). */
export function Chip({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'red' | 'amber' | 'green' }) {
  const colour = { muted: 'text-muted', red: 'text-red', amber: 'text-amber', green: 'text-green' }[tone];
  return <span className={cx('inline-block rounded-[2px] border border-current px-1.5 py-px align-[1px] font-slab text-[10.5px] leading-[14px] font-semibold tracking-[.08em] uppercase', colour)}>{children}</span>;
}

/** A job note as written on the docket: slab italic. */
export const NoteText = ({ children, className }: { children: ReactNode; className?: string }) =>
  <div className={cx('font-slab text-[15px] leading-[21px] font-medium text-ink italic', className)}>{children}</div>;

/** A definition list of label → value pairs ("Printer reported", printer info). Falsy rows are skipped. */
export function KV({ rows, className }: { rows: ([label: ReactNode, value: ReactNode] | false | null | undefined)[]; className?: string }) {
  return (
    <dl className={cx('m-0 grid grid-cols-[118px_1fr] gap-x-3 gap-y-1 text-[13px] phone:grid-cols-[100px_1fr]', className)}>
      {rows.filter(row => !!row).map(([label, value], index) => (
        <div key={index} className="contents"><dt className="text-muted">{label}</dt><dd className="m-0 min-w-0 wrap-anywhere">{value}</dd></div>
      ))}
    </dl>
  );
}

/** Monospace detail (job names, addresses, fingerprints). */
export const Mono = ({ children, className }: { children: ReactNode; className?: string }) =>
  <span className={cx('font-mono text-[12.5px]', className)}>{children}</span>;
