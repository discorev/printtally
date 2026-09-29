import { createFileRoute } from '@tanstack/react-router';
import { PaperDocket, type PaperSearch } from '../../screens/papers/PaperDocket.tsx';
import { prefillSearch } from '../../screens/papers/common.ts';

// A paper's docket; ?form=purchase|writeoff opens its form (a purchase prefilled by ?size=A4&date=YYYY-MM-DD),
// and ?saved= shows the form's confirmation.
export const Route = createFileRoute('/_app/papers/$paperId')({
  validateSearch: (search: Record<string, unknown>): PaperSearch => ({
    form: search.form === 'purchase' || search.form === 'writeoff' ? search.form : undefined,
    saved: typeof search.saved === 'string' && search.saved ? search.saved : undefined,
    ...prefillSearch(search),
  }),
  component: function Paper() {
    const { paperId } = Route.useParams(), search = Route.useSearch();
    return <PaperDocket key={paperId} paperId={Number(paperId)} {...search} />;
  },
});
