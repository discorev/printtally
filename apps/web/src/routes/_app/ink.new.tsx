import { createFileRoute } from '@tanstack/react-router';
import { NewStockDocket } from '../../screens/ink/NewStockDocket.tsx';
import { useInkChannels } from '../../screens/ink/useInkChannels.ts';

export const Route = createFileRoute('/_app/ink/new')({ component: NewStock });

function NewStock() {
  const { channels } = useInkChannels();
  return channels ? <NewStockDocket channels={channels} /> : null;
}
