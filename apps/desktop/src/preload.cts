// CommonJS (.cts emits preload.cjs): Electron runs a sandboxed preload as a plain script, not an ES module.
import electron = require('electron');
import type { IpcRendererEvent } from 'electron';
import type { Connection } from './server-manager.ts';

// Narrow surface for the renderer: the app's version, connection info and switching computer. Everything else
// (printer access, SQL, accounting rules) stays out of the renderer entirely; it talks to the
// server over HTTP like a browser.
const { contextBridge, ipcRenderer } = electron;
contextBridge.exposeInMainWorld('printtally', {
  // The desktop app's version label (docs/build.md): X.Y.Z for a release, X.Y.Z-local+… for a local build.
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  getConnection: (): Promise<Connection> => ipcRenderer.invoke('connection:get'),
  // A pairing link or address of another computer; none for this Mac.
  switchComputer: (target?: string): Promise<void> => ipcRenderer.invoke('connection:switch-computer', target),
  onConnectionChange(callback: (connection: Connection) => void): () => void {
    const listener = (_event: IpcRendererEvent, connection: Connection): void => callback(connection);
    ipcRenderer.on('connection', listener);
    return () => ipcRenderer.off('connection', listener);
  },
});
