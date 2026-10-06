import { useEffect, type ReactNode } from 'react';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { Banner, Button, ButtonLink } from '../components/index.ts';
import { gateRedirect, onServerMachine, useConnection, useMissedJobs, useRetryCountdown, useServerName } from '../connection/index.ts';
import { desktop, useDesktopConnection } from '../desktop.ts';
import { LOCAL_NETWORK_BLOCKED } from '../api/client.ts';
import { count } from '../lib/format.ts';
import { cx } from '../lib/cx.ts';
import { SECTION_ICONS } from './icons.tsx';
import { showServerChip } from './serverChip.ts';
import { UpdateChip } from './UpdateChip.tsx';

const SECTIONS = [
  { to: '/jobs', label: 'Jobs', icon: SECTION_ICONS.jobs }, { to: '/papers', label: 'Papers', icon: SECTION_ICONS.papers },
  { to: '/ink', label: 'Ink', icon: SECTION_ICONS.ink }, { to: '/collect', label: 'Collect', icon: SECTION_ICONS.collect },
  { to: '/settings', label: 'Settings', icon: SECTION_ICONS.settings },
] as const;
const usePath = () => useRouterState({ select: state => state.location.pathname });

/** Follows the client state diagram: a revoked session (401) goes to /connect, a server with no printer yet to /setup. */
export function ConnectionGate() {
  const { status, health } = useConnection();
  const path = usePath(), navigate = useNavigate();
  useEffect(() => {
    const to = gateRedirect(status, health?.state, path);
    if (to) void navigate({ to });
  }, [status, health?.state, path, navigate]);
  return null;
}

/** The server chip at the top right (left of the update chip): the computer's name, and "retrying" (amber, pulsing) while it's lost.
 *  Hidden in the desktop app once it's running the server it started itself — naming the computer is only
 *  useful there for a borrowed local server or a remote host. The server-lost banner still shows regardless. */
function ServerChip() {
  const { status } = useConnection(), name = useServerName(), connection = useDesktopConnection();
  if (!showServerChip({ desktop: !!desktop, ownership: connection?.ownership })) return null;
  const lost = status === 'lost';
  const title = connection ? `Connected to ${name} (${connection.host}:${connection.port})` : `${onServerMachine() ? 'Serving on' : 'Connected to'} ${location.host}`;
  return (
    <span title={title} className={cx('inline-flex items-center gap-2 rounded-[3px] border py-1 pr-2.5 pl-[9px] text-[12px] leading-4 font-medium whitespace-nowrap phone:hidden',
      lost ? 'border-amber bg-black/25 text-amber' : 'border-white/28 bg-black/12 text-inherit')}>
      <i className={cx('block size-[7px] rounded-full bg-current', lost && 'animate-pulse-dot')} />{name}{lost && ' · retrying'}
    </span>
  );
}

