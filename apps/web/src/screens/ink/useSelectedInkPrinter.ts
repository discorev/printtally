import { useNavigate, useSearch } from '@tanstack/react-router';
import { usePrinters } from '../../api/queries.ts';

/** Ink's printer is an archived ID; without one the first archived printer is selected. */
export function useSelectedInkPrinter() {
  const search = useSearch({ from: '/_app/ink' });
  const navigate = useNavigate({ from: '/ink' });
  const data = usePrinters().data;
  const printers = data?.printers ?? [];
  const selected = printers.find(printer => printer.id === search.printer) ?? printers[0];
  return { printers, selected, ready: !!data, printerId: selected?.id === search.printer ? search.printer : undefined, select: (id: number) =>
    void navigate({ search: prev => ({ ...prev, printer: id }), replace: true }) };
}
