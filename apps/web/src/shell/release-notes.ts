// The update receipt's line items, from the release notes the desktop app's update feed carries
// (release-please markdown: "### Features" headings over "* **scope:** text" bullets).
export interface ReleaseNote { text: string; scope?: string }
export interface ReleaseGroup { title: string; items: ReleaseNote[] }

const TITLES: Record<string, string> = { 'Features': 'New', 'Bug Fixes': 'Fixed', 'Performance Improvements': 'Faster' };

/** Commit links, issue refs and leftover markdown out of a bullet: "[x](url)" → "x", "([abc1234](url))" and "(#12)" go. */
const clean = (text: string): string => text
  .replace(/\s*\(\[[0-9a-f]{7,40}\]\([^)]*\)\)/gi, '')
  .replace(/,?\s*closes\s+\[#\d+\]\([^)]*\)/gi, '')
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/\s*\((?:[0-9a-f]{7,40}|#\d+)\)/gi, '')
  .replace(/[*_`]/g, '')
  .replace(/\s+/g, ' ').trim();
const capitalise = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** Groups of notes in the order they appear, headings renamed for the receipt ("Features" → "New"). Same-titled
 *  sections (the app's and the backend's) merge, repeated lines appear once, and anything else is skipped. */
export function parseReleaseNotes(markdown: string): ReleaseGroup[] {
  const groups: ReleaseGroup[] = [];
  let group: ReleaseGroup | undefined;
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^#{2,4}\s+(.+?)\s*$/.exec(line);
    if (heading) {
      const title = clean(heading[1]);
      // A version heading ("## [0.3.0](…) (2026-10-01)") isn't a section.
      if (/^\d+\.\d+/.test(title)) { group = undefined; continue; }
      const name = TITLES[title] ?? title;
      group = groups.find(existing => existing.title === name) ?? groups[groups.push({ title: name, items: [] }) - 1];
      continue;
    }
    const bullet = /^[*-]\s+(.+)$/.exec(line);
    if (!group || !bullet) continue;
    const scoped = /^\*\*([^*:]+):\*\*\s*(.+)$/.exec(bullet[1]);
    const text = capitalise(clean(scoped ? scoped[2] : bullet[1])), scope = scoped?.[1].trim();
    if (text && !group.items.some(item => item.text === text && item.scope === scope)) group.items.push(scope ? { text, scope } : { text });
  }
  return groups.filter(item => item.items.length);
}

/** "Full changelog on GitHub": every app release between the installed version and the one on offer, or the
 *  releases page when the installed version isn't a plain release (a dev or local build). */
export const changelogUrl = (installed: string | undefined, offered: string): string =>
  installed && /^\d+\.\d+\.\d+$/.test(installed) ? `https://github.com/discorev/printtally/compare/app-v${installed}...app-v${offered}`
    : 'https://github.com/discorev/printtally/releases';
