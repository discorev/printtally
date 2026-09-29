import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import type { DiscoveredPrinter, KnownPrinter, PrinterTrustPreview } from 'print-accounting-contracts';
import { api } from '../../api/endpoints.ts';
import { useEdit } from '../../api/queries.ts';
import { connection, useHealth } from '../../connection/index.ts';
import { desktop } from '../../desktop.ts';
import {
  Button, Docket, DocketHead, DocketSection, Field, Fingerprint, LinkButton, Mono, RowActions, Spinner, Sub, Sweep, TextInput, TextLink,
} from '../../components/index.ts';
import { cx } from '../../lib/cx.ts';
import { problem, problemCode } from './problem.ts';
import { PasswordForm } from './PasswordForm.tsx';

// Printer setup (plan decision 10): find the printer or type its address, compare its root certificate's
// fingerprint with the one the printer shows, confirm, store the password, then the first collection lands on Jobs.
// Opened with ?host=… (from Collect or Settings) it starts by checking that printer again, e.g. after its
// certificate changed.
type Stage =
  | { at: 'find' }
  | { at: 'confirm'; preview: PrinterTrustPreview }
  | { at: 'password'; printer: KnownPrinter; keepsPassword: boolean }
  | { at: 'collect'; printer: KnownPrinter };
const ORDER = { find: 1, confirm: 2, password: 3, collect: 4 } as const;
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const MAC = /^(?:[0-9a-f]{12}|(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2})$/i;

export function Setup({ host }: { host?: string }) {
  const [stage, setStage] = useState<Stage>({ at: 'find' });
  // First run: no printer is ready yet. Otherwise this was opened from Settings or Collect, and can be cancelled.
  const firstRun = useHealth()?.state === 'needs_printer';
  const step = ORDER[stage.at];
  return (
    <Docket centered label="Set up your printer">
      <DocketHead when="Print Tally" title="Set up your printer" subtitle="Three steps, then jobs start arriving on their own." />
      <div>
        <Step n={1} title="Find your printer" step={step}>
          <FindPrinter host={host} onPreview={preview => setStage({ at: 'confirm', preview })} />
        </Step>
        <Step n={2} title="Confirm it's your printer" step={step}>
          {stage.at === 'confirm' && <ConfirmPrinter preview={stage.preview} onBack={() => setStage({ at: 'find' })}
            onConfirmed={printer => setStage({ at: 'password', printer, keepsPassword: stage.preview.change === 'unchanged' || stage.preview.change === 'address_changed' })} />}
        </Step>
        <Step n={3} title="Administrator password" step={step}>
          {stage.at === 'password' && <PrinterPassword printer={stage.printer} keepsPassword={stage.keepsPassword} onSaved={() => setStage({ at: 'collect', printer: stage.printer })} />}
        </Step>
        {stage.at === 'collect' && <FirstCollection printer={stage.printer} onPassword={() => setStage({ at: 'password', printer: stage.printer, keepsPassword: false })} />}
      </div>
      {firstRun ? desktop && stage.at !== 'collect' && (
        <DocketSection className="text-center"><Sub>Already running Print Tally on another computer? <TextLink to="/connect">Connect to it</TextLink></Sub></DocketSection>
      ) : (stage.at === 'find' || stage.at === 'confirm') && (
        <DocketSection className="text-center"><Sub><TextLink to="/settings">Cancel</TextLink></Sub></DocketSection>
      )}
    </Docket>
  );
}

/** One numbered step: ✓ once done, faint until reached, and its body only while it's the current one. */
function Step({ n, title, step, children }: { n: number; title: string; step: number; children: ReactNode }) {
  const done = step > n, current = step === n;
  return (
    <div aria-current={current ? 'step' : undefined} className={cx('border-t border-rule px-[22px] py-4 first:border-t-0 phone:px-4', !done && !current && 'text-faint')}>
      <span aria-hidden className={cx('mr-2.5 inline-flex size-[22px] items-center justify-center rounded-full border align-[-5px] font-slab text-[12px] leading-none font-semibold',
        done ? 'border-ink bg-ink text-paper' : current ? 'border-ink' : 'border-faint')}>{done ? '✓' : n}</span>
      <span className={cx('font-slab text-[11px] leading-4 font-semibold tracking-[.09em] uppercase', done ? 'text-ink' : current ? 'text-muted' : 'text-faint')}>
        {title}{done && <span className="sr-only"> (done)</span>}
      </span>
      {current && <div className="mt-2.5">{children}</div>}
    </div>
  );
}

