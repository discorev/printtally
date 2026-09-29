import { useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { costingMethods, type CostingMethod, type KnownPrinter } from 'print-accounting-contracts';
import { api } from '../../api/endpoints.ts';
import { describeError } from '../../api/client.ts';
import { useEdit, useKnownPrinters, useSettings, useTotals } from '../../api/queries.ts';
import { useCanEdit, useHealth, useServerName } from '../../connection/index.ts';
import { desktop, useDesktopConnection } from '../../desktop.ts';
import {
  Button, ButtonLink, Field, Fingerprint, KV, LinkButton, Mono, Money, Pad, PadBody, PadHead, RowActions, SectionLabel, Select, StatusLine, Sub, TextLink,
} from '../../components/index.ts';
import { clock, dateShort, plural } from '../../lib/format.ts';
import { cx } from '../../lib/cx.ts';
import { useLedgerSpan } from './ledger.ts';

// Settings: the costing method and currency (ledger settings on the server), the printer, which computer this
// client uses (with "Switch computer" in the desktop app), and what the ledger keeps.
const METHODS: Record<CostingMethod, [name: string, description: string]> = {
  oldest: ['Oldest', 'The price of the pack, roll or cartridge the print most likely came from.'],
  average: ['Average', 'The average of everything you had bought by the day of the print.'],
  max: ['Max', 'The most you had paid by then. Use it when pricing work.'],
};
// One currency per ledger; changing it relabels amounts, it doesn't convert them. Two-decimal currencies only,
// as prices are typed in pounds and pence (or the equivalent).
const CURRENCIES = ['GBP', 'EUR', 'USD', 'CAD', 'AUD', 'NZD', 'CHF', 'SEK', 'NOK', 'DKK'];

export function Settings() {
  return (
    <Pad label="Settings">
      <PadHead title="Settings" />
      <PadBody>
        <div className="flex max-w-[760px] flex-col gap-4 px-5 py-4 phone:px-3.5 phone:py-3">
          <CostingCard />
          <CurrencyCard />
          <PrinterCard />
          <ComputerCard />
          <LedgerCard />
        </div>
      </PadBody>
    </Pad>
  );
}

function Card({ label, lockable, children }: { label: ReactNode; lockable?: boolean; children: ReactNode }) {
  return (
    <section className="rounded-[3px] border border-rule-2 bg-paper px-4 py-3.5 dark:bg-paper-2">
      <SectionLabel lockable={lockable} className="mb-2">{label}</SectionLabel>
      {children}
    </section>
  );
}

/** The costing method: only the chosen method's figures are shown (plan decision 1), so the total sits on its card. */
function CostingCard() {
  const settings = useSettings().data, totals = useTotals().data?.overall, canEdit = useCanEdit();
  const save = useEdit((costing_method: CostingMethod) => api.updateSettings({ costing_method }));
  const chosen = save.isPending ? save.variables : settings?.costing_method;
  const choose = (method: CostingMethod) => { if (method !== settings?.costing_method) save.mutate(method); };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step || !chosen) return;
    event.preventDefault();
    const next = costingMethods[(costingMethods.indexOf(chosen) + step + costingMethods.length) % costingMethods.length];
    choose(next);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-method=${next}]`)?.focus();
  };
  return (
    <Card label="Costing method" lockable>
      <Sub>How a sheet, a metre of roll or a millilitre of ink is priced when you've bought it more than once. Costs are worked out when viewed, so changing this recalculates everything and never rewrites the ledger.</Sub>
      <div role="radiogroup" aria-label="Costing method" onKeyDown={onKeyDown} className="mt-2 grid grid-cols-3 gap-2.5 phone:grid-cols-1">
        {costingMethods.map(method => {
          const on = chosen === method;
          return (
            <button key={method} type="button" role="radio" aria-checked={on} data-method={method} tabIndex={on || !chosen ? 0 : -1} disabled={!canEdit || !settings}
              onClick={() => choose(method)}
              className={cx('flex flex-col gap-1 rounded-[3px] border bg-transparent px-3 py-2.5 text-left text-ink disabled:cursor-default',
                on ? 'border-green shadow-[inset_0_0_0_1px_var(--color-green)]' : 'border-rule-2 hover:bg-hover')}>
              <span className="font-slab text-[15px] leading-5 font-semibold">{METHODS[method][0]}</span>
              {on && totals && !save.isPending && (
                <span className="font-medium"><Money micros={totals.total_micros} /> <span className="font-normal text-muted">for {plural(totals.jobs, 'print')}</span></span>
              )}
              <span className="text-[12.5px] leading-[17px] text-muted">{METHODS[method][1]}</span>
            </button>
          );
        })}
      </div>
      {save.isError && <StatusLine error>{describeError(save.error)}</StatusLine>}
    </Card>
  );
}

function CurrencyCard() {
  const settings = useSettings().data, canEdit = useCanEdit();
  const save = useEdit((currency: string) => api.updateSettings({ currency }));
  const current = save.isPending ? save.variables : settings?.currency;
  const options = current && !CURRENCIES.includes(current) ? [current, ...CURRENCIES] : CURRENCIES;
  return (
    <Card label="Currency" lockable>
      <Sub>The ledger records every price in one currency. Changing it relabels every amount; nothing is converted.</Sub>
      <Select aria-label="Currency" className="mt-2.5 max-w-[240px]" value={current ?? ''} disabled={!canEdit || !settings} onChange={event => save.mutate(event.target.value)}>
        {options.map(code => <option key={code} value={code}>{code} · {currencyName(code)}</option>)}
      </Select>
      {save.isError && <StatusLine error>{describeError(save.error)}</StatusLine>}
    </Card>
  );
}
const currencyNames = new Intl.DisplayNames(['en-GB'], { type: 'currency' });
const currencyName = (code: string): string => currencyNames.of(code) ?? code;

function PrinterCard() {
  const printers = useKnownPrinters().data?.printers;
  return (
    <Card label="Printer" lockable>
      {printers?.length === 0 && <><Sub>No printer is set up yet.</Sub><RowActions><ButtonLink size="sm" to="/setup">Set up your printer</ButtonLink></RowActions></>}
      {printers?.map(printer => <Printer key={printer.id} printer={printer} />)}
      {!!printers?.length && <RowActions className="mt-3.5"><ButtonLink size="sm" to="/setup">Set up a different printer</ButtonLink></RowActions>}
    </Card>
  );
}

function Printer({ printer }: { printer: KnownPrinter }) {
  const state = useHealth()?.printers.find(item => item.id === printer.id)?.state, server = useServerName();
  const [showFingerprint, setShowFingerprint] = useState(false), [changing, setChanging] = useState(false);
  const [saved, setSaved] = useState<string>();
  return (
    <div className="[&+&]:mt-3.5 [&+&]:border-t [&+&]:border-rule [&+&]:pt-3.5">
      <KV rows={[
        ['Printer', <>{printer.name} · <Mono>{printer.host}</Mono></>],
        ['Fingerprint', state === 'needs_confirming'
          ? <span className="text-amber">Changed on the printer · <TextLink to="/setup" search={{ host: printer.host }}>Check it</TextLink></span>
          : <>Confirmed {dateShort(printer.confirmedAt)} · <LinkButton onClick={() => setShowFingerprint(!showFingerprint)}>{showFingerprint ? 'Hide' : 'Show'}</LinkButton></>],
        ['Password', state === 'needs_password'
          ? <span className="text-amber">Not stored{!changing && <> · <LinkButton onClick={() => setChanging(true)}>Enter it</LinkButton></>}</span>
          : <>Stored in {server}'s keychain{!changing && <> · <LinkButton onClick={() => { setChanging(true); setSaved(undefined); }}>Change password</LinkButton></>}</>],
      ]} />
      {showFingerprint && state !== 'needs_confirming' && <Fingerprint sha256={printer.fingerprintSha256} className="max-w-[420px]" />}
      {changing && <ChangePassword printer={printer} onDone={message => { setChanging(false); setSaved(message); }} />}
      {saved && !changing && <StatusLine>{saved}</StatusLine>}
    </div>
  );
}

function ChangePassword({ printer, onDone }: { printer: KnownPrinter; onDone: (saved?: string) => void }) {
  const [password, setPassword] = useState(''), [shown, setShown] = useState(false), [message, setMessage] = useState<string>();
  const save = useEdit((value: string) => api.savePrinterPassword(printer.id, value));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!password) { setMessage("Enter the printer's administrator password."); return; }
    try { await save.mutateAsync(password); onDone(`Password saved ${clock(new Date().toISOString())}. It's used from the next collection.`); }
    catch (error) { setMessage(describeError(error)); }
  };
  return (
    <form onSubmit={submit} noValidate className="mt-3 max-w-[360px]">
      <Field label="Administrator password" hint="The password you use on the printer's Remote UI." error={message}>
        {id => (
          <div className="flex items-center gap-2">
            <input id={id} type={shown ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} autoComplete="off" autoFocus />
            <LinkButton onClick={() => setShown(!shown)}>{shown ? 'Hide' : 'Show'}</LinkButton>
          </div>
        )}
      </Field>
      <RowActions>
        <Button type="submit" variant="primary" size="sm" edit disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save password'}</Button>
        <Button variant="text" size="sm" onClick={() => onDone()}>Cancel</Button>
      </RowActions>
    </form>
  );
}

