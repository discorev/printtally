import { createFileRoute } from '@tanstack/react-router';
import { Connect } from '../../screens/setup/Connect.tsx';

export const Route = createFileRoute('/_centered/connect')({ component: Connect });
