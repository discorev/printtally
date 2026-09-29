import { useEffect, useState } from 'react';

// The Electron preload bridge (apps/desktop/src/preload.cts). Present only in the desktop app, so
// `desktop` being undefined means a browser. It exposes connection info and "switch computer", nothing else.
// Mirrors apps/desktop/src/server-manager.ts's Connection; the UI never imports the desktop app.
export interface DesktopConnection {
  host: string; port: number; owns: boolean; remote: boolean;
  status: 'ready' | 'unreachable' | 'port_in_use' | 'failed';
}
export interface PrintTallyBridge {
  getConnection(): Promise<DesktopConnection>;
  /** A pairing link or another computer's address; none for this Mac. Loads that computer's UI. */
  switchComputer(target?: string): Promise<void>;
  onConnectionChange(callback: (connection: DesktopConnection) => void): () => void;
}
declare global {
  interface Window { printtally?: PrintTallyBridge }
}

export const desktop: PrintTallyBridge | undefined = typeof window === 'undefined' ? undefined : window.printtally;

/** The desktop app's connection (which computer, whether it's remote); undefined in a browser or until known. */
export function useDesktopConnection(): DesktopConnection | undefined {
  const [connection, setConnection] = useState<DesktopConnection>();
  useEffect(() => {
    if (!desktop) return;
    let live = true;
    void desktop.getConnection().then(value => { if (live) setConnection(value); });
    const off = desktop.onConnectionChange(setConnection);
    return () => { live = false; off(); };
  }, []);
  return connection;
}
