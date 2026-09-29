import { createFileRoute, Outlet, useParams } from '@tanstack/react-router';
import { InkPad } from '../../screens/ink/InkPad.tsx';
import { useInkChannels } from '../../screens/ink/useInkChannels.ts';

// The cartridges; the selected channel's docket (/ink/$channel) or Add stock (/ink/new) renders beside the list through the Outlet.
export const Route = createFileRoute('/_app/ink')({ component: Ink });

function Ink() {
  const { channels, settings } = useInkChannels();
  const { channel } = useParams({ strict: false });
  return <><InkPad channels={channels} settings={settings} selected={channel} /><Outlet /></>;
}
