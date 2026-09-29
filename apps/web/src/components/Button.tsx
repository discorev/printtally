import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from '@tanstack/react-router';
import { cx } from '../lib/cx.ts';
import { useCanEdit } from '../connection/index.ts';

export type ButtonVariant = 'default' | 'primary' | 'text' | 'danger';
const base = 'inline-flex items-center gap-1.5 rounded-[3px] border font-medium whitespace-nowrap no-underline';
const variants: Record<ButtonVariant, string> = {
  default: 'border-rule-2 bg-transparent text-ink hover:bg-hover',
  primary: 'border-green bg-green text-on-green hover:border-green-2 hover:bg-green-2',
  text: 'border-transparent bg-transparent text-green hover:bg-hover',
  danger: 'border-transparent bg-transparent text-red hover:bg-hover',
};
const disabled = 'disabled:border-rule disabled:bg-transparent disabled:text-faint aria-disabled:border-rule aria-disabled:bg-transparent aria-disabled:text-faint aria-disabled:pointer-events-none';
/** The mockup's .btn classes, for anything that should look like a button (e.g. a router Link). */
export const buttonClass = (variant: ButtonVariant = 'default', size: 'md' | 'sm' = 'md'): string => cx(base, variants[variant], disabled,
  size === 'sm' ? 'px-2 py-[3px] text-[12px] leading-[18px]' : variant === 'text' || variant === 'danger' ? 'px-1.5 py-[5px] text-[13px] leading-[18px]' : 'px-3 py-[5px] text-[13px] leading-[18px]');

/** `edit`: this button changes the ledger, so it's disabled while the server is lost (plan decision 6). */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> { variant?: ButtonVariant; size?: 'md' | 'sm'; edit?: boolean }
/** Primary (green), default (outlined), text (green, borderless) or danger; size sm for docket actions. */
export function Button({ variant = 'default', size = 'md', edit, disabled, className, type = 'button', ...props }: ButtonProps) {
  const canEdit = useCanEdit();
  return <button type={type} disabled={disabled || (edit && !canEdit)} className={cx(buttonClass(variant, size), className)} {...props} />;
}

/** A router link that looks like a Button. `disabled` renders it inert (aria-disabled). */
export function ButtonLink({ variant = 'default', size = 'md', className, disabled, ...props }: LinkProps & { variant?: ButtonVariant; size?: 'md' | 'sm'; className?: string; disabled?: boolean; children?: ReactNode }) {
  return <Link className={cx(buttonClass(variant, size), className)} aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : undefined} {...props} />;
}

/** An underlined inline text action (the mockup's .link), e.g. "oldest price", "Show", "Connect to it". */
export function LinkButton({ className, type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={cx('cursor-pointer border-0 bg-transparent p-0 text-green underline underline-offset-2 disabled:text-faint', className)} {...props} />;
}
/** The same look for a router link. */
export function TextLink({ className, ...props }: LinkProps & { className?: string; children?: ReactNode }) {
  return <Link className={cx('text-green underline underline-offset-2', className)} {...props} />;
}
