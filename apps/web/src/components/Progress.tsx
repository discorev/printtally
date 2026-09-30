import { cx } from '../lib/cx.ts';

/** The amber sweep under a running collection; still when motion is reduced. */
export const Sweep = ({ className }: { className?: string }) => (
  <div aria-hidden className={cx('relative mt-2.5 h-0.5 overflow-hidden rounded-[1px] bg-rule', className)}>
    <i className="absolute inset-y-0 w-[30%] animate-sweep bg-amber motion-reduce:left-0 motion-reduce:w-2" />
  </div>
);

/** A small spinner inside a busy button ("Looking on the network…"). */
export const Spinner = () => (
  <span aria-hidden className="mr-0.5 inline-block size-3.5 animate-spin rounded-full border-2 border-rule-2 border-t-green align-[-3px]" />
);
