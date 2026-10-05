import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { api } from '../../api/endpoints.ts';
import { describeError } from '../../api/client.ts';
import { useEdit } from '../../api/queries.ts';
import { Button, DateInput, DocketSection, Field, FieldPair, FieldStack, MoneyInput, NumberInput, RowActions, Select, StatusLine, TextInput } from '../../components/index.ts';
import { parseMoney, today } from '../../lib/format.ts';
import { commonCapacity, inkSet, productName, purchasableChannels, type InkChannelView } from './channels.ts';

const SET = '*'; // The Cartridge choice for a whole set: one of every channel in the list.

/**
 * Adding stock (vInkPurchaseForm): cartridges bought for a channel, on a date, for a price. A channel with no
 * cartridge set up yet asks for the product's name and size too, and it's created with the purchase (all or
 * nothing). A whole set is a purchase for every channel in the list, its price split by the server; channels
 * with no product ask for the series and size once. `onSaved` runs only once the server confirmed it, with the
 * channel, or nothing for a set.
 */
export function InkPurchaseForm({ channels, initial, onSaved, onCancel }: {
  channels: InkChannelView[]; initial?: string; onSaved: (channel?: string) => void; onCancel: () => void;
}) {
  const [code, setCode] = useState(initial ?? '');
  const [date, setDate] = useState(today());
  const [count, setCount] = useState('1');
  const [price, setPrice] = useState('');
  // A new product is named after an existing one ("PFI-4100 PM") and assumed the size most are.
  const model = channels.find(c => c.product)?.product, capacity = commonCapacity(channels);
  const [name, setName] = useState<string | null>(null);
  const [series, setSeries] = useState(model ? productName(model) : '');
  const [size, setSize] = useState(capacity ? String(capacity / 1e6) : '');

  const set = code === SET, { productIds, missing } = inkSet(channels), sets = Number(count);
  const product = channels.find(c => c.code === code)?.product;
  const priceMicros = parseMoney(price), capacityNl = Math.round(Number(size) * 1e6);
  const newName = name ?? (model && code ? `${productName(model)} ${code}` : '');
  const ready = code !== '' && priceMicros !== null && /^\d{4}-\d\d-\d\d$/.test(date) && /^\d+$/.test(count) && sets > 0
    && (set ? missing.length === 0 || (series.trim() !== '' && capacityNl > 0) : !!product || (newName.trim() !== '' && capacityNl > 0));

  // New cartridge products are created with their purchases in one request, so a failure leaves nothing to retry around.
  const save = useEdit(async () => {
    if (set) {
      await api.purchaseInkSet({
        ink_product_ids: productIds, ...missing.length ? { new_cartridges: { series: series.trim(), capacity_nl: capacityNl, channels: missing } } : {},
        purchased_on: date, sets, price_micros: priceMicros!,
      });
      return undefined;
    }
    await api.setupInkPurchase({
      ...product ? { ink_product_id: product.id } : { cartridge: { name: newName.trim(), channel: code, capacity_nl: capacityNl } },
      purchase: { purchased_on: date, cartridges: sets, price_micros: priceMicros! },
    });
    return code;
  });

  return (
    <DocketSection label="Add stock">
      <FieldStack>
        <Field label="Cartridge">{id => (
          <Select id={id} value={code} onChange={e => setCode(e.target.value)}>
            <option value="">Choose a cartridge</option>
            {channels.length > 1 && <option value={SET}>All {channels.length} cartridges (a set)</option>}
            {purchasableChannels(channels).map(c => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
          </Select>
        )}</Field>
        {code && !set && !product && (
          <FieldPair>
            <Field label="Product" hint="Not set up yet; it's added with this purchase.">{id => (
              <TextInput id={id} value={newName} onChange={e => setName(e.target.value)} placeholder={`e.g. PFI-4100 ${code}`} />
            )}</Field>
            <Field label="Size (ml)">{id => <NumberInput id={id} min={1} step="any" value={size} onChange={e => setSize(e.target.value)} />}</Field>
          </FieldPair>
        )}
        {set && missing.length > 0 && (
          <FieldPair>
            <Field label="Series" hint={`${missing.join(', ')} ${missing.length === 1 ? "isn't set up yet; it's" : "aren't set up yet; they're"} added with this purchase.`}>{id => (
              <TextInput id={id} value={series} onChange={e => setSeries(e.target.value)} placeholder="e.g. PFI-4100" />
            )}</Field>
            <Field label="Size (ml)">{id => <NumberInput id={id} min={1} step="any" value={size} onChange={e => setSize(e.target.value)} />}</Field>
          </FieldPair>
        )}
        <FieldPair>
          <Field label="Date">{id => <DateInput id={id} value={date} onChange={e => setDate(e.target.value)} />}</Field>
          <Field label={set ? 'Sets' : 'Cartridges'}>{id => <NumberInput id={id} min={1} value={count} onChange={e => setCount(e.target.value)} />}</Field>
        </FieldPair>
        <Field label="Price paid" hint={set && `For ${sets > 1 ? `the ${sets} sets` : 'the whole set'}, split by cartridge size.`}>{id => (
          <MoneyInput id={id} className="max-w-[180px]" value={price} onChange={e => setPrice(e.target.value)} />
        )}</Field>
        <div>
          <RowActions className="mt-0">
            <Button variant="primary" edit disabled={!ready || save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onSaved })}>
              {save.isPending ? 'Saving…' : 'Add stock'}</Button>
            <Button variant="text" onClick={onCancel}>Cancel</Button>
          </RowActions>
          {save.isError && <StatusLine error>{describeError(save.error)}</StatusLine>}
        </div>
      </FieldStack>
    </DocketSection>
  );
}

/** Shows a saved purchase: its cartridge's docket, or for a whole set Add stock's, each with the confirmation. */
export function useShowAdded(): (channel?: string) => void {
  const navigate = useNavigate();
  return channel => void (channel
    ? navigate({ to: '/ink/$channel', params: { channel }, search: { form: 'added' } })
    : navigate({ to: '/ink/new', search: { form: 'added' } }));
}
