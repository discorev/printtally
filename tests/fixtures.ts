import type { Snapshot, Field } from 'print-accounting-contracts';
export const MEDIA = 'custom-media-type-canon-11111111-1111-1111-1111-111111111111';
export const T0 = '2026-09-01T12:00:00+00:00', T1 = '2026-09-02T12:00:00+00:00';
export function sample(): Snapshot {
  const raw = {
    job_record_number: 1, job_name: 'Synthetic print', job_owner: 'test',
    job_time_at_processing: '20260901100000', job_time_at_completed: '20260901100500',
    job_complete_state: 'success', job_type: 'print', job_media_type_name: MEDIA,
    job_data_size_width: 21000, job_data_size_height: 29700, job_used_area: 623,
    job_impressions_completed: 1, job_color_page_count: 1, job_monochrome_page_count: 0,
    job_duplex: 'OFF', job_used_ink_C: 125, job_used_ink_CO: null,
  };
  const schema: Field[] = Object.entries(raw).map(([name, value]) => {
    const field: Field = { name, type: typeof value === 'number' || value === null ? 'uint' : 'string' };
    if (name.startsWith('job_used_ink_')) Object.assign(field, { unit: 'ml', factor: '1000' });
    else if (['job_data_size_width', 'job_data_size_height'].includes(name)) Object.assign(field, { unit: 'mm', factor: '100' });
    else if (name === 'job_used_area') Object.assign(field, { unit: 'm2', factor: '10000' });
    return field;
  });
  return { printer: { host: '192.0.2.10', mac: '020000000001' }, collected_at: T0, requested_range: [1, 1], schema,
    records: [{ raw, media: { name: 'Configured stock' } }],
    media_catalogue: { printer_mac: '020000000001', collected_at: T0, entries: {
      [MEDIA]: { names: { EN: 'Configured stock', DE: 'Papier' }, short_name: null, checksum: '1234', observed_at: T0, present_on_printer: true, visible: true },
    } },
  };
}
