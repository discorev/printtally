import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { Link, useNavigate, type NavigateOptions } from '@tanstack/react-router';
import { Lock, X } from 'lucide-react';
import { cx } from '../lib/cx.ts';
import { useConnection } from '../connection/index.ts';
import { SectionLabel } from './Text.tsx';
import { Button } from './Button.tsx';

// The docket: the side sheet that slides onto the mat beside the pad (430px; 380px in narrow windows).
// On a phone it's its own page over the whole app, with a "‹ Back" link instead of the close button.
// Escape closes it (navigates to `close`) unless something inside handled Escape first (preventDefault),
// e.g. an open picker.
export interface DocketClose { to: NavigateOptions; label: string } // label: where "‹" goes back to, e.g. "Jobs"
const CloseContext = createContext<DocketClose | undefined>(undefined);

/** `centered`: the Setup and Connect card, 600px wide in the middle of the mat, on phones too. */
export function Docket({ label, close, tone, centered, children, className }: {
  label: string; close?: DocketClose; tone?: string; centered?: boolean; children: ReactNode; className?: string;
}) {
  const navigate = useNavigate();
  // Only while the server is lost: not before the first answer, nor for a device that needs pairing (401).
  const lost = useConnection().status === 'lost';
  useEffect(() => {
    if (!close) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const target = event.target as HTMLElement;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) { target.blur(); return; }
      void navigate(close.to);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [close, navigate]);
  return (
    <CloseContext value={close}>
      <aside aria-label={label} style={tone ? { '--tone': tone } : undefined}
        className={cx('relative flex min-h-0 flex-none flex-col overflow-auto overscroll-contain rounded-[3px] shadow-sheet',
          tone ? 'bg-(--tone) dark:bg-paper' : 'bg-paper',
          centered ? 'max-h-full w-[600px] max-w-full'
            : 'w-[430px] animate-slide narrow:w-[380px] phone:absolute phone:inset-0 phone:z-[5] phone:w-auto phone:animate-push phone:rounded-none', className)}>
        {lost && <PausedNotice />}
        {children}
      </aside>
    </CloseContext>
  );
}

/** Shown at the top of every docket while the server is lost. */
export const PausedNotice = () => (
  <div role="status" className="flex-none border-b border-amber-line bg-amber-bg px-5 py-2 text-[13px] text-amber">
    <Lock size={12} strokeWidth={1.6} aria-hidden className="mr-1 inline align-[-1px]" />Editing paused until the server is back
  </div>
);

/** The docket's head: `when` (small caps, e.g. "SATURDAY 12 SEPTEMBER 2026 · 17:12 – 17:17" or "PAPER"),
 *  the title, a subtitle line, then `children` (a note, flags). */
export function DocketHead({ when, title, subtitle, children }: { when?: ReactNode; title: ReactNode; subtitle?: ReactNode; children?: ReactNode }) {
  const close = useContext(CloseContext);
  return (
    <div className="flex flex-none items-start gap-3 border-b border-rule-2 px-5 pt-4 pb-3">
      <div className="min-w-0 flex-1">
        {close && (
          <Link {...close.to} className="hidden items-center gap-1 pr-1.5 text-[14px] leading-5 font-medium text-green no-underline phone:inline-flex">‹ {close.label}</Link>
        )}
        {when && <div className="font-slab text-[11px] leading-4 font-semibold tracking-[.09em] text-muted uppercase">{when}</div>}
        <div className="mt-1">
          <h2 className="text-[20px] leading-[26px]">{title}
            {subtitle && <small className="mt-0.5 block font-sans text-[13px] leading-[18px] font-normal text-muted">{subtitle}</small>}
          </h2>
        </div>
        {children}
      </div>
      {close && (
        <Link {...close.to} aria-label="Close (Esc)" title="Close (Esc)"
          className="ml-auto flex-none rounded-[3px] px-1.5 py-0.5 text-muted hover:bg-hover hover:text-ink phone:hidden"><X size={16} strokeWidth={1.6} className="my-0.5" /></Link>
      )}
    </div>
  );
}

/** A ruled section of a docket (or a pad body) with its small-caps label. `lockable` shows the lock while editing is paused. */
export function DocketSection({ label, lockable, children, className }: { label?: ReactNode; lockable?: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={cx('border-t border-rule px-5 py-3.5', className)}>
      {label && <SectionLabel lockable={lockable} className="mb-2">{label}</SectionLabel>}
      {children}
    </div>
  );
}

/** A row of actions under a section's content (Save / Cancel, Add stock / Write off). */
export const RowActions = ({ children, className }: { children: ReactNode; className?: string }) =>
  <div className={cx('mt-2.5 flex flex-wrap items-center gap-2', className)}>{children}</div>;

/** Live save status under an edit ("Saved 17:21", or an error in amber). */
export const StatusLine = ({ children, error }: { children?: ReactNode; error?: boolean }) =>
  <div aria-live="polite" className={cx('mt-1.5 min-h-[18px] text-[12.5px]', error ? 'text-amber' : 'text-muted')}>{children}</div>;

/** A form's confirmation once the server confirmed the save ("Added. Prints from … are costed from it."). */
export function SavedNotice({ label, children, onDone }: { label: ReactNode; children: ReactNode; onDone: () => void }) {
  return (
    <DocketSection label={label}>
      <div className="text-[13px] leading-[18px] text-green">{children}</div>
      <RowActions><Button size="sm" onClick={onDone}>Done</Button></RowActions>
    </DocketSection>
  );
}
