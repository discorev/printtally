import type { KeyboardEvent, ReactNode } from 'react';
import { cx } from '../lib/cx.ts';

/** A boxed radio list: paper corrections, choosing the stock a print came from.
 *  Up/Down move between options. */
export function RadioList({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const options = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-option]:not(:disabled)')];
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    const next = options[index + (event.key === 'ArrowDown' ? 1 : -1)];
    if (next) { event.preventDefault(); event.stopPropagation(); next.focus(); }
  };
  return (
    <div role="radiogroup" aria-label={label} onKeyDown={onKeyDown}
      className={cx('overflow-hidden rounded-[3px] border border-rule-2 bg-paper dark:bg-paper-2', className)}>
      {children}
    </div>
  );
}

/** One option: the radio dot, an optional swatch, the label (with an optional `detail` line beneath),
 *  and `trailing` muted text at the right (e.g. "20 prints"). `dashed`: an action option like "New paper…". */
export function RadioOption({ checked, onSelect, swatch, children, detail, trailing, dashed, disabled }: {
  checked: boolean; onSelect: () => void; swatch?: ReactNode; children: ReactNode; detail?: ReactNode; trailing?: ReactNode; dashed?: boolean; disabled?: boolean;
}) {
  return (
    <button type="button" role={dashed ? undefined : 'radio'} aria-checked={dashed ? undefined : checked} data-option disabled={disabled} onClick={onSelect}
      className={cx('flex w-full items-center gap-2.5 border-0 border-b border-solid border-rule bg-transparent px-2.5 py-[7px] text-left text-ink last:border-b-0 hover:bg-hover disabled:text-faint',
        checked && 'bg-sel hover:bg-sel')}>
      <span className={cx('dot', dashed && 'border-dashed')} />
      {swatch}
      <span className="min-w-0 flex-1">{children}{detail && <div className="text-[12px] text-muted">{detail}</div>}</span>
      {trailing && <span className="text-[12px] text-muted">{trailing}</span>}
    </button>
  );
}
