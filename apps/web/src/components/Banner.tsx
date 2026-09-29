import type { ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { cx } from '../lib/cx.ts';
import { SectionLabel } from './Text.tsx';

/** The amber strip across the mat above the work area: server lost, missed jobs. `detail` is the dimmer
 *  text after the message (e.g. "retry in 8 s"); `action` sits at the right (a text Button). */
export function Banner({ children, detail, action }: { children: ReactNode; detail?: ReactNode; action?: ReactNode }) {
  return (
    <div role="status" className="mx-4 mb-3 flex flex-none items-center gap-3 rounded-[3px] border border-amber-line bg-amber-bg px-3.5 py-2 text-[13px] leading-[18px] font-medium text-amber shadow-[0_1px_0_rgba(0,0,0,.2)] phone:mx-2 phone:mb-2">
      <TriangleAlert size={16} strokeWidth={1.5} aria-hidden className="flex-none" />
      <span>{children}</span>
      {detail && <span className="opacity-85">{detail}</span>}
      <span className="flex-1" />
      {action}
    </div>
  );
}

/** An amber boxed warning inside a pad or docket (Collect's "Some jobs may have been missed"). */
export function Notice({ title, children, className }: { title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div role="alert" className={cx('rounded-[3px] border border-amber-line bg-amber-bg px-3.5 py-3 text-[13.5px] leading-[19px] text-ink', className)}>
      <SectionLabel className="mb-1.5 text-amber!">{title}</SectionLabel>
      {children}
    </div>
  );
}
