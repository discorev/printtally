import { createFileRoute, Outlet } from '@tanstack/react-router';
import { JobsPad } from '../../screens/jobs/JobsPad.tsx';
import { validateJobsSearch } from '../../screens/jobs/search.ts';

// The jobs list; the selected job's docket (/jobs/$jobId) renders beside it through the Outlet.
export const Route = createFileRoute('/_app/jobs')({ validateSearch: validateJobsSearch, component: () => <><JobsPad /><Outlet /></> });
