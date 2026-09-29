import type { LinkProps } from '@tanstack/react-router';
import { Docket, DocketHead, DocketSection, Pad, PadBody, PadHead, Sub } from './components/index.ts';

// Stand-ins until each screen is built (plan step 05). Screen agents replace these route bodies.
export const PlaceholderPad = ({ title }: { title: string }) => (
  <Pad label={title}><PadHead title={title} meta="Coming in step 05" /><PadBody /></Pad>
);
export const PlaceholderDocket = ({ title, back, to }: { title: string; back: string; to: LinkProps['to'] }) => (
  <Docket label={title} close={{ to: { to }, label: back }}>
    <DocketHead when={back} title={title} />
    <DocketSection><Sub>Coming in step 05.</Sub></DocketSection>
  </Docket>
);
