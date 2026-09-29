import { createFileRoute, Outlet } from '@tanstack/react-router';
import { CenteredShell } from '../shell/Shell.tsx';

// Setup and Connect: one card in the middle of the mat, no nav.
export const Route = createFileRoute('/_centered')({ component: () => <CenteredShell><Outlet /></CenteredShell> });
