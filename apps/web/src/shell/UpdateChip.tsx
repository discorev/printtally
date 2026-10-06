import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { Button } from '../components/index.ts';
import { desktop, useDesktopUpdate, useDesktopVersion, type UpdateState } from '../desktop.ts';
import { dateShort, plural } from '../lib/format.ts';
import { cx } from '../lib/cx.ts';
import { changelogUrl, parseReleaseNotes } from './release-notes.ts';
import { SPLAT } from './splat.ts';

type Offer = Extract<UpdateState, { version: string }>;
const STAGE = { available: 'Available', downloading: 'Downloading', ready: 'Ready' } as const;
// A local build's version carries its commit and build time ("0.2.2-local+1a9b2845.2026…"): the slip shows the part before
// the "+", and the full version on hover.
const short = (version: string) => version.split('+')[0]!;

/** Downloads the update on offer, or restarts into the downloaded one. Nothing to do while downloading. */
const act = (update: Offer) => {
  if (update.status === 'available') void desktop?.downloadUpdate?.();
  if (update.status === 'ready') void desktop?.installUpdate?.();
};

/** The desktop app's update, an ink splat at the top right of the mat: "Update to 0.3.0", "Downloading 42%", then
 *  "Restart to update"; clicking does what it says. Hovering or focusing it feeds out a receipt of what changed. Hidden
 *  in a browser, on the phone layout, and when there's nothing to offer. */
export function UpdateChip() {
  const update = useDesktopUpdate();
  if (!update || !('version' in update)) return null;
  return <Chip update={update} />;
}

function Chip({ update }: { update: Offer }) {
  const [open, setOpen] = useState(false), id = useId();
  const chip = useRef<HTMLButtonElement>(null), timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const dismissed = useRef(false); // Escape closed it: focus returning to the chip mustn't reopen it.
  const hovered = useRef(false);
  useEffect(() => () => clearTimeout(timer.current), []);
  const openIn = (value: boolean, ms: number) => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(value), ms); };
  // Mouse focus (a click) doesn't hold it open; keyboard focus does, until it leaves the chip and receipt.
  const keyboardFocusWithin = (element: HTMLElement) => !!element.querySelector(':focus-visible');
  const onFocus = (event: FocusEvent<HTMLElement>) => {
    if (!dismissed.current && event.target.matches(':focus-visible')) openIn(true, 0);
  };
  const onBlur = (event: FocusEvent<HTMLElement>) => {
    if (hovered.current || event.currentTarget.contains(event.relatedTarget)) return;
    dismissed.current = false;
    openIn(false, 0);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || !open) return;
    clearTimeout(timer.current);
    dismissed.current = true;
    setOpen(false);
    chip.current?.focus();
  };
  const busy = update.status === 'downloading';
  return (
    <div className="relative flex phone:hidden" onFocus={onFocus} onBlur={onBlur} onKeyDown={onKeyDown}
      onPointerEnter={() => { hovered.current = true; openIn(true, 140); }}
      onPointerLeave={event => { hovered.current = dismissed.current = false; if (!keyboardFocusWithin(event.currentTarget)) openIn(false, 200); }}>
      <button ref={chip} type="button" aria-label={label(update)} aria-disabled={busy || undefined} aria-expanded={open} aria-controls={open ? id : undefined}
        onClick={() => act(update)}
        className={cx('grid h-[30px] w-[34px] place-items-center rounded-md text-on-mat focus-visible:outline-on-mat', busy ? 'cursor-default' : 'hover:bg-black/15')}>
        <Splat update={update} />
      </button>
      {open && <Receipt id={id} update={update} />}
    </div>
  );
}

const label = (update: Offer) => update.status === 'available' ? `Update to ${short(update.version)}`
  : update.status === 'downloading' ? `Downloading ${Math.floor(update.percent)}%` : 'Restart to update';

