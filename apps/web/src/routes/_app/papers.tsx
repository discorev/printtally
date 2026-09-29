import { createFileRoute, Outlet } from '@tanstack/react-router';
import { PapersPad } from '../../screens/papers/PapersPad.tsx';

// Papers, Stock tab (/papers, /papers/$paperId, /papers/new) and Media tab (/papers/media, /papers/media/$media); the
// selected paper's or media type's docket renders beside the list through the Outlet.
export const Route = createFileRoute('/_app/papers')({ component: () => <><PapersPad /><Outlet /></> });
