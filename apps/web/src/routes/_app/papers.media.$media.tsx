import { createFileRoute } from '@tanstack/react-router';
import { MediaDocket } from '../../screens/papers/MediaDocket.tsx';

// $media is the printer's source_media_id.
export const Route = createFileRoute('/_app/papers/media/$media')({ component: function Media() { return <MediaDocket id={Route.useParams().media} />; } });
