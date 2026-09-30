import { createFileRoute } from '@tanstack/react-router';
import { Settings } from '../../screens/setup/Settings.tsx';

export const Route = createFileRoute('/_app/settings')({ component: Settings });
