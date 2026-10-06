import type { ZodType } from 'zod';

// The UI never talks to the printer, SQL or credentials directly (see ARCHITECTURE.md): every result comes
// from this API, served by the same origin as the UI (proxied at /api in dev, see vite.config.ts).

/** unreachable: no answer from Print Tally (network down, timed out, or something else answered);
 *  unauthorized: this device's session isn't valid (401); paused: an edit refused before sending because the
 *  server is lost; invalid: the input failed the contract's schema; rejected: the server answered with an error. */
export type ApiErrorKind = 'unreachable' | 'unauthorized' | 'paused' | 'invalid' | 'rejected';
export class ApiError extends Error {
  constructor(readonly kind: ApiErrorKind, message: string, readonly status?: number, readonly code?: string) { super(message); }
}
const NOT_SAVED: Record<Exclude<ApiErrorKind, 'rejected' | 'invalid'>, string> = {
  unreachable: "Not saved. Can't reach Print Tally; try again when it's back.",
  unauthorized: 'Not saved. This device needs to connect to Print Tally again.',
  paused: 'Not saved. Editing is paused until the server is back.',
};

// The connection monitor listens here, so every request doubles as a health signal (connection/monitor.ts).
export type RequestOutcome = 'ok' | 'unreachable' | 'unauthorized';
let reportOutcome: (outcome: RequestOutcome) => void = () => undefined;
export const onRequestOutcome = (listener: (outcome: RequestOutcome) => void): void => { reportOutcome = listener; };
// Edits check this before sending, so nothing is sent or queued while the server is lost.
let editable: () => boolean = () => true;
export const setEditGate = (gate: () => boolean): void => { editable = gate; };

// quiet: don't report the outcome to the connection monitor (its own health checks).
export interface RequestOptions { body?: unknown; schema?: ZodType; timeoutMs?: number; fetchFn?: typeof fetch; quiet?: boolean }
const DEFAULT_TIMEOUT_MS = 15_000;

export async function request<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, options: RequestOptions = {}): Promise<T> {
  const edit = method !== 'GET';
  if (edit && !editable()) throw new ApiError('paused', NOT_SAVED.paused);
  const report = (outcome: RequestOutcome): void => { if (!options.quiet) reportOutcome(outcome); };
  let body = options.body;
  if (options.schema) {
    const parsed = options.schema.safeParse(body);
    if (!parsed.success) throw new ApiError('invalid', parsed.error.issues[0]?.message ?? 'Check the form and try again.');
    body = parsed.data;
  }
  let response: Response;
  try {
    response = await (options.fetchFn ?? fetch)(`/api/v1${path}`, {
      method, credentials: 'same-origin', signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
  } catch {
    report('unreachable');
    throw new ApiError('unreachable', edit ? NOT_SAVED.unreachable : "Can't reach Print Tally.");
  }
  // Every Print Tally API response is JSON; anything else (a dev proxy's error page, another app) means it isn't answering.
  const json: unknown = await response.json().catch(() => undefined);
  if (json === undefined || typeof json !== 'object' || json === null) {
    report('unreachable');
    throw new ApiError('unreachable', edit ? NOT_SAVED.unreachable : "Can't reach Print Tally.", response.status);
  }
  if (response.status === 401) {
    report('unauthorized');
    throw new ApiError('unauthorized', NOT_SAVED.unauthorized, 401, 'unauthorized');
  }
  report('ok');
  if (!response.ok) {
    const code = 'error' in json && typeof json.error === 'string' ? json.error : 'request_failed';
    throw new ApiError('rejected', errorMessage(code, edit), response.status, code);
  }
  return json as T;
}

// Shown wherever a printer request or its steady-state health hits a macOS Local Network privacy block
// (setup preview, the printer strip, Collect, Settings): the fix is the same System Settings toggle everywhere.
export const LOCAL_NETWORK_BLOCKED = 'macOS is blocking Print Tally from your local network. Turn on Print Tally in System Settings → Privacy & Security → Local Network, then try again. If it isn\'t listed, add it with the + button.';
// The server's error codes, in words. Screens may map a code to something more specific first.
const MESSAGES: Record<string, string> = {
  in_use: "It's still in use, so it can't be deleted.",
  fitting_conflict: 'That fitting conflicts with another cartridge or print.',
  printer_not_found: 'That printer no longer exists.',
  purchase_not_found: 'That purchase no longer exists.',
  channel_mismatch: 'That purchase is for another cartridge.',
  invalid_limit: 'Choose a valid number of prints.',
  already_exists: 'That already exists.',
  not_found: 'It no longer exists. It may have been deleted on another device.',
  job_not_found: 'That print no longer exists.',
  unknown_reference: 'Something it refers to no longer exists.',
  purchase_does_not_match_stock: 'Sheets are bought in packs and rolls by length. Check the quantity.',
  invalid_request: 'Check the form and try again.',
  invalid_printer_address: 'That isn\'t a printer address on this network.',
  discovery_failed: "Couldn't look for printers on the network.",
  printer_inspection_failed: "Couldn't reach the printer at that address.",
  local_network_blocked: LOCAL_NETWORK_BLOCKED,
  fingerprint_mismatch: "The printer's fingerprint changed. Start again.",
  preview_expired: 'That took too long. Start again.',
  printer_needs_password: 'The printer needs its password.',
  printer_needs_confirming: "The printer's certificate changed. Confirm it again under Settings.",
  printer_unreachable: "Can't reach the printer.",
  printer_local_network_blocked: LOCAL_NETWORK_BLOCKED,
  collection_failed: "Couldn't read the printer's log.",
  credential_store_failed: "Couldn't use the keychain.",
  printer_verification_failed: "The printer didn't pass the security check.",
  invalid_printer_root: "The printer's certificate isn't valid.",
  printer_identity_conflict: 'That address belongs to a different printer that is already set up.',
  preview_stale: 'Another device changed this printer meanwhile. Start again.',
  too_many_previews: 'Too many printers are being checked at once. Try again in a moment.',
  invalid_password: 'Enter the password.',
  known_printer_not_found: 'That printer is no longer set up.',
  invalid_printer_name: 'Enter a name of up to 120 characters.',
};
export const errorMessage = (code: string, edit = true): string =>
  (edit ? 'Not saved. ' : '') + (MESSAGES[code] ?? `The server refused it (${code.replace(/_/g, ' ')}).`);
/** A message for any error a query or mutation throws. */
export const describeError = (error: unknown): string => error instanceof Error ? error.message : 'Something went wrong.';
