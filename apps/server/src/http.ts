import { createServer, type IncomingMessage, type Server } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { API_VERSION, annotationSchema, jobDetailsSchema, type CollectOptions } from 'print-accounting-contracts';
import { AccountingService, CollectionBusyError } from './service.ts';
import { PrinterEnrolment, EnrolmentError } from './printer-enrolment.ts';
import { CredentialError } from './credentials.ts';

// Collection uses configured or explicitly enrolled printers. Only the onboarding
// routes accept validated private addresses and passwords; no route accepts file paths.
export function createApi(service: AccountingService, token: string, collectOptions: CollectOptions | undefined, enrolment?: PrinterEnrolment): Server {
  if (token.length < 32) throw new Error('API token must contain at least 32 characters');
  const tokenBuffer = Buffer.from('Bearer ' + token);
  const server = createServer(async (request, response) => {
    const send = (status: number, value: unknown): void => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(JSON.stringify(value));
    };
    try {
      const address = server.address();
      const host = typeof address === 'object' && address ? '127.0.0.1:' + address.port : '';
      // Prevent cross-origin browser requests and DNS rebinding to a local backend.
      if (request.headers.host !== host || (request.headers.origin && request.headers.origin !== 'http://' + host)) return send(403, { error: 'origin_rejected' });
      const supplied = Buffer.from(request.headers.authorization ?? '');
      if (supplied.length !== tokenBuffer.length || !timingSafeEqual(supplied, tokenBuffer)) return send(401, { error: 'unauthorized' });
      const url = new URL(request.url ?? '/', 'http://' + host);
      const path = url.pathname, method = request.method;
      const page = (): [number, number] => {
        const limitText = url.searchParams.get('limit') ?? '100', offsetText = url.searchParams.get('offset') ?? '0';
        if (!/^\d+$/.test(limitText) || !/^\d+$/.test(offsetText)) throw new Error('Invalid pagination');
        const limit = Number(limitText), offset = Number(offsetText);
        if (limit < 1 || limit > 1000 || !Number.isSafeInteger(offset)) throw new Error('Invalid pagination');
        return [limit, offset];
      };
      if (enrolment) {
        const requireEmpty = async (): Promise<void> => {
          const body = await jsonBody(request);
          if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) throw new EnrolmentError('expected_empty_object');
        };
        if (method === 'POST' && path === '/api/v1/printer-discovery') { await requireEmpty(); return send(200, { printers: await enrolment.discover() }); }
        if (method === 'POST' && path === '/api/v1/printer-enrolments') return send(201, await enrolment.preview(await jsonBody(request)));
        const confirmation = /^\/api\/v1\/printer-enrolments\/([a-f0-9-]{36})\/confirm$/.exec(path);
        if (method === 'POST' && confirmation) return send(200, await enrolment.confirm(confirmation[1], await jsonBody(request)));
        const preview = /^\/api\/v1\/printer-enrolments\/([a-f0-9-]{36})$/.exec(path);
        if (method === 'DELETE' && preview) { enrolment.cancel(preview[1]); return send(200, { cancelled: true }); }
        if (method === 'GET' && path === '/api/v1/known-printers') return send(200, { printers: enrolment.list() });
        const known = /^\/api\/v1\/known-printers\/([a-f0-9-]{36})\/(password|collect)$/.exec(path);
        if (known && method === 'PUT' && known[2] === 'password') { await enrolment.setPassword(known[1], await jsonBody(request)); return send(200, { saved: true }); }
        if (known && method === 'POST' && known[2] === 'collect') {
          await requireEmpty();
          const selected = enrolment.collection(known[1]);
          try { const { result } = await service.collect(selected.options, undefined, selected.getPassword); return send(200, result); }
          catch (error) { return send(error instanceof CollectionBusyError ? 409 : 502, { error: error instanceof CollectionBusyError ? 'collection_busy' : 'collection_failed' }); }
        }
      }
      if (method === 'GET' && path === '/api/v1/health') return send(200, { apiVersion: API_VERSION, collecting: service.busy });
      if (method === 'GET' && path === '/api/v1/summary') return send(200, service.db.summary());
      if (method === 'GET' && path === '/api/v1/printers') return send(200, { printers: service.db.all('SELECT * FROM printers ORDER BY id') });
      if (method === 'GET' && path === '/api/v1/jobs') {
        const [limit, offset] = page();
        const hidden = url.searchParams.get('includeHidden') ?? 'false';
        if (!['false', 'true'].includes(hidden)) return send(400, { error: 'invalid_visibility' });
        return send(200, { jobs: service.db.jobs(limit, offset, hidden === 'true'), limit, offset });
      }
      if (method === 'GET' && path === '/api/v1/media') {
        const [limit, offset] = page();
        return send(200, { media: service.db.all('SELECT m.*,r.names_json,r.short_name,r.english_name FROM media_configs m LEFT JOIN media_revisions r ON r.id=m.current_revision_id ORDER BY m.id LIMIT ? OFFSET ?', limit, offset), limit, offset });
      }
      if (method === 'GET' && path === '/api/v1/imports') {
        const [limit, offset] = page();
        return send(200, { imports: service.db.all('SELECT id,printer_id,source,started_at,finished_at,status,received_count,new_jobs,new_observations,error_code FROM import_runs ORDER BY id DESC LIMIT ? OFFSET ?', limit, offset), limit, offset });
      }
      const job = /^\/api\/v1\/jobs\/(\d+)$/.exec(path);
      if (method === 'GET' && job) {
        const row = service.db.get('SELECT * FROM job_details WHERE job_id=?', Number(job[1]));
        if (!row) return send(404, { error: 'job_not_found' });
        const ink = service.db.all('SELECT u.channel,u.volume_nl FROM job_ink_usage u JOIN print_jobs j ON j.current_observation_id=u.observation_id WHERE j.id=?', Number(job[1]));
        return send(200, { job: jobDetailsSchema.parse(row), ink });
      }
      const annotation = /^\/api\/v1\/jobs\/(\d+)\/annotation$/.exec(path);
      if (method === 'PATCH' && annotation) {
        if (!service.db.get('SELECT id FROM print_jobs WHERE id=?', Number(annotation[1]))) return send(404, { error: 'job_not_found' });
        service.db.annotateJob(Number(annotation[1]), annotationSchema.parse(await jsonBody(request)));
        return send(200, { job: service.db.get('SELECT * FROM job_details WHERE job_id=?', Number(annotation[1])) });
      }
      if (method === 'POST' && path === '/api/v1/collect') {
        if (!collectOptions) return send(409, { error: 'printer_not_configured' });
        // Always collect the server's configured printer; never accept request options.
        const body = await jsonBody(request);
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) return send(400, { error: 'expected_empty_object' });
        try { const { result } = await service.collect(collectOptions); return send(200, result); }
        catch (error) { return send(error instanceof CollectionBusyError ? 409 : 502, { error: error instanceof CollectionBusyError ? 'collection_busy' : 'collection_failed' }); }
      }
      return send(404, { error: 'not_found' });
    } catch (error) {
      if (error instanceof EnrolmentError) send(error.status, { error: error.message });
      else if (error instanceof CredentialError) send(503, { error: 'credential_store_failed' });
      else send(400, { error: 'invalid_request' });
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  return server;
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
