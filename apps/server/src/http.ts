import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { annotationSchema, pairingCodeRequestSchema, pairingRedeemSchema, type PairingCodeResponse } from 'print-accounting-contracts';
import { Ledger, LedgerError } from 'print-accounting-database';
import type { AccountingService } from './service.ts';
import { PrinterEnrolment, EnrolmentError } from './printer-enrolment.ts';
import { CredentialError } from './credentials.ts';
import { CollectionError, type Collections } from './collections.ts';
import type { Sessions } from './sessions.ts';
import { allowedHosts, checkedHost, isLoopback, pairingLink, sessionCookie, sessionToken, systemNetwork, type Network } from './access.ts';
import { pairPage, staticFile } from './static.ts';
import { ledgerRoute } from './ledger-routes.ts';

export interface ApiOptions {
  enrolment: PrinterEnrolment; collections: Collections; sessions: Sessions;
  remote?: boolean; uiDirectory?: string; network?: Network;
  isLocal?: (address: string | undefined) => boolean; // Tests only: the peer address decides.
}
const securityHeaders = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' };
// Collection uses only confirmed printers. Only the onboarding routes accept validated private
// addresses and passwords; no route accepts file paths.
export function createApi(service: AccountingService, options: ApiOptions): Server {
  const { enrolment, collections, sessions, remote = false, network = systemNetwork, isLocal = isLoopback } = options;
  const ledger = new Ledger(service.db);
  const server = createServer(async (request, response) => {
    const send = (status: number, value: unknown, headers: Record<string, string> = {}): void => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...securityHeaders, ...headers });
      response.end(JSON.stringify(value));
    };
    try {
      const address = server.address(), port = typeof address === 'object' && address ? address.port : 0;
      const host = checkedHost(request, allowedHosts(port, remote, network));
      if (!host) return send(403, { error: 'origin_rejected' });
      const url = new URL(request.url ?? '/', 'http://' + host);
      const path = url.pathname, method = request.method;
      const local = isLocal(request.socket.remoteAddress);
      if (!path.startsWith('/api/')) return serveUi(response, method, path, options.uiDirectory);
      if (method === 'POST' && path === '/api/v1/pairing') {
        const token = sessions.redeem(pairingRedeemSchema.parse(await jsonBody(request)).code, request.headers['user-agent']);
        return token ? send(200, { paired: true }, { 'Set-Cookie': sessionCookie(token) }) : send(401, { error: 'pairing_invalid' });
      }
      if (!local) {
        const token = sessionToken(request);
        if (!token || !sessions.verify(token)) return send(401, { error: 'unauthorized' });
      }
      const page = (): [number, number] => {
        const limitText = url.searchParams.get('limit') ?? '100', offsetText = url.searchParams.get('offset') ?? '0';
        if (!/^\d+$/.test(limitText) || !/^\d+$/.test(offsetText)) throw new Error('Invalid pagination');
        const limit = Number(limitText), offset = Number(offsetText);
        if (limit < 1 || limit > 1000 || !Number.isSafeInteger(offset)) throw new Error('Invalid pagination');
        return [limit, offset];
      };
      const requireEmpty = async (): Promise<void> => {
        const body = await jsonBody(request);
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) throw new EnrolmentError('expected_empty_object');
      };
      // Pairing and sessions are managed from the host itself (`printtally pair`, `printtally sessions`).
      const sessionItem = /^\/api\/v1\/sessions\/([a-f0-9]{8})$/.exec(path);
      if (path === '/api/v1/pairing-codes' || path === '/api/v1/sessions' || sessionItem) {
        if (!local) return send(403, { error: 'local_only' });
        if (method === 'POST' && path === '/api/v1/pairing-codes') {
          if (!remote) return send(409, { error: 'remote_access_off' });
          const { code, expiresAt } = sessions.createPairing(pairingCodeRequestSchema.parse(await jsonBody(request)).label);
          const links = [...network.addresses(), ...network.names()].map(name => pairingLink(`http://${name}:${port}`, code));
          return send(201, { code, expiresAt, links } satisfies PairingCodeResponse);
        }
        if (method === 'GET' && path === '/api/v1/sessions') return send(200, { sessions: sessions.list() });
        if (method === 'DELETE' && sessionItem) return sessions.revoke(sessionItem[1]) ? send(200, { revoked: true }) : send(404, { error: 'session_not_found' });
        return send(404, { error: 'not_found' });
      }
      if (method === 'GET' && path === '/api/v1/health') return send(200, collections.health());
      if (method === 'POST' && path === '/api/v1/printer-discovery') { await requireEmpty(); return send(200, { printers: await enrolment.discover() }); }
      if (method === 'POST' && path === '/api/v1/printer-enrolments') return send(201, await enrolment.preview(await jsonBody(request)));
      const confirmation = /^\/api\/v1\/printer-enrolments\/([a-f0-9-]{36})\/confirm$/.exec(path);
      if (method === 'POST' && confirmation) {
        const printer = await enrolment.confirm(confirmation[1], await jsonBody(request));
        collections.confirmed(printer);
        return send(200, printer);
      }
      const preview = /^\/api\/v1\/printer-enrolments\/([a-f0-9-]{36})$/.exec(path);
      if (method === 'DELETE' && preview) { enrolment.cancel(preview[1]); return send(200, { cancelled: true }); }
      if (method === 'GET' && path === '/api/v1/known-printers') return send(200, { printers: enrolment.list() });
      const known = /^\/api\/v1\/known-printers\/([a-f0-9-]{36})\/(password|collect)$/.exec(path);
      if (known && method === 'PUT' && known[2] === 'password') {
        await enrolment.setPassword(known[1], await jsonBody(request));
        collections.passwordSaved(known[1]);
        return send(200, { saved: true });
      }
      if (known && method === 'POST' && known[2] === 'collect') {
        await requireEmpty();
        try { return send(200, await collections.collect(known[1])); }
        catch (error) {
          if (!(error instanceof CollectionError)) throw error;
          const needsUser = error.state === 'needs_password' || error.state === 'needs_confirming';
          return send(needsUser ? 409 : 502, { error: error.state === 'failed' ? 'collection_failed' : 'printer_' + error.state });
        }
      }
      if (method === 'GET' && path === '/api/v1/summary') return send(200, service.db.summary());
      if (method === 'GET' && path === '/api/v1/printers') return send(200, { printers: service.db.all('SELECT * FROM printers ORDER BY id') });
      if (method === 'GET' && path === '/api/v1/media') {
        const [limit, offset] = page();
        return send(200, { media: service.db.all('SELECT m.*,r.names_json,r.short_name,r.english_name FROM media_configs m LEFT JOIN media_revisions r ON r.id=m.current_revision_id ORDER BY m.id LIMIT ? OFFSET ?', limit, offset), limit, offset });
      }
      if (method === 'GET' && path === '/api/v1/imports') {
        const [limit, offset] = page();
        return send(200, { imports: service.db.all('SELECT id,printer_id,source,started_at,finished_at,status,received_count,new_jobs,new_observations,error_code FROM import_runs ORDER BY id DESC LIMIT ? OFFSET ?', limit, offset), limit, offset });
      }
      const annotation = /^\/api\/v1\/jobs\/(\d+)\/annotation$/.exec(path);
      if (method === 'PATCH' && annotation) {
        if (!service.db.get('SELECT id FROM print_jobs WHERE id=?', Number(annotation[1]))) return send(404, { error: 'job_not_found' });
        service.db.annotateJob(Number(annotation[1]), annotationSchema.parse(await jsonBody(request)));
        return send(200, ledger.job(Number(annotation[1])));
      }
      const reply = await ledgerRoute(ledger, method, url, page, () => jsonBody(request));
      if (reply) return send(...reply);
      return send(404, { error: 'not_found' });
    } catch (error) {
      if (response.headersSent) { response.destroy(); return; }
      if (error instanceof EnrolmentError || error instanceof LedgerError) send(error.status, { error: error.message });
      else if (error instanceof CredentialError) send(503, { error: 'credential_store_failed' });
      else send(400, { error: 'invalid_request' });
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  return server;
}
function serveUi(response: ServerResponse, method: string | undefined, path: string, root: string | undefined): void {
  if (method !== 'GET' && method !== 'HEAD') { response.writeHead(405, { Allow: 'GET, HEAD', ...securityHeaders }); response.end(); return; }
  const file = path === '/pair'
    ? { status: 200, type: 'text/html; charset=utf-8', cache: 'no-store', body: Buffer.from(pairPage) }
    : staticFile(root, path);
  response.writeHead(file.status, { 'Content-Type': file.type, 'Content-Length': file.body.length, 'Cache-Control': file.cache, ...securityHeaders });
  response.end(method === 'HEAD' ? undefined : file.body);
}
async function jsonBody(request: IncomingMessage): Promise<unknown> {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw new Error('Expected JSON');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const data of request) {
    size += data.length;
    if (size > 65536) throw new Error('Request body too large');
    chunks.push(data);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
