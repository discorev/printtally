import { useState } from 'react';
import { api } from '../../api/endpoints.ts';
import { describeError } from '../../api/client.ts';
import { useEdit } from '../../api/queries.ts';
import { Button, DateInput, DocketSection, Field, FieldPair, FieldStack, MoneyInput, NumberInput, RowActions, Select, StatusLine, TextInput } from '../../components/index.ts';
import { parseMoney, today } from '../../lib/format.ts';
import { productName, purchasableChannels, type InkChannelView } from './channels.ts';

/**
 * Adding stock (vInkPurchaseForm): cartridges bought for a channel, on a date, for a price. A channel with no
 * cartridge set up yet asks for the product's name and size too, and it's created with the purchase (all or
 * nothing). `onSaved` runs only once the server confirmed it.
 */
export function InkPurchaseForm({ channels, initial, onSaved, onCancel }: {
  channels: InkChannelView[]; initial?: string; onSaved: (channel: string) => void; onCancel: () => void;
}) {
  const [code, setCode] = useState(initial ?? '');
  const [date, setDate] = useState(today());
  const [count, setCount] = useState('1');
  const [price, setPrice] = useState('');
  // A new product is named after an existing one ("PFI-1100 PM") and assumed the same size.
  const model = channels.find(c => c.product)?.product;
  const [name, setName] = useState<string | null>(null);
  const [size, setSize] = useState(model ? String(model.capacity_nl / 1e6) : '');

  const product = channels.find(c => c.code === code)?.product;
  const priceMicros = parseMoney(price), capacityNl = Math.round(Number(size) * 1e6);
  const newName = name ?? (model && code ? `${productName(model)} ${code}` : '');
  const ready = code !== '' && priceMicros !== null && /^\d{4}-\d\d-\d\d$/.test(date) && /^\d+$/.test(count) && Number(count) > 0
    && (!!product || (newName.trim() !== '' && capacityNl > 0));

  // A new cartridge product is created with its purchase in one request, so a failure leaves nothing to retry around.
  const save = useEdit(async () => {
    await api.setupInkPurchase({
      ...product ? { ink_product_id: product.id } : { cartridge: { name: newName.trim(), channel: code, capacity_nl: capacityNl } },
      purchase: { purchased_on: date, cartridges: Number(count), price_micros: priceMicros! },
    });
    return code;
  });

  return (
    <DocketSection label="Add stock">
      <FieldStack>
        <Field label="Cartridge">{id => (
          <Select id={id} value={code} onChange={e => setCode(e.target.value)}>
            <option value="">Choose a cartridge</option>
            {purchasableChannels(channels).map(c => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
          </Select>
        )}</Field>
        {code && !product && (
          <FieldPair>
            <Field label="Product" hint="Not set up yet; it's added with this purchase.">{id => (
              <TextInput id={id} value={newName} onChange={e => setName(e.target.value)} placeholder={`e.g. PFI-1100 ${code}`} />
            )}</Field>
            <Field label="Size (ml)">{id => <NumberInput id={id} min={1} step="any" value={size} onChange={e => setSize(e.target.value)} />}</Field>
          </FieldPair>
        )}
        <FieldPair>
          <Field label="Date">{id => <DateInput id={id} value={date} onChange={e => setDate(e.target.value)} />}</Field>
          <Field label="Cartridges">{id => <NumberInput id={id} min={1} value={count} onChange={e => setCount(e.target.value)} />}</Field>
        </FieldPair>
        <Field label="Price paid" className="max-w-[180px]">{id => <MoneyInput id={id} value={price} onChange={e => setPrice(e.target.value)} />}</Field>
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
