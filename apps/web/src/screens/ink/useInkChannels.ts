import { useMemo } from 'react';
import { useInk } from '../../api/queries.ts';
import { useSelectedInkPrinter } from './useSelectedInkPrinter.ts';
import { inkChannels } from './channels.ts';

/** The Ink screen's data: the channels (undefined while loading), the ledger's settings and ink totals, and why it didn't load. */
export function useInkChannels() {
  const { printerId, ready } = useSelectedInkPrinter();
  const { data, error } = useInk(printerId, ready);
  return { channels: useMemo(() => data && inkChannels(data), [data]), settings: data?.settings, totals: data?.totals, error };
}
