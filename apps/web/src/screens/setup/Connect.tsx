import { useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { connection, useConnection, useServerName } from '../../connection/index.ts';
import { desktop, useDesktopConnection } from '../../desktop.ts';
import { Button, Docket, DocketHead, DocketSection, Field, FieldPair, Mono, RowActions, Sub, TextInput } from '../../components/index.ts';
import { cx } from '../../lib/cx.ts';

// Connect (plan decisions 3, 4 and 6). The desktop app can switch to Print Tally on another computer with a
// pairing link, or an address and pairing code, through its bridge. A browser can't switch computer: one whose
// session isn't valid (401) is told how to pair with `printtally pair` on the host.
export function Connect() {
  return desktop ? <DesktopConnect /> : <BrowserConnect />;
}

type Mode = 'link' | 'address';
const CODE = /^[A-Za-z0-9_-]{43}$/;

function DesktopConnect() {
  const bridge = desktop!;
  const { status } = useConnection(), name = useServerName(), current = useDesktopConnection();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('link');
  const [link, setLink] = useState(''), [address, setAddress] = useState(''), [code, setCode] = useState('');
  const [message, setMessage] = useState<string>(), [busy, setBusy] = useState(false);
  const revoked = status === 'unauthorized';

  const target = (): string | undefined => {
    if (mode === 'link') return /\/pair#code=/.test(link) ? link.trim() : undefined;
    const host = address.trim().replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '');
    if (!host || (code.trim() && !CODE.test(code.trim()))) return undefined;
    return code.trim() ? `http://${host}/pair#code=${code.trim()}` : host;
  };
  // The app loads the other computer's pairing page (or its UI), so this page goes away once it works.
  const connect = async (value: string | undefined) => {
    setMessage(undefined);
    if (value === '') return setMessage(mode === 'link' ? 'Paste the whole link that printtally pair printed.' : 'Enter the address, and the pairing code if this Mac isn\'t paired yet.');
    setBusy(true);
    try { await bridge.switchComputer(value); }
    catch { setMessage(mode === 'link' ? "That isn't a Print Tally pairing link. Copy the whole link that printtally pair printed." : "That isn't an address Print Tally can use. Enter it as host:port, such as studio-mac.local:4318."); }
    finally { setBusy(false); }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); void connect(target() ?? ''); };

  return (
    <Docket centered label="Connect to another computer">
      <DocketHead when="Print Tally" title="Connect to another computer" subtitle={revoked
        ? <>This Mac is no longer paired with Print Tally on {name}. Run <Mono>printtally pair</Mono> there to get a new pairing link or code.</>
        : <>Print Tally is running next to the printer on another computer. Run <Mono>printtally pair</Mono> there to get a pairing link or code.</>} />
      <DocketSection className="border-t-0">
        <form onSubmit={submit} noValidate>
          <div role="radiogroup" aria-label="How to connect" className="flex flex-col gap-2.5">
            <Option on={mode === 'link'} onSelect={() => { setMode('link'); setMessage(undefined); }} title="Paste a pairing link"
              detail={<>From <Mono>printtally pair</Mono> on that computer</>}>
              <Field label="Pairing link" error={mode === 'link' && message}>
                {id => <TextInput id={id} value={link} onChange={event => setLink(event.target.value)} placeholder="http://studio-mac.local:4318/pair#…" autoComplete="off" spellCheck={false} className="font-mono" autoFocus />}
              </Field>
            </Option>
            <Option on={mode === 'address'} onSelect={() => { setMode('address'); setMessage(undefined); }} title="Enter an address"
              detail={<>host:port plus the pairing code from <Mono>printtally pair</Mono></>}>
              <FieldPair>
                <Field label="Address">
                  {id => <TextInput id={id} value={address} onChange={event => setAddress(event.target.value)} placeholder="studio-mac.local:4318" autoComplete="off" spellCheck={false} className="font-mono" autoFocus />}
                </Field>
                <Field label="Pairing code">
                  {id => <TextInput id={id} value={code} onChange={event => setCode(event.target.value)} placeholder="From printtally pair" autoComplete="off" spellCheck={false} className="font-mono" />}
                </Field>
              </FieldPair>
              {mode === 'address' && message && <Sub tone="amber" className="mt-1.5">{message}</Sub>}
            </Option>
          </div>
          <RowActions className="mt-3.5">
            <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Connecting…' : 'Connect'}</Button>
            {!revoked && <Button variant="text" onClick={() => void navigate({ to: '/jobs' })}>Cancel</Button>}
            {current?.remote && <Button variant="text" className="ml-auto" disabled={busy} onClick={() => void connect(undefined)}>Use this Mac instead</Button>}
          </RowActions>
        </form>
      </DocketSection>
    </Docket>
  );
}

