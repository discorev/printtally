import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DEFAULT_PORT, LOCAL_PORT, defaultDataDirectory, localDataDirectory } from './paths.ts';

// release: built by CI (or PRINTTALLY_RELEASE=1) with the real ledger. local: `bun run dist:desktop`, for
// testing against dummy data. dev: `bun run dev:desktop` from source. apps/desktop/scripts/bundle.sh writes
// dist/build-info.json into packaged builds; without it the app runs from source.
export type BuildKind = 'release' | 'local' | 'dev';
export interface BuildInfo { kind: BuildKind; version: string }

export function readBuildInfo(file: string, packaged: boolean, packageVersion: string): BuildInfo {
  if (existsSync(file)) {
    const info = JSON.parse(readFileSync(file, 'utf8')) as Partial<BuildInfo>;
    if ((info.kind === 'release' || info.kind === 'local') && typeof info.version === 'string') return { kind: info.kind, version: info.version };
  }
  // A packaged app without valid build info wasn't made by apps/desktop/scripts/bundle.sh: keep it off the real ledger.
  return packaged ? { kind: 'local', version: `${packageVersion}-local` } : { kind: 'dev', version: `${packageVersion}-dev` };
}

export interface RuntimeSettings {
  port: number; dataDirectory: string;
  // The app's own settings (the saved remote host, the window's session); undefined keeps Electron's default.
  userData?: string;
  serverEnv: Record<string, string>;
}

const portFrom = (text: string | undefined): number | undefined => {
  const port = Number(text);
  return text && Number.isInteger(port) && port > 0 && port < 65536 ? port : undefined;
};

// Which port and data folder a build uses. A release build always uses the real ledger on 4318 and ignores
// the overrides, so it can never start a second ledger. A local build defaults to its own folder and 4319, so
// it never borrows or opens the release server, and keeps its settings and printer passwords apart too.
export function runtimeSettings(kind: BuildKind, env: Record<string, string | undefined>, home: string): RuntimeSettings {
  const dataDirectory = env.PRINTTALLY_DATA_DIR ? resolve(env.PRINTTALLY_DATA_DIR) : undefined;
  if (kind === 'release') return { port: DEFAULT_PORT, dataDirectory: defaultDataDirectory(home), serverEnv: {} };
  if (kind === 'local') return {
    port: portFrom(env.PRINTTALLY_PORT) ?? LOCAL_PORT, dataDirectory: dataDirectory ?? localDataDirectory(home),
    userData: join(localDataDirectory(home), 'desktop'), serverEnv: { PRINTTALLY_MEMORY_SECRETS: '1' },
  };
  return { port: portFrom(env.PRINTTALLY_PORT) ?? DEFAULT_PORT, dataDirectory: dataDirectory ?? defaultDataDirectory(home), serverEnv: {} };
}
