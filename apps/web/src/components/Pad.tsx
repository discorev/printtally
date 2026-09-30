import type { HTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from '@tanstack/react-router';
import { cx } from '../lib/cx.ts';

// The pad: the main sheet of paper on the mat, holding a screen's list. It's a size container, so rows can
// drop columns as it narrows: use Tailwind's @max-[840px]: and @max-[640px]: variants inside it
// ("wedge first, then ml, then stock"), and phone: for the phone layout.

export function Pad({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <section aria-label={label} className={cx('@container relative flex min-h-0 min-w-0 flex-1 flex-col rounded-[3px] bg-paper shadow-sheet', className)}>
      {children}
    </section>
  );
}

/** The pad's head: the h1, then `after` (e.g. the Stock | Media tabs), the meta line, `actions` pushed right
 *  (e.g. "Add stock"), and `children` as the tools row beneath (search, filters, toggles). */
export function PadHead({ title, after, meta, actions, children }: { title: ReactNode; after?: ReactNode; meta?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex-none border-b border-rule px-5 pt-4 pb-3 phone:px-3.5 phone:pt-3 phone:pb-2.5">
      <div className="flex items-baseline gap-3.5 phone:flex-wrap">
        <h1>{title}</h1>
        {after}
        {meta !== undefined && <span className="min-w-0 flex-1 text-[13px] phone:min-w-56 text-muted [&_b]:font-medium [&_b]:text-ink">{meta}</span>}
        {actions && <span className="ml-auto flex-none">{actions}</span>}
      </div>
      {children && <div className="mt-3 flex flex-wrap items-center gap-2.5">{children}</div>}
    </div>
  );
}

/** The pad's scrolling body. Pass role="listbox" and an aria-label for a list of selectable rows. */
export const PadBody = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) =>
  <div className={cx('min-h-0 flex-1 overflow-auto overscroll-contain', className)} {...props} />;

/** A sticky group heading in a list, e.g. "SEPTEMBER 2026 … 10 prints · 8.35 ml · £14.53". */
export function ListHeader({ label, meta }: { label: ReactNode; meta?: ReactNode }) {
  return (
    <div className="sticky top-0 z-[2] flex items-baseline gap-3 border-b border-rule-2 bg-paper px-5 pt-2.5 pb-1.5 phone:px-3.5 phone:pt-2 phone:pb-1">
      <span className="font-slab text-[11px] leading-4 font-semibold tracking-[.09em] whitespace-nowrap text-ink uppercase">{label}</span>
      {meta && <span className="ml-auto text-right text-[13px] text-muted [&_b]:font-medium [&_b]:text-ink">{meta}</span>}
    </div>
  );
}

/** A selectable list row that links to its docket (URL-addressable selection, e.g. /jobs/71). Give it the
 *  row's grid columns in className; selected rows get the tint and the green bar. To make clicking a selected
 *  row close its docket, point `to` back at the list. `id` lets a screen scroll the row into view. */
export function ListRow({ selected, className, children, id, ...link }: LinkProps & { selected: boolean; className?: string; children: ReactNode; id?: string }) {
  return (
    <Link role="option" aria-selected={selected} id={id} {...link}
      className={cx('row-bar relative grid w-full items-center border-b border-rule px-5 text-left text-ink no-underline hover:bg-hover phone:px-3.5', selected && 'is-selected', className)}>
      {children}
    </Link>
  );
}

/** "No prints match…" in an empty list. */
export const Empty = ({ children }: { children: ReactNode }) => <div className="px-5 py-10 text-center text-muted">{children}</div>;