/** One way to connect: a radio header that opens its fields (the mockup's .opt2). */
function Option({ on, onSelect, title, detail, children }: { on: boolean; onSelect: () => void; title: string; detail: ReactNode; children: ReactNode }) {
  return (
    <div className={cx('rounded-[3px] border', on ? 'border-green' : 'border-rule-2')}>
      <button type="button" role="radio" aria-checked={on} onClick={onSelect}
        className="flex w-full items-start gap-2.5 border-0 bg-transparent px-3 py-2.5 text-left text-ink">
        <span className="dot mt-[3px]" />
        <span><b className="block font-slab text-[15px] leading-5 font-semibold">{title}</b><span className="text-[12.5px] text-muted">{detail}</span></span>
      </button>
      {on && <div className="pr-3 pb-3 pl-9">{children}</div>}
    </div>
  );
}

/** A browser can't switch computer. One that isn't paired (401) learns how to pair; one that is connected is
 *  told to open the other computer's address instead. */
function BrowserConnect() {
  const { status } = useConnection(), name = useServerName();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(false);
  const retry = async () => {
    setChecking(true);
    await connection.check();
    setChecking(false);
    if (connection.getState().status === 'connected') void navigate({ to: '/jobs' });
  };
  if (status !== 'unauthorized') return (
    <Docket centered label="Connect to another computer">
      <DocketHead when="Print Tally" title="Connect to another computer" subtitle={<>This browser is using Print Tally on {name}.</>} />
      <DocketSection className="border-t-0">
        <Sub>To use Print Tally on another computer, open that computer's address in your browser. If it asks you to pair, run <Mono>printtally pair</Mono> there and open the link it prints.</Sub>
        <RowActions className="mt-3.5"><Button variant="primary" onClick={() => void navigate({ to: '/jobs' })}>Back to Jobs</Button></RowActions>
      </DocketSection>
    </Docket>
  );
  return (
    <Docket centered label="Pair this device">
      <DocketHead when="Print Tally" title="Pair this device" subtitle={<>Print Tally on {name} only answers devices that have been paired with it.</>} />
      <DocketSection className="border-t-0">
        <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
          <Numbered n={1}>On the computer running Print Tally, run <Mono>printtally pair</Mono>.</Numbered>
          <Numbered n={2}>Open the link it prints in this browser, or scan its QR code with this device's camera. This page then opens Print Tally.</Numbered>
        </ol>
        <Sub className="mt-3">A link works once and expires after 5 minutes. Other devices can pair only when Print Tally was started with <Mono>printtally serve --host</Mono>.</Sub>
        <RowActions className="mt-3.5"><Button disabled={checking} onClick={() => void retry()}>{checking ? 'Checking…' : 'Try again'}</Button></RowActions>
      </DocketSection>
    </Docket>
  );
}

const Numbered = ({ n, children }: { n: number; children: ReactNode }) => (
  <li className="flex items-start gap-2.5">
    <span aria-hidden className="inline-flex size-[22px] flex-none items-center justify-center rounded-full border border-ink font-slab text-[12px] leading-none font-semibold">{n}</span>
    <span className="pt-px">{children}</span>
  </li>
);
