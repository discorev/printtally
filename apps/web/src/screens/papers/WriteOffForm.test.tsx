import { expect, test } from 'bun:test';
import type { WriteOffPreview } from 'print-accounting-contracts';
import { waitFor } from '@testing-library/react';
import { fakeApi, reply } from '../../../test/api.ts';
import { papers, settings, writeOffPreview } from '../../../test/fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { today } from '../../lib/format.ts';

test('writing off the open pack waits for the ledger and only confirms after a successful save', async () => {
  const date = today();
  let releasePreview!: (preview: WriteOffPreview) => void;
  const preview = new Promise<WriteOffPreview>(resolve => { releasePreview = resolve; });
  let attempts = 0;
  const api = fakeApi({
    'GET /papers': papers(),
    'GET /settings': settings(),
    'GET /media-types': { media_types: [] },
    [`GET /write-offs/preview?paper_stock_id=10&written_off_on=${date}`]: () => preview,
    'POST /write-offs': () => ++attempts === 1 ? reply(422, { error: 'invalid_request' }) : { id: 42 },
  });
  const { screen, user, router } = await renderApp('/papers/1?form=writeoff', api);
  const save = await screen.findByRole('button', { name: 'Save write-off' }) as HTMLButtonElement;

  await user.clear(screen.getByRole('spinbutton', { name: 'Sheets' }));
  expect(save.disabled).toBe(true);
  await user.click(screen.getByRole('radio', { name: /The rest of the open pack/ }));
  expect(save.disabled).toBe(true);

  releasePreview(writeOffPreview({ written_off: 12, remaining: 75 }));
  expect(await screen.findByRole('radio', { name: 'The rest of the open pack (12)' })).toBeTruthy();
  await waitFor(() => expect(save.disabled).toBe(false));
  await user.type(screen.getByRole('textbox', { name: /Reason/ }), '  Damaged  ');
  await user.click(save);
  expect(await screen.findByText('Not saved. Check the form and try again.')).toBeTruthy();
  expect(screen.queryByText(/Saved\. It shows as waste/)).toBeNull();
  expect(router.state.location.search.form).toBe('writeoff');

  await user.click(save);
  expect(await screen.findByText(/Saved\. It shows as waste in totals/)).toBeTruthy();
  const posts = api.requests.filter(request => request.method === 'POST');
  expect(posts).toHaveLength(2);
  for (const request of posts) {
    expect(await request.clone().json()).toEqual({
      paper_stock_id: 10, written_off_on: date, reason: 'Damaged', all_remaining: true,
    });
  }
});
