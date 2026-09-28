import { get } from 'node:https';
import { X509Certificate } from 'node:crypto';
import { isIPv4 } from 'node:net';
import { probe } from 'print-accounting-ivec';
import { canonicalMac, resolveMac } from 'print-accounting-ivec/protocol';
export interface InspectedPrinter { rootCertificatePem: string; mac: string | null }
// Bootstrap only: fetch public certificate bytes before identity is confirmed.
// Fixed HTTPS path, no redirects, credentials, cookies, IVEC authentication or
// caller-controlled headers. Returned certificates are candidates, never trust.
export async function downloadPrinterRoot(host: string, port = 443): Promise<string> {
  if (!isIPv4(host)) throw new Error('Expected IPv4');
  return new Promise((resolve, reject) => {
    const fail = (): void => reject(new Error('Printer root download failed'));
    const request = get({ host, port, path: '/cert_root.der', agent: false,
      rejectUnauthorized: false, minVersion: 'TLSv1.2', signal: AbortSignal.timeout(10000),
      headers: { Accept: 'application/pkix-cert, application/octet-stream' } }, response => {
      if (response.statusCode !== 200) { response.destroy(); fail(); return; }
      const chunks: Buffer[] = []; let size = 0;
      response.on('error', fail);
      response.on('data', (data: Buffer) => {
        size += data.length;
        if (size > 65536) { response.destroy(); fail(); return; }
        chunks.push(data);
      });
      response.on('end', () => {
        try {
          const root = new X509Certificate(Buffer.concat(chunks));
          if (!root.ca || root.subject !== root.issuer || !root.verify(root.publicKey)) throw new Error('Not a root CA');
          resolve(root.toString());
        } catch { fail(); }
      });
    });
    request.on('error', fail);
  });
}
export async function verifyPrinter(host: string, rootCertificatePem: string): Promise<void> {
  // Normal chain/expiry/address validation using the candidate root. This checks
  // compatibility without fetching a password; user confirmation is still needed.
  const result = await probe(host, rootCertificatePem);
  if (result.authType !== 'type1') throw new Error('Unsupported printer authentication');
}
export async function inspectPrinter(host: string, mac?: string): Promise<InspectedPrinter> {
  const rootCertificatePem = await downloadPrinterRoot(host);
  await verifyPrinter(host, rootCertificatePem);
  let resolved: string | null = mac ? canonicalMac(mac) : null;
  if (!resolved) { try { resolved = resolveMac(host); } catch { /* Optional on other OSes/routed networks. */ } }
  return { rootCertificatePem, mac: resolved };
}
