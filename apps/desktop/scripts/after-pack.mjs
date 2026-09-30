// electron-builder afterPack hook (electron-builder.yml): runs once the app is assembled, before the fuses are
// flipped and the app is signed, so the signatures cover the executables' new Mach-O UUIDs (macho-uuid.ts).
// electron-builder runs under Node, so this stays plain JavaScript and hands the work to Bun.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const script = fileURLToPath(new URL('macho-uuid.ts', import.meta.url));
  execFileSync('bun', [script, app, context.packager.appInfo.version], { stdio: 'inherit' });
}
