import { expect, test } from 'bun:test';
import { changelogUrl, parseReleaseNotes } from './release-notes.ts';

test('release-please sections become the receipt groups, renamed, with the scope beside each line', () => {
  const notes = [
    '## [0.3.0](https://github.com/discorev/printtally/compare/app-v0.2.2...app-v0.3.0) (2026-10-03)',
    '',
    '### Features',
    '',
    '* **desktop:** updates install themselves ([1a2b3c4](https://github.com/discorev/printtally/commit/1a2b3c4d))',
    '* **web:** default a new paper\'s name to its printer media ([688bfa2](https://github.com/discorev/printtally/commit/688bfa28))',
    '',
    '### Bug Fixes',
    '',
    '* ink totals no longer double-count a cancelled job',
    '',
    '### Performance Improvements',
    '',
    '* **core:** cost the ledger in one pass',
    '',
    '### Documentation',
    '',
    '* **docs:** explain pairing',
  ].join('\n');
  expect(parseReleaseNotes(notes)).toEqual([
    { title: 'New', items: [
      { text: 'Updates install themselves', scope: 'desktop' },
      { text: 'Default a new paper\'s name to its printer media', scope: 'web' },
    ] },
    { title: 'Fixed', items: [{ text: 'Ink totals no longer double-count a cancelled job' }] },
    { title: 'Faster', items: [{ text: 'Cost the ledger in one pass', scope: 'core' }] },
    { title: 'Documentation', items: [{ text: 'Explain pairing', scope: 'docs' }] },
  ]);
});

test('links, issue refs and leftover markdown are stripped from a line', () => {
  const notes = '### Bug Fixes\n- **web:** keep [the docket](https://example.com) open, closes [#12](https://github.com/x/y/issues/12) (#14)\n* use `printtally pair` (abc1234)';
  expect(parseReleaseNotes(notes)).toEqual([{ title: 'Fixed', items: [
    { text: 'Keep the docket open', scope: 'web' },
    { text: 'Use printtally pair' },
  ] }]);
});

test('same-titled sections merge and repeated lines appear once', () => {
  const notes = '### Features\n* **web:** a thing ([aaaaaaa](u))\n* **web:** a thing ([bbbbbbb](u))\n### Features\n* another';
  expect(parseReleaseNotes(notes)).toEqual([{ title: 'New', items: [{ text: 'A thing', scope: 'web' }, { text: 'Another' }] }]);
});

test('anything unparseable is skipped, so plain or empty notes give no groups', () => {
  expect(parseReleaseNotes('')).toEqual([]);
  expect(parseReleaseNotes('Bug fixes and improvements.\n* a bullet with no section')).toEqual([]);
  expect(parseReleaseNotes('### Features\n\nSome prose.\n  * an indented sub-item\n### Empty')).toEqual([]);
});

test('the changelog link compares the installed release with the offered one, or lists every release', () => {
  expect(changelogUrl('0.2.2', '0.3.0')).toBe('https://github.com/discorev/printtally/compare/app-v0.2.2...app-v0.3.0');
  expect(changelogUrl('0.2.2-local', '0.3.0')).toBe('https://github.com/discorev/printtally/releases');
  expect(changelogUrl(undefined, '0.3.0')).toBe('https://github.com/discorev/printtally/releases');
});
