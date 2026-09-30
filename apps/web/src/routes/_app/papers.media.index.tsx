import { createFileRoute } from '@tanstack/react-router';

// The Media tab with no media type selected.
export const Route = createFileRoute('/_app/papers/media/')({ component: () => null });