// An ink splat in the bar's colour: an arrow cut out of it when there's an update to download. While downloading, the
// glyph goes, the splat darkens and a drop keeps falling onto it, its flung droplets landing one by one as the download
// goes; once it's ready, every droplet is down and a restart arrow is cut out.
const ARROW = 'M13.1 10.6c-.1 1.7-.1 3.5 0 5.4M10.9 13.9c.7.7 1.4 1.5 2.2 2.2.8-.7 1.5-1.4 2.2-2.3';
const RESTART = 'M15.9 15.9a2.9 2.9 0 1 1-.7-3.1M15.5 11.1l-.2 1.8-1.8.1';
function Splat({ update }: { update: Offer }) {
  const tex = useId().replace(/:/g, ''), ink = `url(#${tex})`;
  const progress = update.status === 'downloading' ? update.percent / 100 : 1;
  const droplets = update.status === 'available' ? [] : SPLAT.droplets.slice(0, Math.round(SPLAT.droplets.length * progress));
  const glyph = update.status === 'available' ? ARROW : update.status === 'ready' ? RESTART : undefined;
  return (
    <svg aria-hidden viewBox="0 0 28 26" className="h-[26px] w-[28px] overflow-visible" fill="currentColor">
      {/* A rough edge and a mottled density, like ink soaked into paper. */}
      <filter id={tex} x="-30%" y="-30%" width="160%" height="160%" colorInterpolationFilters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves={2} seed={4} result="edge" />
        <feDisplacementMap in="SourceGraphic" in2="edge" scale=".9" xChannelSelector="R" yChannelSelector="G" result="rough" />
        <feTurbulence type="fractalNoise" baseFrequency=".45" numOctaves={3} seed={11} result="noise" />
        <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  .5 0 0 0 .62" result="density" />
        <feComposite in="rough" in2="density" operator="in" />
      </filter>
      <g filter={ink}>
        <g opacity={update.status === 'downloading' ? .45 + .55 * progress : 1} className="transition-opacity duration-300">
          <path d={SPLAT.body} fillOpacity={{ available: .8, downloading: .85, ready: .95 }[update.status]} />
          <path d={SPLAT.body} fill="none" stroke="currentColor" strokeWidth={1.1} />
        </g>
        {droplets.map(({ cx, cy, rx, ry, rotate, opacity }, i) => (
          <ellipse key={i} cx={cx} cy={cy} rx={rx} ry={ry} transform={`rotate(${rotate} ${cx} ${cy})`} fillOpacity={opacity} className="animate-blot" />
        ))}
      </g>
      {update.status === 'downloading' && <g filter={ink}><ellipse cx={13} cy={4} rx={.9} ry={1.3} className="animate-drip motion-reduce:hidden" /></g>}
      {glyph && <path d={glyph} fill="none" className="stroke-mat" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

/** The slip: the versions, what changed as line items (scope where the price would be), the count as its total,
 *  and the same action as the chip. Long notes scroll between the versions and the total. */
function Receipt({ id, update }: { id: string; update: Offer }) {
  const installed = useDesktopVersion(), groups = parseReleaseNotes(update.notes);
  const changes = groups.reduce((sum, group) => sum + group.items.length, 0);
  const dash = <hr className="my-3 border-0 border-t border-dashed border-rule-2" />;
  return (
    <div id={id} role="dialog" aria-label={`Update to Print Tally ${update.version}`}
      className="receipt absolute top-[calc(100%+7px)] right-0 z-40 w-[300px] text-ink">
      <div className="receipt-slip flex max-h-[min(70vh,640px)] animate-feed flex-col *:shrink-0 px-5 pt-5 text-[13px] leading-[19px]">
        <div className="text-center">
          <div className="font-slab text-[17px] leading-5 font-semibold tracking-[.02em]">Print Tally</div>
          <div className="mt-1 font-mono text-[11px] leading-4 tracking-[.06em] text-muted uppercase">Update{update.date && ` · ${dateShort(update.date)}`}</div>
        </div>
        {dash}
        <div className="flex items-baseline justify-between gap-3 tabular-nums">
          <Version label="Installed" version={installed ?? '—'} />
          <span aria-hidden className="text-faint">→</span>
          <Version label={STAGE[update.status]} version={update.version} className="text-right" />
        </div>
        {dash}
        {changes > 0 && <>
          {/* Fades out at the bottom, so a long list that scrolls doesn't end in a half-cut line. */}
          <div className="-mx-5 min-h-0 shrink! overflow-y-auto overscroll-contain px-5 pb-2 [mask-image:linear-gradient(to_bottom,#000_calc(100%-20px),transparent)]">
            {groups.map(group => (
              <section key={group.title} aria-label={group.title} className="mb-2.5">
                <h3 className="mb-1.5 font-mono text-[10.5px] leading-3 font-semibold tracking-[.12em] text-muted uppercase">{group.title}</h3>
                <ul className="m-0 list-none p-0">
                  {group.items.map(item => (
                    <li key={`${item.scope}:${item.text}`} className="my-1 flex justify-between gap-2.5">
                      <span>{item.text}</span>{item.scope && <span className="pt-px font-mono text-[11px] whitespace-nowrap text-muted">{item.scope}</span>}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <div className="total-rule mt-1 mb-1 flex justify-between gap-3 pt-2 font-semibold"><span className="whitespace-nowrap">{plural(changes, 'change')}</span><span title={update.version} className="truncate">{short(update.version)}</span></div>
        </>}
        <Action update={update} />
        <a href={changelogUrl(installed, update.version)} target="_blank" rel="noreferrer"
          className="self-center text-[12px] text-green underline underline-offset-[3px]">Full changelog on GitHub</a>
      </div>
    </div>
  );
}

const Version = ({ label, version, className }: { label: string; version: string; className?: string }) => (
  <div className={cx('min-w-0', className)}>
    <span className="block font-mono text-[10.5px] leading-4 tracking-[.08em] text-muted uppercase">{label}</span>
    <span title={version} className="block truncate text-[15px] leading-5 font-semibold">{short(version)}</span>
  </div>
);

/** "Download update", "Restart to update", or the download's progress filling the button. One button throughout, so
 *  keyboard focus stays on it as the download starts (aria-disabled, not disabled, which would drop focus). */
function Action({ update }: { update: Offer }) {
  const busy = update.status === 'downloading';
  return (
    <Button variant={busy ? 'default' : 'primary'} aria-disabled={busy || undefined} onClick={() => act(update)}
      className="relative mt-3.5 mb-2.5 w-full justify-center overflow-hidden py-2">
      {busy && <i aria-hidden className="absolute inset-y-0 left-0 bg-green/12 transition-[width]" style={{ width: `${update.percent}%` }} />}
      <span className="relative">{busy ? `Downloading… ${Math.floor(update.percent)}%` : update.status === 'ready' ? 'Restart to update' : 'Download update'}</span>
    </Button>
  );
}
