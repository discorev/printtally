import type { CartridgeView, InkPurchaseView, InkResponse, WriteOffView } from 'print-accounting-contracts';
import { byChannelOrder, inkChannel, INK_CHANNELS } from '../../lib/inks.ts';

// The Ink screen has one row per ink channel. A channel usually has one cartridge product; when it has more
// (a larger size, say) their figures are added up, and the level is the one the ledger thinks is fitted.
export interface InkChannelView {
  code: string; name: string;
  cartridges: CartridgeView[];
  /** The product in the printer, else the first one set up; undefined when the channel has none yet. */
  product: CartridgeView | undefined;
  fitted: boolean; // Whether the ledger has a cartridge in the printer (some ink left).
  spares: number; used: number; usedMicros: number; wasteMicros: number; jobs: number;
  purchases: { purchase: InkPurchaseView; capacityNl: number }[]; // Newest first.
  writeOffs: WriteOffView[]; // Newest first.
}
const sum = (list: CartridgeView[], value: (c: CartridgeView) => number) => list.reduce((total, c) => total + value(c), 0);
const newest = (a: string, b: string) => b.localeCompare(a);

/** Every channel the printer has used or a cartridge is set up for, in cartridge order. */
export function inkChannels(data: InkResponse): InkChannelView[] {
  const codes = byChannelOrder([...new Set([...data.channels, ...data.cartridges.map(c => c.channel)])], code => code);
  return codes.map(code => {
    const cartridges = data.cartridges.filter(c => c.channel === code), fitted = cartridges.find(c => c.open_remaining_nl !== null);
    return {
      code, name: inkChannel(code).name, cartridges, product: fitted ?? cartridges[0], fitted: !!fitted,
      spares: sum(cartridges, c => c.spares), used: sum(cartridges, c => c.used), jobs: sum(cartridges, c => c.jobs),
      usedMicros: sum(cartridges, c => c.used_micros), wasteMicros: sum(cartridges, c => c.waste_micros),
      purchases: cartridges.flatMap(c => c.purchases.map(purchase => ({ purchase, capacityNl: c.capacity_nl })))
        .sort((a, b) => newest(a.purchase.purchased_on, b.purchase.purchased_on) || b.purchase.id - a.purchase.id),
      writeOffs: cartridges.flatMap(c => c.write_offs).sort((a, b) => newest(a.written_off_on, b.written_off_on) || b.id - a.id),
    };
  });
}

/** A PRO-1100 channel the ledger hasn't seen yet (no prints, no cartridge), so stock can be added from its docket. */
export const unseenChannel = (code: string): InkChannelView | undefined => INK_CHANNELS.some(ink => ink.code === code) ? {
  code, name: inkChannel(code).name, cartridges: [], product: undefined, fitted: false,
  spares: 0, used: 0, usedMicros: 0, wasteMicros: 0, jobs: 0, purchases: [], writeOffs: [],
} : undefined;

/** Channels a purchase can be for: the list's and any other PRO-1100 channel not seen yet, in cartridge order. */
export const purchasableChannels = (channels: InkChannelView[]): { code: string; name: string }[] =>
  byChannelOrder([...channels, ...INK_CHANNELS.filter(ink => !channels.some(c => c.code === ink.code))], c => c.code).map(({ code, name }) => ({ code, name }));

/** "PFI-1100" from the product "PFI-1100 MBK": the channel is already in the title. */
export const productName = (c: Pick<CartridgeView, 'name' | 'channel'>): string => c.name.replace(new RegExp(`\\s+${c.channel}$`), '') || c.name;
/** The cartridge in the printer's purchase, when the ledger knows it. */
export const fittedPurchase = (channel: InkChannelView): InkPurchaseView | undefined => {
  const product = channel.fitted ? channel.product : undefined;
  return product?.purchases.find(p => p.id === product.open_purchase_id);
};
