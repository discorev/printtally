import { cx } from '../lib/cx.ts';

/** A printer root certificate's SHA-256 fingerprint ("3A:9F:…"), set as four rows of eight bytes, as the printer's
 *  own "Root cert. thumbprint" screen groups it, so the two can be compared line by line. */
export function Fingerprint({ sha256, className }: { sha256: string; className?: string }) {
  const bytes = sha256.split(':'), rows = [0, 8, 16, 24].map(start => bytes.slice(start, start + 8).join(' ')).filter(Boolean);
  return (
    <div aria-label={`Fingerprint ${bytes.join(' ')}`} role="img"
      className={cx('my-2.5 rounded-[3px] border border-rule bg-paper-2 px-3.5 py-2.5 font-mono text-[15px] leading-6 font-medium tracking-[.06em] whitespace-pre phone:text-[13px] phone:tracking-[.03em]', className)}>
      {rows.join('\n')}
    </div>
  );
}
