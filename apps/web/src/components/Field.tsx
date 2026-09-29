import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Search } from 'lucide-react';
import { cx } from '../lib/cx.ts';
import { currencySymbol } from '../lib/format.ts';
import { useCurrency } from '../api/queries.ts';

// Form controls are native elements styled by the base stylesheet (styles.css), as in the mockup.

/** A labelled field: slab small-caps label, the control, then an optional hint (muted) and error (amber).
 *  `children` is a render function given the id to put on the control, or plain nodes (then pass `htmlFor`). */
export function Field({ label, optional, hint, error, children, className, htmlFor }: {
  label: ReactNode; optional?: boolean; hint?: ReactNode; error?: ReactNode; className?: string; htmlFor?: string;
  children: ReactNode | ((id: string) => ReactNode);
}) {
  const generated = useId(), id = htmlFor ?? generated;
  return (
    <div className={cx('flex min-w-0 flex-col gap-[5px]', className)}>
      <label htmlFor={id} className="font-slab text-[11px] leading-4 font-semibold tracking-[.09em] text-muted uppercase">
        {label}{optional && <span className="font-normal tracking-normal normal-case"> (optional)</span>}
      </label>
      {typeof children === 'function' ? children(id) : children}
      {hint && <span className="text-[13px] leading-[18px] text-muted">{hint}</span>}
      {error && <span className="text-[13px] text-amber" role="alert">{error}</span>}
    </div>
  );
}
/** Two fields side by side; one column on phones. */
export const FieldPair = ({ children, className }: { children: ReactNode; className?: string }) =>
  <div className={cx('grid grid-cols-2 gap-3 phone:grid-cols-1', className)}>{children}</div>;
/** A column of fields with the mockup's 12px rhythm. */
export const FieldStack = ({ children, className }: { children: ReactNode; className?: string }) =>
  <div className={cx('flex flex-col gap-3', className)}>{children}</div>;

export const TextInput = ({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) => <input type="text" className={className} {...props} />;
export const NumberInput = ({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) => <input type="number" inputMode="numeric" className={className} {...props} />;
/** A ledger day (YYYY-MM-DD) with the browser's date picker. */
export const DateInput = ({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) => <input type="date" className={className} {...props} />;
export const Textarea = ({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea className={className} {...props} />;
export const Select = ({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) => <select className={className} {...props} />;

/** A price in the ledger's currency, typed as text ("37.99"); parse the value with parseMoney() from lib/format. */
export function MoneyInput({ className, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const currency = useCurrency();
  return <input type="text" inputMode="decimal" autoComplete="off" placeholder={`${currencySymbol(currency)}0.00`} className={className} {...props} />;
}

/** A checkbox (or radio) with its label beside it, e.g. "Show hidden", "Deckle edge". */
export function Toggle({ label, className, type = 'checkbox', ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: ReactNode; type?: 'checkbox' | 'radio' }) {
  return (
    <label className={cx('inline-flex cursor-pointer items-center gap-[7px] text-[13px] leading-5 whitespace-nowrap text-muted has-disabled:cursor-default has-disabled:text-faint', className)}>
      <input type={type} {...props} />{label}
    </label>
  );
}

/** The jobs search box: a magnifier inside the field. */
export function SearchInput({ className, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return (
    <label className={cx('relative min-w-[180px] flex-1', className)}>
      <Search size={14} strokeWidth={1.75} aria-hidden className="absolute top-[9px] left-[9px] text-faint" />
      <input type="search" className="pl-[30px]!" {...props} />
    </label>
  );
}
