import { createFileRoute } from '@tanstack/react-router';
import { Collect } from '../../screens/setup/Collect.tsx';

export const Route = createFileRoute('/_app/collect')({ component: Collect });
