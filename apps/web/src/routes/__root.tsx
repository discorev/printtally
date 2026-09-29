import { createRootRoute, Outlet } from '@tanstack/react-router';
import { ConnectionGate } from '../shell/Shell.tsx';

export const Route = createRootRoute({ component: Root });

function Root() {
  return <><ConnectionGate /><Outlet /></>;
}
