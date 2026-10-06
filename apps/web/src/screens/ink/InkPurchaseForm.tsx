import { useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import type { ArchivedPrinter } from 'print-accounting-contracts';
import { cartridgeSize, cartridgeTypes } from 'print-accounting-core/printer-models';
import { api } from '../../api/endpoints.ts';
import { describeError } from '../../api/client.ts';
import { useEdit } from '../../api/queries.ts';
import { Button, DateInput, DocketSection, Field, FieldPair, FieldStack, MoneyInput, NumberInput, RowActions, Select, StatusLine, TextInput } from '../../components/index.ts';
import { parseMoney, today } from '../../lib/format.ts';
import { productName, purchasableChannels, type InkChannelView } from './channels.ts';
import { useSelectedInkPrinter } from './useSelectedInkPrinter.ts';

const SET = '*';
const NEW = '__new__';
type TypeChoice = { series: string; sizeMl: number | null };

/** Known model types, bought products and reported types, with a product size as fallback. */
function typesFor(code: string, channels: InkChannelView[], printers: ArchivedPrinter[]): TypeChoice[] {
  const types = new Map<string, TypeChoice>();
  const add = (series: string | null, sizeMl: number | null) => {
    if (!series) return;
    const old = types.get(series);
    types.set(series, { series, sizeMl: old?.sizeMl ?? sizeMl });
  };
  for (const printer of printers) for (const type of cartridgeTypes(printer.model, code)) add(type.series, type.sizeMl);
  for (const channel of channels) if (channel.code === code) for (const product of channel.cartridges)
    add(productName(product), product.capacity_nl / 1e6);
  for (const printer of printers) add(printer.inks.find(ink => ink.channel === code)?.series ?? null, null);
  return [...types.values()];
}

/** For a set, the matching PRO-2600 MBK type has the same capacity but a different series. */
function setSeries(series: string, code: string): string {
  if (code !== 'MBK' || !cartridgeTypes('PRO-2600 series', 'C').some(type => type.series === series)) return series;
  const size = cartridgeSize(series);
  return cartridgeTypes('PRO-2600 series', code).find(type => type.sizeMl === size)?.series ?? series;
}

export function InkPurchaseForm({ channels, initial, onSaved, onCancel }: {
  channels: InkChannelView[]; initial?: string; onSaved: (channel?: string) => void; onCancel: () => void;
}) {
  const { printers, selected: printer } = useSelectedInkPrinter();
  const [code, setCode] = useState(initial ?? '');
  const [choice, setChoice] = useState<string | null>(null);
  const [date, setDate] = useState(today());
  const [count, setCount] = useState('1');
  const [price, setPrice] = useState('');
  const [name, setName] = useState('');
  const [size, setSize] = useState('');
  const set = code === SET, selectedCode = set ? (channels.find(c => c.code !== 'MBK')?.code ?? channels[0]?.code) : code;
  const types = set
    ? [...new Map((channels.some(item => item.code !== 'MBK') ? channels.filter(item => item.code !== 'MBK') : channels)
      .flatMap(item => typesFor(item.code, channels, printers))
      .map(item => [item.series, item])).values()]
    : typesFor(selectedCode ?? '', channels, printers);
  const channel = channels.find(c => c.code === code);
  const recent = (set ? channels : channel ? [channel] : []).flatMap(item => item.purchases.map(({ purchase }) => ({ purchase,
    product: item.cartridges.find(product => product.id === purchase.ink_product_id) })))
    .sort((a, b) => b.purchase.purchased_on.localeCompare(a.purchase.purchased_on) || b.purchase.id - a.purchase.id)[0]?.product;
  const reported = printer?.inks.find(ink => ink.channel === selectedCode)?.series;
  const latest = recent && productName(recent);
  const boughtSeries = set && recent?.channel === 'MBK' && latest && cartridgeTypes('PRO-2600 series', 'MBK').some(type => type.series === latest)
    ? cartridgeTypes('PRO-2600 series', 'C').find(type => type.sizeMl === cartridgeSize(latest))?.series : latest;
  const selectedSeries = choice ?? reported ?? boughtSeries ?? types[0]?.series ?? NEW;
  const isNew = selectedSeries === NEW;
  const series = isNew ? (set ? name.trim() : name.trim().replace(new RegExp(`\\s+${code}$`), '')) : selectedSeries;
  const typeSize = types.find(type => type.series === selectedSeries)?.sizeMl ?? cartridgeSize(selectedSeries);
  const capacityNl = Math.round(Number(isNew || !typeSize ? size : typeSize) * 1e6);
  const selectedProduct = channel?.cartridges.find(product => productName(product) === series);
  const products = set ? channels.map(item => {
    const type = setSeries(series, item.code);
    return { code: item.code, series: type, product: item.cartridges.find(p => productName(p) === type) };
  }) : [];
  const missing = products.filter(item => !item.product);
  const sets = Number(count), priceMicros = parseMoney(price);
  const ready = !!code && !!series && capacityNl > 0 && priceMicros !== null && /^\d{4}-\d\d-\d\d$/.test(date)
    && /^\d+$/.test(count) && sets > 0 && (set || !!selectedProduct || isNew || !!typeSize);

  const save = useEdit(async () => {
    if (set) {
      await api.purchaseInkSet({
        ink_product_ids: products.flatMap(item => item.product ? [item.product.id] : []),
        ...(missing.length ? { new_cartridges: { series, capacity_nl: capacityNl, channels: missing.map(item => item.code),
          names: Object.fromEntries(missing.map(item => [item.code, `${item.series} ${item.code}`])) } } : {}),
        purchased_on: date, sets, price_micros: priceMicros!,
      });
      return undefined;
    }
    await api.setupInkPurchase({
      ...(selectedProduct ? { ink_product_id: selectedProduct.id } : { cartridge: { name: isNew ? name.trim() : `${series} ${code}`, channel: code, capacity_nl: capacityNl } }),
      purchase: { purchased_on: date, cartridges: sets, price_micros: priceMicros! },
    });
    return code;
  });

  return (
    <DocketSection label="Add stock">
      <FieldStack>
        <Field label="Cartridge">{id => (
          <Select id={id} value={code} onChange={e => { setCode(e.target.value); setChoice(null); }}>
            <option value="">Choose a cartridge</option>
            {channels.length > 1 && <option value={SET}>All {channels.length} cartridges (a set)</option>}
            {purchasableChannels(channels).map(c => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
          </Select>
        )}</Field>
        {code && <FieldPair>
          <Field label="Type">{id => <Select id={id} value={selectedSeries} onChange={e => setChoice(e.target.value)}>
            {types.map(type => <option key={type.series} value={type.series}>{type.series}{type.sizeMl ? ` · ${type.sizeMl} ml` : ''}</option>)}
            <option value={NEW}>New type…</option>
          </Select>}</Field>
          <Field label={set ? 'Sets' : 'Cartridges'}>{id => <NumberInput id={id} min={1} value={count} onChange={e => setCount(e.target.value)} />}</Field>
        </FieldPair>}
        {code && (isNew || (!typeSize && !selectedProduct)) && <FieldPair>
          {isNew && <Field label={set ? 'Series' : 'Product'} hint={set
            ? `${missing.map(item => item.code).join(', ')} ${missing.length === 1 ? "isn't set up yet; it's" : "aren't set up yet; they're"} added with this purchase.`
            : "Not set up yet; it's added with this purchase."}>{id => <TextInput id={id} value={name} onChange={e => setName(e.target.value)} placeholder={set ? 'e.g. PFI-4100' : `e.g. PFI-4100 ${code}`} />}</Field>}
          <Field label="Size (ml)">{id => <NumberInput id={id} min={1} step="any" value={size} onChange={e => setSize(e.target.value)} />}</Field>
        </FieldPair>}
        <FieldPair>
          <Field label="Date">{id => <DateInput id={id} value={date} onChange={e => setDate(e.target.value)} />}</Field>
          <Field label="Price paid" hint={set && `For ${sets > 1 ? `the ${sets} sets` : 'the whole set'}, split by cartridge size.`}>{id => <MoneyInput id={id} value={price} onChange={e => setPrice(e.target.value)} />}</Field>
        </FieldPair>
        <RowActions className="mt-0">
          <Button variant="primary" edit disabled={!ready || save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onSaved })}>
            {save.isPending ? 'Saving…' : 'Add stock'}</Button>
          <Button variant="text" onClick={onCancel}>Cancel</Button>
        </RowActions>
        {save.isError && <StatusLine error>{describeError(save.error)}</StatusLine>}
      </FieldStack>
    </DocketSection>
  );
}

/** Shows a saved purchase: its cartridge's docket, or for a whole set Add stock's, each with the confirmation. */
export function useShowAdded(): (channel?: string) => void {
  const navigate = useNavigate(), { printer } = useSearch({ from: '/_app/ink' });
  return channel => void (channel
    ? navigate({ to: '/ink/$channel', params: { channel }, search: { printer, form: 'added' } })
    : navigate({ to: '/ink/new', search: { printer, form: 'added' } }));
}
