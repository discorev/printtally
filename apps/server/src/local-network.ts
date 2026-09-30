import { isIPv4 } from 'node:net';

// macOS's Local Network privacy silently refuses outbound connections to LAN addresses until the user
// grants access (System Settings -> Privacy & Security -> Local Network). Bun/Node surface that refusal
// as a connection error that reads like the printer is offline, so this narrows to the one combination
// that is actually macOS blocking us: darwin, a private-network target, and a host-unreachable error.
function isPrivateIPv4(host: string): boolean {
  if (!isIPv4(host)) return false;
  const [a, b] = host.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}
// EHOSTUNREACH is 65 on darwin; Node reports it as error.code, but Bun's socket layer has been seen to
// only set errno (positive or negated, depending on the path) or leave it in strerror's "No route to
// host" wording, so all three forms count. Never inspect or forward anything else from the error.
function isHostUnreachable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, errno, message } = error as { code?: unknown; errno?: unknown; message?: unknown };
  if (code === 'EHOSTUNREACH') return true;
  if (errno === 65 || errno === -65) return true;
  return typeof message === 'string' && /no route to host/i.test(message);
}
// error may be wrapped with `{ cause }` (see downloadPrinterRoot) to keep the raw error from crossing
// into a thrown EnrolmentError/PrinterState; unwrap one level so callers can pass either form through.
export function isLocalNetworkBlocked(host: string, error: unknown, platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== 'darwin' || !isPrivateIPv4(host)) return false;
  const cause = error instanceof Error && error.cause !== undefined ? error.cause : error;
  return isHostUnreachable(cause);
}
