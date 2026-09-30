import { useNavigate } from '@tanstack/react-router';
import { Docket, DocketHead, SavedNotice } from '../../components/index.ts';
import type { InkChannelView } from './channels.ts';
import { InkPurchaseForm, useShowAdded } from './InkPurchaseForm.tsx';

// "Add stock" from the Ink list's head (vInkStockDocket): no cartridge chosen yet. Once saved, the chosen
// cartridge's docket opens with the confirmation; a whole set's confirmation shows here (`added`), beside the list.
export function NewStockDocket({ channels, added }: { channels: InkChannelView[]; added?: boolean }) {
  const navigate = useNavigate(), showAdded = useShowAdded(), done = () => void navigate({ to: '/ink' });
  return (
    <Docket label="Add stock" close={{ to: { to: '/ink' }, label: 'Ink' }}>
      <DocketHead when="Stock" title="Add stock" subtitle="A cartridge, or a whole set, bought for the shelf." />
      {added
        ? <SavedNotice label="Stock" onDone={done}>Added to all {channels.length} cartridges.</SavedNotice>
        : <InkPurchaseForm channels={channels} onCancel={done} onSaved={showAdded} />}
    </Docket>
  );
}
