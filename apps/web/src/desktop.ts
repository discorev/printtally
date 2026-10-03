import { useEffect, useState } from 'react';

// The Electron preload bridge (apps/desktop/src/preload.cts). Present only in the desktop app, so
// `desktop` being undefined means a browser. It exposes the app's version, connection info, "switch computer"
// and its own updates, nothing else.
// Mirrors apps/desktop/src/server-manager.ts's Connection and updater.ts's state; the UI never imports the desktop app.
export type ServerOwnership = 'owned' | 'borrowed' | 'remote';
export interface DesktopConnection {
  host: string; port: number; owns: boolean; remote: boolean; ownership: ServerOwnership;
  status: 'ready' | 'unreachable' | 'port_in_use' | 'failed';
}
export interface PrintTallyBridge extends UpdateBridge {
  /** The desktop app's version label. Missing from apps built before it was added. */
  getVersion?(): Promise<string>;
  getConnection(): Promise<DesktopConnection>;
  /** A pairing link or another computer's address; none for this Mac. Loads that computer's UI. */
  switchComputer(target?: string): Promise<void>;
  onConnectionChange(callback: (connection: DesktopConnection) => void): () => void;
}
/** An app release on offer: `notes` are its release-please markdown, `date` an ISO timestamp. */
export interface UpdateInfo { version: string; notes: string; date: string }
/** 'disabled': no updater in this build (dev, or a local build without a feed). 'idle': nothing to offer, or the check failed. */
export type UpdateState =
  | { status: 'disabled' } | { status: 'idle' }
  | ({ status: 'available' } & UpdateInfo)
  | ({ status: 'downloading'; percent: number } & UpdateInfo)
  | ({ status: 'ready' } & UpdateInfo);
/** The app's self-update. Missing from apps built before it was added, which can still show another computer's newer UI. */
export interface UpdateBridge {
  getUpdate?(): Promise<UpdateState>;
  onUpdateChange?(callback: (state: UpdateState) => void): () => void;
  /** Download the update on offer. */
  downloadUpdate?(): Promise<void>;
  /** Stop the server, install the downloaded update and relaunch. */
  installUpdate?(): Promise<void>;
  /** "Download updates automatically", stored per Mac by the desktop app; off by default. */
  getAutoDownload?(): Promise<boolean>;
  setAutoDownload?(on: boolean): Promise<void>;
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

/** The desktop app's own version; undefined in a browser or until known. */
export function useDesktopVersion(): string | undefined {
  const [version, setVersion] = useState<string>();
  useEffect(() => {
    let live = true;
    void desktop?.getVersion?.().then(value => { if (live) setVersion(value); });
    return () => { live = false; };
  }, []);
  return version;
}

/** The app's update state; undefined in a browser, in an app too old to update itself, or until known. */
export function useDesktopUpdate(): UpdateState | undefined {
  const [update, setUpdate] = useState<UpdateState>();
  useEffect(() => {
    if (!desktop?.getUpdate || !desktop.onUpdateChange) return;
    // Listen before asking, and let a pushed change win over the reply, so a change during load isn't lost.
    let live = true, pushed = false;
    const off = desktop.onUpdateChange(value => { pushed = true; setUpdate(value); });
    void desktop.getUpdate().then(value => { if (live && !pushed) setUpdate(value); });
    return () => { live = false; off(); };
  }, []);
  return update;
}

/** "Download updates automatically" and its setter; undefined in a browser, in an app without the setting, or until known. */
export function useAutoDownload(): [on: boolean | undefined, set: (on: boolean) => void] {
  const [on, setOn] = useState<boolean>();
  useEffect(() => {
    let live = true;
    void desktop?.getAutoDownload?.().then(value => { if (live) setOn(value); });
    return () => { live = false; };
  }, []);
  const set = (value: boolean) => {
    setOn(value);
    void desktop?.setAutoDownload?.(value).catch(() => setOn(!value));
  };
  return [on, set];
}
