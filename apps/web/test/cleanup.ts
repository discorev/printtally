// Bun caches modules, so an afterEach in a shared helper only attaches to the first test file that imports it.
// Helpers register their teardown here instead, and the preload (dom.ts) runs it after every test in every file.
const teardowns: (() => void)[] = [];
export const afterEachTest = (teardown: () => void): void => { teardowns.push(teardown); };

/** Runs every teardown, even when one throws (an unhandled API request), then reports the first failure. */
export function runTeardowns(): void {
  const errors: unknown[] = [];
  for (const teardown of teardowns) try { teardown(); } catch (error) { errors.push(error); }
  if (errors.length) throw errors[0];
}
