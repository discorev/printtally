import { useEffect, type ReactNode } from 'react';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { Banner, Button } from '../components/index.ts';
import { useConnection, useMissedJobs, useRetryCountdown, useServerName } from '../connection/index.ts';
import { desktop, useDesktopConnection } from '../desktop.ts';
import { count } from '../lib/format.ts';
import { cx } from '../lib/cx.ts';
import { SECTION_ICONS } from './icons.tsx';

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
    if (status === 'unauthorized' && path !== '/connect') void navigate({ to: '/connect' });
    else if (status === 'connected' && health?.state === 'needs_printer' && path !== '/setup' && path !== '/connect') void navigate({ to: '/setup' });
  }, [status, health?.state, path, navigate]);
  return null;
}

/** The server chip at the top right: the computer's name, and "retrying" (amber, pulsing) while it's lost. */
function ServerChip() {
  const { status } = useConnection(), name = useServerName(), connection = useDesktopConnection();
  const lost = status === 'lost';
  const title = connection ? `Connected to ${name} (${connection.host}:${connection.port})` : `Serving on ${location.host}`;
  return (
    <span title={title} className={cx('ml-auto inline-flex items-center gap-2 rounded-[3px] border py-1 pr-2.5 pl-[9px] text-[12px] leading-4 font-medium whitespace-nowrap phone:hidden',
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
      <ServerChip />
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

/** The app: the mat, the top bar, the strips, the work area (pad and docket side by side), and the phone's bottom nav. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="mat relative flex h-full flex-col text-ink">
      <TopBar />
      <LostBanner />
      <MissedBanner />
      <main className="flex min-h-0 flex-1 gap-4 px-4 pb-4 phone:gap-2 phone:px-2 phone:pb-2">{children}</main>
      <BottomNav />
    </div>
  );
}

/** Setup and Connect: no top bar or nav, one docket centred on the mat. */
export function CenteredShell({ children }: { children: ReactNode }) {
  return (
    <div className="mat relative flex h-full flex-col text-ink">
      <div className="drag hidden h-7 flex-none desktop:block" />
      <LostBanner />
      <main className="flex min-h-0 flex-1 items-center justify-center px-4 pt-2 pb-4 phone:px-2 phone:pb-2">{children}</main>
    </div>
  );
}
