import { ApiError, describeError, errorMessage } from '../../api/client.ts';

/** What went wrong with an action that isn't saving an edit (finding a printer, collecting, connecting),
 *  so without the edit forms' "Not saved." prefix. */
export function problem(error: unknown): string {
  if (!(error instanceof ApiError)) return describeError(error);
  if (error.kind === 'rejected' && error.code) return errorMessage(error.code, false);
  if (error.kind === 'unreachable') return "Can't reach Print Tally. Try again when it's back.";
  if (error.kind === 'paused') return 'Paused until the server is back.';
  return error.message;
}
/** The server's error code, if it answered with one. */
export const problemCode = (error: unknown): string | undefined => error instanceof ApiError ? error.code : undefined;