/** Which computer this client uses. Only the desktop app can switch (plan decision 4); a browser uses the
 *  computer whose address it opened. */
function ComputerCard() {
  const name = useServerName(), connection = useDesktopConnection();
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
  if (desktop) return (
    <Card label="Computer">
      <div>Connected to <b>{name}</b> {connection && <Mono>({connection.host}:{connection.port})</Mono>}</div>
      <Sub>{connection?.remote ? 'The ledger lives there, next to the printer.' : 'The ledger lives on this Mac.'}</Sub>
      <RowActions>
        <ButtonLink size="sm" to="/connect">Switch computer</ButtonLink>
        {connection?.remote && <Button variant="text" size="sm" onClick={() => void desktop?.switchComputer()}>Use this Mac instead</Button>}
      </RowActions>
    </Card>
  );
  return (
    <Card label="Computer">
      <div>{local ? 'Serving on' : 'Connected to'} <b>{name}</b> <Mono>({location.host})</Mono></div>
      <Sub>{local
        ? <>Other devices join with a link from <Mono>printtally pair</Mono> on this computer.</>
        : <>This device was paired with a link from <Mono>printtally pair</Mono> on that computer.</>}</Sub>
    </Card>
  );
}

function LedgerCard() {
  const span = useLedgerSpan();
  return (
    <Card label="Ledger">
      <KV rows={[['Kept', !span ? '…' : span.total
        ? <>{plural(span.total, 'job')}{span.first && ` since ${dateShort(span.first)}`} · {span.hidden} hidden</>
        : 'No jobs yet']]} />
    </Card>
  );
}