/** Step 1: look for printers on the network, or type the printer's address. Choosing one reads its root
 *  certificate (the preview); nothing is trusted until step 2. A MAC address is asked for only when the server
 *  couldn't look it up (outside macOS, or a printer on another network; see COMPATIBILITY.md). */
function FindPrinter({ host, onPreview }: { host?: string; onPreview: (preview: PrinterTrustPreview) => void }) {
  const [found, setFound] = useState<DiscoveredPrinter[]>();
  const [manual, setManual] = useState(!!host);
  const [address, setAddress] = useState(host ?? ''), [mac, setMac] = useState('');
  const [needsMac, setNeedsMac] = useState(false);
  const [message, setMessage] = useState<string>();
  const discover = useEdit(api.discoverPrinters);
  const preview = useEdit(api.previewPrinter);

  const check = async (target: { host: string; name?: string }, withMac?: string) => {
    setMessage(undefined);
    try {
      const result = await preview.mutateAsync({ ...target, ...withMac ? { mac: withMac } : {} });
      if (result.mac) { onPreview(result); return; }
      // Collection needs the printer's MAC address; this server couldn't look it up, so ask for it.
      void api.cancelPreview(result.id).catch(() => undefined);
      setAddress(target.host); setManual(true); setNeedsMac(true);
    } catch (error) {
      setMessage(problemCode(error) === 'invalid_printer_address' ? "That isn't a printer address on this network. Printers use a private address, such as 192.168.1.42." : problem(error));
    }
  };
  const look = async () => {
    setMessage(undefined);
    try {
      const { printers } = await discover.mutateAsync(undefined);
      setFound(printers);
      if (!printers.length) { setManual(true); setMessage('No printers answered on this network. Enter its address instead.'); }
    } catch (error) { setMessage(problem(error)); }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const ip = address.trim();
    if (!IPV4.test(ip)) { setMessage("Enter the printer's IP address, such as 192.168.1.42."); return; }
    if (needsMac && !MAC.test(mac.trim())) { setMessage('Enter the MAC address as six pairs, such as 00:1E:8F:12:34:56.'); return; }
    void check({ host: ip }, needsMac ? mac.trim() : undefined);
  };

  // Opened to check a known printer again (?host=…): start straight away. The ref keeps StrictMode from asking twice.
  const started = useRef(false);
  useEffect(() => {
    if (!host || started.current) return;
    started.current = true;
    void check({ host });
  }, [host]);

  const busy = preview.isPending;
  const error = message && <Sub tone="amber" className="mt-2">{message}</Sub>;
  if (manual) return (
    <form onSubmit={submit} noValidate>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Printer address" className="min-w-[180px] flex-1">
          {id => <TextInput id={id} value={address} onChange={event => setAddress(event.target.value)} placeholder="192.168.1.42" inputMode="decimal"
            autoComplete="off" spellCheck={false} className="font-mono" autoFocus={!host} />}
        </Field>
        {needsMac && (
          <Field label="MAC address" className="min-w-[180px] flex-1">
            {id => <TextInput id={id} value={mac} onChange={event => setMac(event.target.value)} placeholder="00:1E:8F:12:34:56" autoComplete="off" spellCheck={false} className="font-mono" autoFocus />}
          </Field>
        )}
        <Button type="submit" variant="primary" edit disabled={busy} className="mb-0.5">{busy ? <><Spinner />Checking the printer…</> : 'Find my printer'}</Button>
      </div>
      {needsMac && <Sub className="mt-2">Print Tally can't look up this printer's MAC address from here. It's in the printer's network settings.</Sub>}
      {error}
      {!host && <RowActions><LinkButton onClick={() => { setManual(false); setNeedsMac(false); setMessage(undefined); }}>Look on the network instead</LinkButton></RowActions>}
    </form>
  );
  return (
    <div>
      {found?.length ? (
        <div className="flex flex-col gap-2">
          {found.map(printer => (
            <div key={printer.host} className="flex items-center gap-2.5 rounded-[3px] border border-rule-2 px-3 py-2.5">
              <span aria-hidden className="dot on" />
              <span className="min-w-0 flex-1">{printer.name} · <Mono>{printer.host}</Mono></span>
              <Button variant="primary" size="sm" edit disabled={busy} onClick={() => void check({ host: printer.host, name: printer.name })}>
                {busy && preview.variables?.host === printer.host ? <><Spinner />Checking…</> : 'Use this printer'}</Button>
            </div>
          ))}
          <Sub>Not your printer? <LinkButton onClick={() => { setManual(true); setMessage(undefined); }}>Enter an address instead</LinkButton></Sub>
        </div>
      ) : (
        <RowActions className="mt-0 gap-3">
          <Button variant="primary" edit disabled={discover.isPending} onClick={() => void look()}>
            {discover.isPending ? <><Spinner />Looking on the network…</> : 'Find my printer'}</Button>
          <LinkButton onClick={() => { setManual(true); setMessage(undefined); }}>Enter an address instead</LinkButton>
        </RowActions>
      )}
      {error}
    </div>
  );
}

