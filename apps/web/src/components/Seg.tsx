import { cx } from '../lib/cx.ts';

export interface SegItem<T extends string> { value: T; label: string }
/** Segmented tabs (Papers' Stock | Media). The selected segment is green. */
export function Seg<T extends string>({ items, value, onChange, label, className }: {
  items: SegItem<T>[]; value: T; onChange: (value: T) => void; label: string; className?: string;
}) {
  return (
    <span role="tablist" aria-label={label} className={cx('inline-flex overflow-hidden rounded-[3px] border border-rule-2', className)}>
      {items.map((item, index) => (
        <button key={item.value} type="button" role="tab" aria-selected={item.value === value} aria-pressed={item.value === value}
          onClick={() => onChange(item.value)}
          className={cx('border-0 px-[11px] py-1 text-[13px] leading-[18px] font-medium', index > 0 && 'border-l border-solid border-rule-2',
            item.value === value ? 'bg-green text-on-green' : 'bg-transparent text-muted')}>
          {item.label}
        </button>
      ))}
    </span>
  );
}
