import { createFileRoute } from '@tanstack/react-router';
import { JobDocket } from '../../screens/jobs/JobDocket.tsx';

export const Route = createFileRoute('/_app/jobs/$jobId')({ component: Docket });

function Docket() {
  const { jobId } = Route.useParams();
  return <JobDocket jobId={Number(jobId)} />;
}
