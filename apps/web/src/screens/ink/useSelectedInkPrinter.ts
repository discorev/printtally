import { useNavigate, useSearch } from '@tanstack/react-router';
import { usePrinters } from '../../api/queries.ts';

/** Ink's printer is an archived ID; without one the first archived printer is selected. */
export function useSelectedInkPrinter() {
  const search = useSearch({ from: '/_app/ink' });
  const navigate = useNavigate({ from: '/ink' });
  const printers = usePrinters().data?.printers ?? [];
  const selected = printers.find(printer => printer.id === search.printer) ?? printers[0];
  return { printers, selected, printerId: search.printer, select: (id: number) =>
    void navigate({ search: prev => ({ ...prev, printer: id }), replace: true }) };
}