/** Step 2: the fingerprint to compare with the printer's own screen. Only an explicit confirmation trusts it. */
function ConfirmPrinter({ preview, onConfirmed, onBack }: { preview: PrinterTrustPreview; onConfirmed: (printer: KnownPrinter) => void; onBack: () => void }) {
  const confirm = useEdit((id: string) => api.confirmPrinter(id, preview.fingerprintSha256));
  const [message, setMessage] = useState<string>();
  const save = async () => {
    setMessage(undefined);
    try { onConfirmed(await confirm.mutateAsync(preview.id)); }
    catch (error) {
      const code = problemCode(error);
      if (code === 'preview_expired' || code === 'fingerprint_mismatch' || code === 'preview_stale') { onBack(); return; }
      setMessage(problem(error));
    }
  };
  const notIt = () => { void api.cancelPreview(preview.id).catch(() => undefined); onBack(); };
  return (
    <div>
      <div>{preview.name !== preview.host && <>{preview.name} · </>}<Mono>{preview.host}</Mono></div>
      {preview.change === 'root_changed' && (
        <Sub tone="amber" className="mt-1.5">This printer's certificate has changed since it was confirmed. That happens when the printer is reset or its certificate is renewed; if neither happened, don't continue.</Sub>
      )}
      {preview.change === 'address_changed' && <Sub className="mt-1.5">This printer is already set up at another address. Confirming moves it here and keeps its history.</Sub>}
      <Fingerprint sha256={preview.fingerprintSha256} />
      <Sub>On the printer: Printer information › System information › Root cert. thumbprint (SHA-256). Only continue if it matches this one.</Sub>
      {message && <Sub tone="amber" className="mt-2">{message}</Sub>}
      <RowActions>
        <Button variant="primary" edit disabled={confirm.isPending} onClick={() => void save()}>{confirm.isPending ? <><Spinner />Confirming…</> : 'Confirm fingerprint'}</Button>
        <Button disabled={confirm.isPending} onClick={notIt}>This isn't it</Button>
      </RowActions>
    </div>
  );
}

/** Step 3: the printer's administrator password. After a certificate or address change it can keep the saved one. */
function PrinterPassword({ printer, keepsPassword, onSaved }: { printer: KnownPrinter; keepsPassword: boolean; onSaved: () => void }) {
  return <PasswordForm printer={printer} onSaved={onSaved}
    actions={saving => keepsPassword && <Button variant="text" disabled={saving} onClick={onSaved}>Keep the saved password</Button>} />;
}

/** The first collection, straight after setup: when it's done, Jobs has the printer's history. */
function FirstCollection({ printer, onPassword }: { printer: KnownPrinter; onPassword: () => void }) {
  const navigate = useNavigate();
  const collect = useEdit(() => api.collect(printer.id));
  const [message, setMessage] = useState<string>();
  const run = async () => {
    setMessage(undefined);
    try {
      await collect.mutateAsync(undefined);
      await connection.check(); // So the app knows a printer is set up before it opens Jobs.
      void navigate({ to: '/jobs' });
    } catch (error) {
      setMessage(problemCode(error) === 'collection_failed' ? "Couldn't read the printer's log. Check the password, then try again." : problem(error));
    }
  };
  const started = useRef(false);
  useEffect(() => { if (!started.current) { started.current = true; void run(); } }, []); // Once; the ref keeps StrictMode from collecting twice.
  const finish = async () => { await connection.check(); void navigate({ to: '/jobs' }); };
  return (
    <DocketSection label="First collection" className="px-[22px] phone:px-4">
      {collect.isPending || !message ? (
        <>
          <Sub>Reading {printer.name}'s job log. The first time can take a minute.</Sub>
          <Sweep />
        </>
      ) : (
        <>
          <Sub tone="amber">{message}</Sub>
          <RowActions>
            <Button variant="primary" edit onClick={() => void run()}>Try again</Button>
            {problemCode(collect.error) === 'collection_failed' && <Button onClick={onPassword}>Change password</Button>}
            <Button variant="text" onClick={() => void finish()}>Go to Jobs</Button>
          </RowActions>
        </>
      )}
    </DocketSection>
  );
}
