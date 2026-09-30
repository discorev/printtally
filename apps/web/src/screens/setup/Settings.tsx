import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { costingMethods, type CostingMethod, type KnownPrinter, type KnownPrinterListing } from 'print-accounting-contracts';
import { api } from '../../api/endpoints.ts';
import { describeError } from '../../api/client.ts';
import { keys, useEdit, useKnownPrinters, useSettings, useTotals } from '../../api/queries.ts';
import { onServerMachine, useCanEdit, useHealth, useServerName } from '../../connection/index.ts';
import { desktop, useDesktopConnection, useDesktopVersion } from '../../desktop.ts';
import {
  Button, ButtonLink, Fingerprint, KV, LinkButton, Mono, Money, Pad, PadBody, PadHead, RowActions, SectionLabel, StatusLine, Sub, TextLink, useLoadingText,
} from '../../components/index.ts';
import { clock, dateShort, plural } from '../../lib/format.ts';
import { cx } from '../../lib/cx.ts';
import { useLedgerSpan } from './ledger.ts';
import { PasswordForm } from './PasswordForm.tsx';

// Settings: the costing method (a ledger setting on the server), the printer, which computer this client uses
// (with "Switch computer" in the desktop app), and what the ledger keeps.
const METHODS: Record<CostingMethod, [name: string, description: string]> = {
  oldest: ['Oldest', 'The price of the pack, roll or cartridge the print most likely came from.'],
  average: ['Average', 'The average of everything you had bought by the day of the print.'],
  max: ['Max', 'The most you had paid by then. Use it when pricing work.'],
};

export function Settings() {
  return (
    <Pad label="Settings">
      <PadHead title="Settings" />
      <PadBody>
        <div className="flex max-w-[760px] flex-col gap-4 px-5 py-4 phone:px-3.5 phone:py-3">
          <CostingCard />
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

/** The costing method: only the chosen method's figures are shown (plan decision 1), so the total sits on its card.
 *  The card shows the method the server has; a choice is marked "Saving…" until the server confirms it. */
function CostingCard() {
  const settings = useSettings().data, totals = useTotals().data?.overall, canEdit = useCanEdit(), client = useQueryClient();
  const save = useEdit(async (costing_method: CostingMethod) => {
    const saved = await api.updateSettings({ costing_method });
    client.setQueryData(keys.settings, saved); // Confirmed: show it now, not after the refetch.
    return saved;
  });
  const loading = useLoadingText('the costing method');
  const confirmed = settings?.costing_method, pending = save.isPending ? save.variables : undefined;
  const choose = (method: CostingMethod) => { if (method !== confirmed && !save.isPending) save.mutate(method); };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step || !confirmed || save.isPending) return;
    event.preventDefault();
    const next = costingMethods[(costingMethods.indexOf(confirmed) + step + costingMethods.length) % costingMethods.length];
    choose(next);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-method=${next}]`)?.focus();
  };
  return (
    <Card label="Costing method" lockable>
      <Sub>How a sheet, a metre of roll or a millilitre of ink is priced when you've bought it more than once. Costs are worked out when viewed, so changing this recalculates everything and never rewrites the ledger.</Sub>
      {!settings ? <Sub className="mt-2">{loading}</Sub> : (
        <div role="radiogroup" aria-label="Costing method" aria-busy={save.isPending} onKeyDown={onKeyDown} className="mt-2 grid grid-cols-3 gap-2.5 phone:grid-cols-1">
          {costingMethods.map(method => {
            const on = confirmed === method, saving = pending === method;
            return (
              <button key={method} type="button" role="radio" aria-checked={on} data-method={method} tabIndex={on ? 0 : -1} disabled={!canEdit}
                onClick={() => choose(method)}
                className={cx('flex flex-col gap-1 rounded-[3px] border bg-transparent px-3 py-2.5 text-left text-ink disabled:cursor-default',
                  on ? 'border-green shadow-[inset_0_0_0_1px_var(--color-green)]' : saving ? 'border-dashed border-green' : 'border-rule-2 enabled:hover:bg-hover')}>
                <span className="font-slab text-[15px] leading-5 font-semibold">{METHODS[method][0]}</span>
                {on && totals && !save.isPending && (
                  <span className="font-medium"><Money micros={totals.total_micros} /> <span className="font-normal text-muted">for {plural(totals.jobs, 'print')}</span></span>
                )}
                {saving && <span className="font-medium text-muted">Saving…</span>}
                <span className="text-[12.5px] leading-[17px] text-muted">{METHODS[method][1]}</span>
              </button>
            );
          })}
        </div>
      )}
      {save.isError && <StatusLine error>{describeError(save.error)}</StatusLine>}
    </Card>
  );
}

function PrinterCard() {
  const printers = useKnownPrinters().data?.printers, loading = useLoadingText('the printer');
  return (
    <Card label="Printer" lockable>
      {!printers && <Sub>{loading}</Sub>}
      {printers?.length === 0 && <><Sub>No printer is set up yet.</Sub><RowActions><ButtonLink size="sm" to="/setup">Set up your printer</ButtonLink></RowActions></>}
      {printers?.map(printer => <Printer key={printer.id} printer={printer} />)}
      {!!printers?.length && <RowActions className="mt-3.5"><ButtonLink size="sm" to="/setup">Set up a different printer</ButtonLink></RowActions>}
    </Card>
  );
}

function Printer({ printer }: { printer: KnownPrinterListing }) {
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
        ['Password', printer.hasPassword === false
          ? <span className="text-amber">Not saved yet{!changing && <> · <LinkButton onClick={() => setChanging(true)}>Enter it</LinkButton></>}</span>
          : <>{printer.hasPassword ? `Stored in ${server}'s keychain` : `Couldn't check ${server}'s keychain`}{!changing && <> · <LinkButton onClick={() => { setChanging(true); setSaved(undefined); }}>Change password</LinkButton></>}</>],
      ]} />
      {showFingerprint && state !== 'needs_confirming' && <Fingerprint sha256={printer.fingerprintSha256} className="max-w-[420px]" />}
      {changing && <ChangePassword printer={printer} onDone={message => { setChanging(false); setSaved(message); }} />}
      {saved && !changing && <StatusLine>{saved}</StatusLine>}
    </div>
  );
}

