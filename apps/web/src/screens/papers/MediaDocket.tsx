import { ButtonLink, Docket, DocketHead, LoadingHead, DocketSection, ItemLine, KV, Money, PaperLine, RowActions, Sub, SummaryLine } from '../../components/index.ts';
import { useMediaTypes, usePapers } from '../../api/queries.ts';
import { dateShort, dateTime, ml, plural } from '../../lib/format.ts';
import { mediaName, methodName } from './common.ts';

// A printer media type's docket (vMediaDocket): what the printer says about it, the papers that print as it
// (set on the paper), and its prints.
const CLOSE = { to: { to: '/papers/media' }, label: 'Papers' } as const;
// Canon's own media types carry an all-zero id; the rest were added to the printer as custom media.
const canonMedia = (id: string) => /-00000000-0000-0000-0000-\d{12}$/.test(id);

export function MediaDocket({ id }: { id: string }) {
  const { data } = useMediaTypes(), settings = usePapers().data?.settings;
  const media = data?.media_types.find(m => m.source_media_id === id);
  if (!data) return <Docket label="Printer media" close={CLOSE}><LoadingHead when="Printer media" what="this media type" /></Docket>;
  if (!media) return (
    <Docket label="Printer media" close={CLOSE}><DocketHead when="Printer media" title="Media type not found" />
      <DocketSection><Sub>The printer hasn't reported this media type.</Sub></DocketSection></Docket>
  );
  const { papers, totals } = media;
  return (
    <Docket label="Printer media" close={CLOSE}>
      <DocketHead when="Printer media" title={mediaName(media)} />
      <DocketSection label="On the printer">
        <KV rows={[
          ['Type', canonMedia(id) ? 'Canon media type' : 'Custom media type'],
          ['Seen', media.last_seen_at ? `${dateTime(media.last_seen_at)} collection${media.present_on_printer ? '' : ' · no longer on the printer'}` : 'Not yet — only a paper names it'],
          ['First print', media.first_job_on ? dateShort(media.first_job_on) : '—'],
          ['Last print', media.last_job_on ? dateShort(media.last_job_on) : '—'],
        ]} />
      </DocketSection>
      <DocketSection label="Prints as this media">
        {papers.map(p => (
          <ItemLine key={p.id} name={<PaperLine name={p.name} />}
            value={<ButtonLink to="/papers/$paperId" params={{ paperId: String(p.id) }} variant="text" size="sm">Open</ButtonLink>} />
        ))}
        {!papers.length && <Sub tone={media.jobs ? 'amber' : undefined}>No paper yet{media.jobs ? ', so these prints have no paper cost' : ''}. Set it on the paper, under Stock.</Sub>}
        {papers.length > 1 && <Sub className="mt-1.5">A print is assumed to be whichever of these papers had stock at its size on the day.</Sub>}
      </DocketSection>
      <DocketSection label="Prints">
        <SummaryLine what={<>{plural(totals.jobs, 'print')} · {ml(totals.ink_nl)} of ink</>}
          sub={papers.length ? `paper at the ${settings ? methodName(settings) : 'chosen'} price` : 'ink only — paper cost unknown'} amount={<Money micros={totals.total_micros} />} />
        {media.jobs > 0 && (
          <RowActions>
            <ButtonLink to="/jobs" search={{ media: id }} variant="text" size="sm">Show in Jobs</ButtonLink>
          </RowActions>
        )}
      </DocketSection>
    </Docket>
  );
}
