import { createFileRoute } from '@tanstack/react-router';
import { NewStockDocket } from '../../screens/ink/NewStockDocket.tsx';
import { useInkChannels } from '../../screens/ink/useInkChannels.ts';

// ?form=added: a whole set was just added, so the docket shows the confirmation.
export const Route = createFileRoute('/_app/ink/new')({
  component: NewStock,
  validateSearch: (search: Record<string, unknown>): { form?: 'added' } => ({ form: search.form === 'added' ? 'added' : undefined }),
});

function NewStock() {
  const { channels } = useInkChannels(), { form } = Route.useSearch();
  return channels ? <NewStockDocket channels={channels} added={form === 'added'} /> : null;
}