function ChangePassword({ printer, onDone }: { printer: KnownPrinter; onDone: (saved?: string) => void }) {
  return <PasswordForm printer={printer} size="sm" className="mt-3 max-w-[360px]"
    onSaved={() => onDone(`Password saved ${clock(new Date().toISOString())}. It's used from the next collection.`)}
    actions={() => <Button variant="text" size="sm" onClick={() => onDone()}>Cancel</Button>} />;
}

/** Which computer this client uses. Only the desktop app can switch (plan decision 4); a browser uses the
 *  computer whose address it opened. Each part shows its own version: the desktop app's, and the server's. */
function ComputerCard() {
  const name = useServerName(), connection = useDesktopConnection();
  const local = onServerMachine();
  const appVersion = useDesktopVersion(), backendVersion = useHealth()?.version;
  const versions = <KV className="mt-2.5" rows={[
    !!desktop && !!appVersion && ['App version', <Mono>{appVersion}</Mono>],
    !!backendVersion && ['Backend version', <Mono>{backendVersion}</Mono>],
  ]} />;
  if (desktop) return (
    <Card label="Computer">
      <div>Connected to <b>{name}</b> {connection && <Mono>({connection.host}:{connection.port})</Mono>}</div>
      <Sub>{connection?.remote ? 'The ledger lives there, next to the printer.' : 'The ledger lives on this Mac.'}</Sub>
      {versions}
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
      {versions}
    </Card>
  );
}

function LedgerCard() {
  const span = useLedgerSpan(), loading = useLoadingText('the ledger');
  return (
    <Card label="Ledger">
      <KV rows={[['Kept', !span ? loading : span.total
        ? <>{plural(span.total, 'job')}{span.first && ` since ${dateShort(span.first)}`} · {span.hidden} hidden</>
        : 'No jobs yet']]} />
    </Card>
  );
}
