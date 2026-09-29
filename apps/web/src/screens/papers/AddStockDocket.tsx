import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Docket, DocketHead, PaperPurchaseForm, type PaperPurchaseDraft } from '../../components/index.ts';
import { useMediaTypes, usePapers } from '../../api/queries.ts';
import { mediaName, type PurchasePrefill } from './common.ts';

// "Add stock" from the Papers head (vNewPaperDocket): the purchase form with no paper chosen yet. The head
// follows the form: "Add stock", the chosen paper's name, or "New paper" as it's set up. Once saved it
// opens the paper's docket with the confirmation. With `media` (a print with no paper set up) it starts a new
// paper printed as that media, named after it, at the print's size and date.
const CLOSE = { to: { to: '/papers' }, label: 'Papers' } as const;
export interface AddStockSearch extends PurchasePrefill { media?: string }

export function AddStockDocket({ media: mediaId, size, date }: AddStockSearch) {
  const navigate = useNavigate();
  const papers = usePapers().data?.papers ?? [], mediaTypes = useMediaTypes(), media = mediaTypes.data?.media_types ?? [];
  const from = media.find(m => m.source_media_id === mediaId);
  const [draft, setDraft] = useState<PaperPurchaseDraft>({ paper: mediaId ? 'new' : null, name: '', media: mediaId ?? '' });
  const isNew = draft.paper === 'new', paper = papers.find(p => p.id === draft.paper);
  const printsAs = media.find(m => m.source_media_id === draft.media);
  const title = isNew ? draft.name.trim() || 'New paper' : paper?.name ?? 'Add stock';
  const subtitle = isNew ? (printsAs ? `Prints as “${mediaName(printsAs)}”` : 'Set up the paper with its first stock.') : paper ? undefined : 'A pack of sheets or a roll you have bought.';
  return (
    <Docket label="Add stock" close={CLOSE}>
      <DocketHead when={isNew || paper ? 'Paper' : 'Stock'} title={title} subtitle={subtitle} />
      {/* The form reads `initial` once, so a new paper named after its media waits for the media types. */}
      {(!mediaId || mediaTypes.data) && <PaperPurchaseForm papers={papers} mediaTypes={media} onDraft={setDraft}
        initial={mediaId ? { paperId: 'new', stockId: 'new', media: mediaId, name: from ? mediaName(from).replace(/Hahnemuehle/g, 'Hahnemühle') : '', size, date } : { size, date }} onCancel={() => void navigate(CLOSE.to)}
        onSaved={s => void navigate({ to: '/papers/$paperId', params: { paperId: String(s.paperId) }, search: { form: 'purchase', saved: s.date } })} />}
    </Docket>
  );
}
