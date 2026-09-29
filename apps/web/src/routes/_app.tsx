import { createFileRoute, Outlet } from '@tanstack/react-router';
import { AppShell } from '../shell/Shell.tsx';

// Every screen with the top bar and nav: jobs, papers, ink, collect, settings.
export const Route = createFileRoute('/_app')({ component: () => <AppShell><Outlet /></AppShell> });
