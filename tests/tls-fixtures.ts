import 'reflect-metadata';
import * as x509 from '@peculiar/x509';

export interface TlsLeaf { cert: string; key: string; }
export interface TlsFixtures {
  root: string;
  otherRoot: string;
  leaves: { server: TlsLeaf; changed: TlsLeaf; 'wrong-host': TlsLeaf; expired: TlsLeaf };
}

const signingAlgorithm = { name: 'ECDSA', hash: 'SHA-256' };
const DAY = 24 * 60 * 60 * 1000;

function generateKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
}

// Matches node:crypto's own PEM serialization exactly (trailing newline included),
// since production code round-trips certificates through X509Certificate.toString().
function pem(tag: string, data: ArrayBuffer): string {
  const base64 = Buffer.from(data).toString('base64');
  const body = (base64.match(/.{1,64}/g) ?? []).join('\n');
  return `-----BEGIN ${tag}-----\n${body}\n-----END ${tag}-----\n`;
}
const certPem = (cert: x509.X509Certificate): string => pem(x509.PemConverter.CertificateTag, cert.rawData);

async function selfSignedRoot(name: string): Promise<{ cert: string; privateKey: CryptoKey }> {
  const keys = await generateKeyPair();
  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    name: `CN=${name}`,
    notBefore: new Date(Date.now() - 60_000),
    notAfter: new Date(Date.now() + 10 * 365 * DAY),
    signingAlgorithm,
    keys,
    extensions: [
      new x509.BasicConstraintsExtension(true, undefined, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign, true),
    ],
  });
  return { cert: certPem(cert), privateKey: keys.privateKey };
}

async function leaf(options: { name: string; issuer: string; signingKey: CryptoKey; ip: string; notBefore: Date; notAfter: Date }): Promise<TlsLeaf> {
  const keys = await generateKeyPair();
  const cert = await x509.X509CertificateGenerator.create({
    subject: `CN=${options.name}`, issuer: `CN=${options.issuer}`,
    publicKey: keys.publicKey, signingKey: options.signingKey,
    notBefore: options.notBefore, notAfter: options.notAfter,
    signingAlgorithm,
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature | x509.KeyUsageFlags.keyEncipherment, true),
      new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.serverAuth]),
      new x509.SubjectAlternativeNameExtension([{ type: 'ip', value: options.ip }]),
    ],
  });
  return { cert: certPem(cert), key: pem(x509.PemConverter.PrivateKeyTag, await crypto.subtle.exportKey('pkcs8', keys.privateKey)) };
}

// Generates the full fixture set once per test process (each test file runs in its own process).
let cached: Promise<TlsFixtures> | undefined;
export function tlsFixtures(): Promise<TlsFixtures> {
  return (cached ??= build());
}

async function build(): Promise<TlsFixtures> {
  const now = Date.now(), notBefore = new Date(now - 60_000), notAfter = new Date(now + 10 * 365 * DAY);
  const rootName = 'Public test printer root';
  const root = await selfSignedRoot(rootName);
  const otherRoot = await selfSignedRoot('Unrelated test printer root');
  const withRoot = (name: string, ip: string, from = notBefore, to = notAfter) => leaf({ name, issuer: rootName, signingKey: root.privateKey, ip, notBefore: from, notAfter: to });
  const leaves: TlsFixtures['leaves'] = {
    server: await withRoot('Public test printer server', '127.0.0.1'),
    changed: await withRoot('Public test printer server (renewed)', '127.0.0.1'),
    'wrong-host': await withRoot('Public test printer wrong host', '192.0.2.10'),
    expired: await withRoot('Public test printer expired', '127.0.0.1', new Date(now - 2 * DAY), new Date(now - DAY)),
  };
  return { root: root.cert, otherRoot: otherRoot.cert, leaves };
}
