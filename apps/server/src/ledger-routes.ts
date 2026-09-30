import type { Ledger } from 'print-accounting-database';

// Papers, stock, purchases, write-offs, settings and costed jobs. Bodies are validated by the ledger's
// contracts; create returns the new id and clients refetch the read models.
type Reply = [number, unknown];
interface Collection { create(input: unknown): number; update(id: number, input: unknown): void; remove(id: number): void }
function collections(ledger: Ledger): Record<string, Collection> {
  return {
    papers: { create: input => ledger.createPaper(input), update: (id, input) => ledger.updatePaper(id, input), remove: id => ledger.deletePaper(id) },
    'paper-stocks': { create: input => ledger.createStock(input), update: (id, input) => ledger.updateStock(id, input), remove: id => ledger.deleteStock(id) },
    'paper-purchases': { create: input => ledger.createPaperPurchase(input), update: (id, input) => ledger.updatePaperPurchase(id, input), remove: id => ledger.deletePaperPurchase(id) },
    'ink-cartridges': { create: input => ledger.createCartridge(input), update: (id, input) => ledger.updateCartridge(id, input), remove: id => ledger.deleteCartridge(id) },
    'ink-purchases': { create: input => ledger.createInkPurchase(input), update: (id, input) => ledger.updateInkPurchase(id, input), remove: id => ledger.deleteInkPurchase(id) },
    'write-offs': { create: input => ledger.createWriteOff(input), update: (id, input) => ledger.updateWriteOff(id, input), remove: id => ledger.deleteWriteOff(id) },
  };
}
export async function ledgerRoute(ledger: Ledger, method: string | undefined, url: URL, page: () => [number, number], body: () => Promise<unknown>): Promise<Reply | undefined> {
  const path = url.pathname;
  if (method === 'GET' && path === '/api/v1/jobs') {
    const [limit, offset] = page(), hidden = url.searchParams.get('includeHidden') ?? 'false', q = url.searchParams.get('q') ?? undefined;
    if (!['false', 'true'].includes(hidden)) return [400, { error: 'invalid_visibility' }];
    if (q !== undefined && q.length > 200) return [400, { error: 'invalid_search' }];
    return [200, ledger.jobs({ q, includeHidden: hidden === 'true', limit, offset })];
  }
  const job = /^\/api\/v1\/jobs\/(\d{1,15})$/.exec(path);
  if (method === 'GET' && job) { const found = ledger.job(Number(job[1])); return found ? [200, found] : [404, { error: 'job_not_found' }]; }
  // How a job's paper would be costed with a correction (?paper_id= or ?paper_stock_id=), without saving it.
  const preview = /^\/api\/v1\/jobs\/(\d{1,15})\/allocation-preview$/.exec(path);
  if (method === 'GET' && preview) return [200, ledger.allocationPreview(Number(preview[1]), Object.fromEntries(url.searchParams))];
  if (method === 'GET' && path === '/api/v1/totals') return [200, ledger.totals()];
  if (method === 'GET' && path === '/api/v1/papers') return [200, ledger.papers()];
  if (method === 'GET' && path === '/api/v1/ink') return [200, ledger.ink()];
  if (method === 'GET' && path === '/api/v1/media-types') return [200, ledger.mediaTypes()];
  if (method === 'GET' && path === '/api/v1/settings') return [200, ledger.settings()];
  if (method === 'PATCH' && path === '/api/v1/settings') return [200, ledger.updateSettings(await body())];
  // A purchase created with what's new for it (stock item, paper, cartridge) in one transaction.
  if (method === 'POST' && path === '/api/v1/paper-purchases/setup') return [201, ledger.setupPaperPurchase(await body())];
  if (method === 'POST' && path === '/api/v1/ink-purchases/setup') return [201, ledger.setupInkPurchase(await body())];
  // A whole set: a purchase per cartridge, the price split by capacity, and any missing products, in one transaction.
  if (method === 'POST' && path === '/api/v1/ink-purchases/set') return [201, ledger.purchaseInkSet(await body())];
  if (method === 'GET' && path === '/api/v1/write-offs/preview') {
    const param = (name: string) => { const value = url.searchParams.get(name); return value === null ? undefined : Number(value); };
    return [200, ledger.writeOffPreview({ paper_stock_id: param('paper_stock_id'), ink_product_id: param('ink_product_id') }, url.searchParams.get('written_off_on') ?? '')];
  }
  const item = /^\/api\/v1\/([a-z-]+)(?:\/(\d{1,15}))?$/.exec(path), all = collections(ledger);
  const collection = item && Object.hasOwn(all, item[1]) ? all[item[1]] : undefined;
  if (!item || !collection) return undefined;
  const id = item[2] === undefined ? undefined : Number(item[2]);
  if (method === 'POST' && id === undefined) return [201, { id: collection.create(await body()) }];
  if (method === 'PATCH' && id !== undefined) { collection.update(id, await body()); return [200, { updated: true }]; }
  if (method === 'DELETE' && id !== undefined) { collection.remove(id); return [200, { deleted: true }]; }
  return undefined;
}
