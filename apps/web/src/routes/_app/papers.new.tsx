import { createFileRoute } from '@tanstack/react-router';
import { AddStockDocket, type AddStockSearch } from '../../screens/papers/AddStockDocket.tsx';
import { prefillSearch } from '../../screens/papers/common.ts';

// "Add stock" with no paper chosen yet, including setting up a new paper. ?media=<source_media_id> starts a new
// paper printed as that media (a job with no paper set up), with ?size= and ?date= from the print.
export const Route = createFileRoute('/_app/papers/new')({
  validateSearch: (search: Record<string, unknown>): AddStockSearch => ({
    media: typeof search.media === 'string' && search.media ? search.media : undefined, ...prefillSearch(search),
  }),
  component: function AddStock() { return <AddStockDocket {...Route.useSearch()} />; },
});
