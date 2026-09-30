import type { ServerOwnership } from '../desktop.ts';

/** The chip names the computer Print Tally is using. In the desktop app that's redundant once it's
 *  running the server it started itself, so it's hidden there — but shown for a borrowed local server
 *  or a remote host (where naming the computer is useful), and always in a browser. Ownership isn't
 *  known until the desktop app's first connection answer, so it stays shown until then. */
export function showServerChip({ desktop, ownership }: { desktop: boolean; ownership: ServerOwnership | undefined }): boolean {
  return !desktop || ownership !== 'owned';
}
