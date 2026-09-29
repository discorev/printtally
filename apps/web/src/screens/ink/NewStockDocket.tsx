import { useNavigate } from '@tanstack/react-router';
import { Docket, DocketHead } from '../../components/index.ts';
import type { InkChannelView } from './channels.ts';
import { InkPurchaseForm } from './InkPurchaseForm.tsx';

// "Add stock" from the Ink list's head (vInkStockDocket): no cartridge chosen yet. Once saved, the chosen
// cartridge's docket opens with the confirmation.
export function NewStockDocket({ channels }: { channels: InkChannelView[] }) {
  const navigate = useNavigate();
  return (
    <Docket label="Add stock" close={{ to: { to: '/ink' }, label: 'Ink' }}>
      <DocketHead when="Stock" title="Add stock" subtitle="A cartridge you have bought for the shelf." />
      <InkPurchaseForm channels={channels} onCancel={() => void navigate({ to: '/ink' })}
        onSaved={code => void navigate({ to: '/ink/$channel', params: { channel: code }, search: { form: 'added' } })} />
    </Docket>
  );
}
