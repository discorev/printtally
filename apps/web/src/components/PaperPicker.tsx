import type { SelectHTMLAttributes } from 'react';
import type { PaperView } from 'print-accounting-contracts';
import { plural } from '../lib/format.ts';
import { RadioList, RadioOption } from './RadioList.tsx';
import { PaperSwatch } from './Swatches.tsx';

// Choosing a paper, wherever it's chosen: the radio list that corrects a job's paper, and a compact select
// for forms and the Jobs filter. Both list papers the same way: by name, in the order the API gives.
export type PickablePaper = Pick<PaperView, 'id' | 'name'> & { totals: Pick<PaperView['totals'], 'jobs'> };

/** The paper correction list (vPicker): swatch, name and print count, then "New paper…" if `onNew` is given. */
export function PaperPicker({ papers, value, onChange, onNew, label = 'Paper' }: {
  papers: PickablePaper[]; value: number | null; onChange: (paperId: number) => void; onNew?: () => void; label?: string;
}) {
  return (
    <RadioList label={label}>
      {papers.map(paper => (
        <RadioOption key={paper.id} checked={paper.id === value} onSelect={() => onChange(paper.id)} swatch={<PaperSwatch />}
          trailing={plural(paper.totals.jobs, 'print')}>{paper.name}</RadioOption>
      ))}
      {onNew && <RadioOption checked={false} dashed onSelect={onNew} trailing="set it up with its first stock">New paper…</RadioOption>}
    </RadioList>
  );
}

/** A value from PaperSelect: a paper id, 'new' ("New paper…"), one of `extra`'s values, or null (the placeholder). */
export type PaperChoice = number | string | null;
/** The compact select of the same papers: purchase and write-off forms ("Choose a paper", "New paper…") and
 *  the Jobs filter ("All papers", plus `extra` entries such as media with no paper set up). */
export function PaperSelect({ papers, value, onChange, placeholder, allowNew, extra = [], ...props }: {
  papers: PickablePaper[]; value: PaperChoice; onChange: (value: PaperChoice) => void;
  placeholder?: string; allowNew?: boolean; extra?: { value: string; label: string }[];
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'>) {
  return (
    <select value={value === null ? '' : String(value)} {...props}
      onChange={event => { const v = event.target.value; onChange(v === '' ? null : /^\d+$/.test(v) ? Number(v) : v); }}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {papers.map(paper => <option key={paper.id} value={paper.id}>{paper.name}</option>)}
      {extra.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
      {allowNew && <option value="new">New paper…</option>}
    </select>
  );
}
