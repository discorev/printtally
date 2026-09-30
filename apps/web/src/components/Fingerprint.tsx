import { cx } from '../lib/cx.ts';

/** A printer root certificate's SHA-256 fingerprint, laid out as the printer's own "Root cert. thumbprint" screen
 *  shows it: lowercase, in groups of four bytes, three groups to a line, so the two can be compared line by line. */
export function Fingerprint({ sha256, className }: { sha256: string; className?: string }) {
  const hex = sha256.replaceAll(':', '').toLowerCase(), groups = hex.match(/.{1,8}/g) ?? [];
  const rows = [0, 3, 6].map(start => groups.slice(start, start + 3).join(' ')).filter(Boolean);
  return (
    <div aria-label={`Fingerprint ${groups.join(' ')}`} role="img"
      className={cx('my-2.5 rounded-[3px] border border-rule bg-paper-2 px-3.5 py-2.5 font-mono text-[15px] leading-6 font-medium tracking-[.06em] whitespace-pre phone:text-[13px] phone:tracking-[.03em]', className)}>
      {rows.join('\n')}
    </div>
  );
}
