import { createFileRoute } from '@tanstack/react-router';
import { Setup } from '../../screens/setup/Setup.tsx';

// ?host=… checks a known printer again (e.g. after its certificate changed) instead of finding one.
export const Route = createFileRoute('/_centered/setup')({
  validateSearch: (search: Record<string, unknown>): { host?: string } => typeof search.host === 'string' ? { host: search.host } : {},
  component: SetupRoute,
});

function SetupRoute() {
  const { host } = Route.useSearch();
  return <Setup key={host ?? ''} host={host} />;
}