function TopBar() {
  return (
    <header className="drag flex h-[52px] flex-none items-center gap-[26px] px-[22px] text-on-mat desktop:pl-[88px] phone:h-12 phone:gap-3 phone:px-4">
      <Link to="/jobs" className="font-slab text-[19px] leading-6 font-semibold tracking-[.005em] whitespace-nowrap text-inherit no-underline">Print Tally</Link>
      <nav aria-label="Sections" className="flex h-full gap-0.5 phone:hidden">
        {SECTIONS.map(section => (
          <Link key={section.to} to={section.to} activeProps={{ 'aria-current': 'page' }}
            className="relative flex h-full items-center px-2.5 text-[14px] leading-5 font-medium text-inherit no-underline opacity-72 hover:opacity-100 aria-[current=page]:opacity-100 aria-[current=page]:after:absolute aria-[current=page]:after:inset-x-2.5 aria-[current=page]:after:bottom-[9px] aria-[current=page]:after:h-0.5 aria-[current=page]:after:rounded-[1px] aria-[current=page]:after:bg-current">
            {section.label}</Link>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-2">
        <ServerChip />
        <UpdateChip />
      </div>
    </header>
  );
}

function BottomNav() {
  return (
    <nav aria-label="Sections" className="hidden h-14 flex-none border-t border-white/12 bg-mat-deep phone:flex">
      {SECTIONS.map(section => (
        <Link key={section.to} to={section.to} activeProps={{ 'aria-current': 'page' }}
          className="flex flex-1 flex-col items-center justify-center gap-[3px] text-[11px] leading-[14px] font-medium text-[#E4E8E5] no-underline opacity-70 aria-[current=page]:opacity-100">
          {section.icon}{section.label}</Link>
      ))}
    </nav>
  );
}

/** "Can't reach Print Tally on studio-mac — retrying" while the server is lost; "Switch computer" on the desktop app when it's on a remote host. */
function LostBanner() {
  const { status } = useConnection(), name = useServerName(), seconds = useRetryCountdown();
  const connection = useDesktopConnection(), navigate = useNavigate();
  if (status !== 'lost') return null;
  return (
    <Banner detail={seconds ? `retry in ${seconds} s` : 'retrying now…'}
      action={desktop && connection?.remote && <Button variant="text" size="sm" onClick={() => void navigate({ to: '/connect' })}>Switch computer</Button>}>
      Can't reach Print Tally on {name} — retrying
    </Banner>
  );
}

/** The Jobs screen's warning that the printer's log moved past the last job collected. */
function MissedBanner() {
  const missed = useMissedJobs(), path = usePath(), navigate = useNavigate();
  const gap = missed[0];
  if (!gap || !path.startsWith('/jobs')) return null;
  return (
    <Banner action={<Button variant="text" size="sm" onClick={() => void navigate({ to: '/collect' })}>Details</Button>}>
      Some jobs may have been missed. Print Tally last collected job {count(gap.fromRecord - 1)} but the printer's log now starts at job {count(gap.toRecord + 1)}.
      {missed.length > 1 && ` ${missed.length - 1} more ${missed.length === 2 ? 'gap' : 'gaps'} under Collect.`}
    </Banner>
  );
}

/** A printer that needs you before Print Tally can collect from it: its certificate changed (so the password is
 *  withheld), or it has no password. On every main screen but Collect, which says the same in full. */
function PrinterBanner() {
  const { status, health } = useConnection(), path = usePath();
  if (status !== 'connected' || path.startsWith('/collect')) return null;
  return health?.printers.map(printer =>
    printer.state === 'needs_confirming' ? (
      <Banner key={printer.id} action={<ButtonLink variant="text" size="sm" to="/setup" search={{ host: printer.host }}>Check the fingerprint</ButtonLink>}>
        {printer.name}'s certificate changed, so Print Tally won't send it the password or collect from it.
      </Banner>
    ) : printer.state === 'needs_password' ? (
      <Banner key={printer.id} action={<ButtonLink variant="text" size="sm" to="/settings">Enter the password</ButtonLink>}>
        Print Tally has no password for {printer.name}, so it can't collect from it.
      </Banner>
    ) : printer.state === 'local_network_blocked' ? (
      <Banner key={printer.id}>{LOCAL_NETWORK_BLOCKED}</Banner>
    ) : null);
}

/** The app: the mat, the top bar, the strips, the work area (pad and docket side by side), and the phone's bottom nav. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="mat relative flex h-full flex-col text-ink">
      <TopBar />
      <LostBanner />
      <PrinterBanner />
      <MissedBanner />
      <main className="flex min-h-0 flex-1 gap-4 px-4 pb-4 phone:gap-2 phone:px-2 phone:pb-2">{children}</main>
      <BottomNav />
    </div>
  );
}

/** Setup and Connect: no top bar or nav, one docket centred on the mat, and the update drop at the top right. */
export function CenteredShell({ children }: { children: ReactNode }) {
  return (
    <div className="mat relative flex h-full flex-col text-ink">
      <div className="drag relative hidden h-7 flex-none desktop:block">
        <div className="absolute top-2 right-[14px]"><UpdateChip /></div>
      </div>
      <LostBanner />
      <main className="flex min-h-0 flex-1 items-center justify-center px-4 pt-2 pb-4 phone:px-2 phone:pb-2">{children}</main>
    </div>
  );
}
