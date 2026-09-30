// Display formatting only. Every amount comes from the API; nothing here works out a cost.
// Money is integer micros of the ledger's currency; ink is nanolitres; roll lengths and sizes are micrometres.

const moneyFormats = new Map<string, Intl.NumberFormat>();
const moneyFormat = (currency: string): Intl.NumberFormat => {
  let format = moneyFormats.get(currency);
  if (!format) moneyFormats.set(currency, format = new Intl.NumberFormat('en-GB', { style: 'currency', currency }));
  return format;
};
/** "£1.86"; an unknown (null) amount is "—". */
export const money = (micros: number | null, currency: string): string => micros === null ? '—' : moneyFormat(currency).format(micros / 1e6);
/** The currency's symbol, e.g. "£" (the cost table's column heading and the price placeholder). */
export const currencySymbol = (currency: string): string =>
  moneyFormat(currency).formatToParts(0).find(part => part.type === 'currency')?.value ?? currency;
/** A typed price ("£37.99", "1,200", "37.9") as integer micros; null when it isn't a positive amount. */
export function parseMoney(text: string): number | null {
  const clean = text.replace(/[^\d.,-]/g, '').replace(/,/g, '');
  if (!/^\d+(\.\d{0,2})?$|^\.\d{1,2}$/.test(clean)) return null;
  const micros = Math.round(Number(clean) * 100) * 10_000;
  return micros > 0 ? micros : null;
}
/** Micros as the plain number a price field shows, e.g. 37990000 → "37.99". */
export const moneyInput = (micros: number): string => (micros / 1e6).toFixed(2);

export const plural = (n: number, word: string, many = word + 's'): string => `${n.toLocaleString('en-GB')} ${n === 1 ? word : many}`;
export const count = (n: number): string => n.toLocaleString('en-GB');

/** Ink: "0.94" (2 dp by default); ml() adds the unit. */
export const mlValue = (nl: number, digits = 2): string => (nl / 1e6).toFixed(digits);
export const ml = (nl: number | null, digits = 2): string => nl === null ? '—' : `${mlValue(nl, digits)} ml`;
/** Roll length: "10.5 m" (1 dp by default). */
export const metres = (um: number, digits = 1): string => `${(um / 1e6).toFixed(digits)} m`;
/** A stock quantity in its own unit: sheets are counted, rolls are micrometres. */
export const stockQuantity = (quantity: number, format: 'sheet' | 'roll', digits = 1): string =>
  format === 'roll' ? metres(quantity, digits) : plural(quantity, 'sheet');
/** A bare stock figure, no unit word: "31" (sheets), or "10.50 m" for a roll (the paper docket's stock rows). */
export const stockAmount = (quantity: number, format: 'sheet' | 'roll', digits = 2): string =>
  format === 'roll' ? metres(quantity, digits) : count(quantity);
/** Millimetres for a size readout: 210000 → "210", 101600 → "101.6". */
export const mm = (um: number): string => String(Math.round(um / 100) / 10);

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOWL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const parts = (day: string) => {
  const [y, m, d] = day.slice(0, 10).split('-').map(Number);
  return { y, m, d, dow: new Date(y, m - 1, d).getDay() };
};
/** Dates are the ledger's YYYY-MM-DD days (or ISO timestamps, whose date part is used). */
export const dateShort = (day: string): string => { const p = parts(day); return `${p.d} ${MON[p.m - 1]} ${p.y}`; }; // 12 Sep 2026
export const dateDay = (day: string): string => { const p = parts(day); return `${DOW[p.dow]} ${p.d}`; }; // Sat 12
export const dateLong = (day: string): string => { const p = parts(day); return `${DOWL[p.dow]} ${p.d} ${MONL[p.m - 1]} ${p.y}`; }; // Saturday 12 September 2026
export const dateMedium = (day: string): string => { const p = parts(day); return `${DOW[p.dow]} ${p.d} ${MON[p.m - 1]} ${p.y}`; }; // Sat 12 Sep 2026
export const monthLong = (day: string): string => { const p = parts(day); return `${MONL[p.m - 1]} ${p.y}`; }; // September 2026
export const monthShort = (day: string): string => { const p = parts(day); return `${MON[p.m - 1]} ${p.y}`; }; // Sep 2026
/** Today as a ledger day in local time, e.g. for a purchase form's default date. */
export const today = (now = new Date()): string =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
/** A local clock time from an ISO timestamp: "10:20". */
export const clock = (iso: string): string => { const at = new Date(iso); return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`; };
/** "Mon 28 Sep 2026, 10:20" from an ISO timestamp, in local time. */
export const dateTime = (iso: string): string => `${dateMedium(today(new Date(iso)))}, ${clock(iso)}`;

// The printer's own times are local YYYYMMDDHHMMSS text (job started_at_raw / completed_at_raw).
const printer = (raw: string | null) => raw && /^(\d{8})(\d\d)(\d\d)(\d\d)$/.exec(raw);
/** "17:12", or "" when the printer gave no time. */
export const printerTime = (raw: string | null): string => { const m = printer(raw); return m ? `${m[2]}:${m[3]}` : ''; };
/** "17:12:46". */
export const printerTimeFull = (raw: string | null): string => { const m = printer(raw); return m ? `${m[2]}:${m[3]}:${m[4]}` : ''; };
const seconds = (raw: string | null): number | null => {
  const m = printer(raw);
  return m ? Date.UTC(+m[1].slice(0, 4), +m[1].slice(4, 6) - 1, +m[1].slice(6, 8), +m[2], +m[3], +m[4]) / 1000 : null;
};
/** "4 min 25 s" between two printer times; "" when either is missing. */
export function duration(startRaw: string | null, endRaw: string | null): string {
  const start = seconds(startRaw), end = seconds(endRaw);
  if (start === null || end === null || end < start) return '';
  const s = end - start;
  return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
}
