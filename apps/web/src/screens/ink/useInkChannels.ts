import { useMemo } from 'react';
import { useInk } from '../../api/queries.ts';
import { inkChannels } from './channels.ts';

/** The Ink screen's data: the channels (undefined while loading) and the ledger's settings. */
export function useInkChannels() {
  const { data } = useInk();
  return { channels: useMemo(() => data && inkChannels(data), [data]), settings: data?.settings };
}
