import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api.ts';

export const Route = createFileRoute('/')({ component: Home });

function Home() {
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, retry: false });
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 text-center">
      <h1 className="text-2xl font-semibold">Print Tally</h1>
      {health.isPending && <p>Checking the server…</p>}
      {health.isError && <p className="text-red-600">Can't reach the server: {health.error.message}</p>}
      {health.data && <p>Connected · API v{health.data.apiVersion}</p>}
    </main>
  );
}
