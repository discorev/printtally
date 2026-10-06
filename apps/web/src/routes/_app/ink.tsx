import { createFileRoute, Outlet, useParams } from '@tanstack/react-router';
import { InkPad } from '../../screens/ink/InkPad.tsx';
import { useInkChannels } from '../../screens/ink/useInkChannels.ts';

// The cartridges; the selected channel's docket (/ink/$channel) or Add stock (/ink/new) renders beside the list through the Outlet.
export const Route = createFileRoute('/_app/ink')({
  validateSearch: (search: Record<string, unknown>): { printer?: number } => ({
    printer: (typeof search.printer === 'string' || typeof search.printer === 'number') && /^\d+$/.test(String(search.printer)) && Number.isSafeInteger(Number(search.printer)) && Number(search.printer) > 0
      ? Number(search.printer) : undefined,
  }), component: Ink,
});

function Ink() {
  const { channels, settings, totals, error } = useInkChannels();
  const { channel } = useParams({ strict: false });
  return <><InkPad channels={channels} settings={settings} totals={totals} selected={channel} error={error} /><Outlet /></>;
}
