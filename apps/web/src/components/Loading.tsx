import { describeError } from '../api/client.ts';
import { useConnection } from '../connection/index.ts';
import { DocketHead } from './Docket.tsx';
import { Empty } from './Pad.tsx';

// What a screen shows before its first load. Once something has loaded it stays on screen while the server is
// lost (plan decision 6); only a screen that never loaded says it has to wait for the server.

/** "Loading papers…"; "Can't load papers until the server is back." while it's lost; or why the load failed. */
export function loadingText(what: string, lost: boolean, error?: unknown): string {
  if (lost) return `Can't load ${what} until the server is back.`;
  return error ? `Couldn't load ${what}. ${describeError(error)}` : `Loading ${what}…`;
}
export const useLoadingText = (what: string, error?: unknown): string => loadingText(what, useConnection().status === 'lost', error);

/** A list's placeholder until its query has data. Pass the query's error, if any. */
export const Loading = ({ what, error }: { what: string; error?: unknown }) => <Empty>{useLoadingText(what, error)}</Empty>;

/** A docket's head until its data loads. */
export function LoadingHead({ when, what }: { when: string; what: string }) {
  const lost = useConnection().status === 'lost';
  return <DocketHead when={when} title={lost ? 'Not loaded yet' : 'Loading…'} subtitle={lost ? loadingText(what, true) : undefined} />;
}
