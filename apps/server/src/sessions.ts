import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { secureWrite } from 'print-accounting-ivec/files';
import type { PairedSession } from 'print-accounting-contracts';

// Pairing codes and session tokens are 256-bit random secrets; only their SHA-256 is kept, in
// memory (codes) or the private data folder (sessions). A code works once and expires in 5 minutes.
export const PAIRING_TTL_MS = 5 * 60 * 1000;
const MAX_PENDING = 20, TOUCH_MS = 60 * 60 * 1000;
const secret = (): string => randomBytes(32).toString('base64url');
const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
const storedSchema = z.object({ id: z.string(), hash: z.string().regex(/^[a-f0-9]{64}$/), label: z.string(), userAgent: z.string().nullable(), createdAt: z.string(), lastSeenAt: z.string() });
const fileSchema = z.object({ version: z.literal(1), sessions: z.array(storedSchema) });
type Stored = z.infer<typeof storedSchema>;
export class Sessions {
  private file: string | undefined;
  private clock: () => number;
  private sessions = new Map<string, Stored>();
  private pending = new Map<string, { label: string; expires: number }>();
  private saved = new Map<string, string>();
  constructor(file?: string, clock: () => number = Date.now) {
    this.file = file; this.clock = clock;
    // An unreadable file fails closed: every device pairs again.
    let stored: Stored[] = [];
    try { if (file && existsSync(file)) stored = fileSchema.parse(JSON.parse(readFileSync(file, 'utf8'))).sessions; } catch { stored = []; }
    for (const session of stored) { this.sessions.set(session.hash, session); this.saved.set(session.hash, session.lastSeenAt); }
  }
  private now(): string { return new Date(this.clock()).toISOString(); }
  private save(): void {
    if (this.file) secureWrite(this.file, JSON.stringify({ version: 1, sessions: [...this.sessions.values()] }, null, 2) + '\n');
    this.saved = new Map([...this.sessions.values()].map(session => [session.hash, session.lastSeenAt]));
  }
  createPairing(label = 'Paired device'): { code: string; expiresAt: string } {
    const now = this.clock();
    for (const [key, item] of this.pending) if (item.expires <= now) this.pending.delete(key);
    if (this.pending.size >= MAX_PENDING) throw new Error('Too many pairing codes');
    const code = secret(), expires = now + PAIRING_TTL_MS;
    this.pending.set(digest(code), { label, expires });
    return { code, expiresAt: new Date(expires).toISOString() };
  }
  // Returns a new session token, or undefined for an unknown, used or expired code.
  redeem(code: string, userAgent?: string): string | undefined {
    const key = digest(code), pending = this.pending.get(key);
    this.pending.delete(key);
    if (!pending || pending.expires <= this.clock()) return undefined;
    const token = secret(), ids = new Set([...this.sessions.values()].map(session => session.id));
    let id: string;
    do id = randomBytes(4).toString('hex'); while (ids.has(id));
    const now = this.now();
    this.sessions.set(digest(token), { id, hash: digest(token), label: pending.label, userAgent: userAgent?.slice(0, 200) ?? null, createdAt: now, lastSeenAt: now });
    this.save();
    return token;
  }
  verify(token: string): boolean {
    const session = this.sessions.get(digest(token));
    if (!session) return false;
    session.lastSeenAt = this.now();
    if (this.clock() - Date.parse(this.saved.get(session.hash) ?? session.createdAt) > TOUCH_MS) this.save();
    return true;
  }
  list(): PairedSession[] { return [...this.sessions.values()].map(({ hash: _hash, ...session }) => session); }
  revoke(id: string): boolean {
    const session = [...this.sessions.values()].find(item => item.id === id);
    if (!session) return false;
    this.sessions.delete(session.hash); this.save();
    return true;
  }
}
