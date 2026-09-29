import { createFileRoute, Navigate } from '@tanstack/react-router';
import { Docket, LoadingHead } from '../../components/index.ts';
import { CartridgeDocket, type CartridgeForm } from '../../screens/ink/CartridgeDocket.tsx';
import { unseenChannel } from '../../screens/ink/channels.ts';
import { useInkChannels } from '../../screens/ink/useInkChannels.ts';

const FORMS: CartridgeForm[] = ['purchase', 'writeoff', 'added', 'written-off'];
export const Route = createFileRoute('/_app/ink/$channel')({
  component: Cartridge,
  validateSearch: (search: Record<string, unknown>): { form?: CartridgeForm } =>
    ({ form: FORMS.find(form => form === search.form) }),
});

function Cartridge() {
  const { channel: code } = Route.useParams(), { form } = Route.useSearch();
  const { channels, settings } = useInkChannels();
  if (!channels) return <Docket label="Cartridge" close={{ to: { to: '/ink' }, label: 'Ink' }}><LoadingHead when="Cartridge" what="this cartridge" /></Docket>;
  const channel = channels.find(c => c.code === code) ?? unseenChannel(code);
  if (!channel) return <Navigate to="/ink" replace />;
  return <CartridgeDocket key={code} channel={channel} channels={channels} settings={settings} form={form} />;
}
