import type { InkReading } from 'print-accounting-contracts';
import { checked, elements, value, type Transport, type Xml } from './protocol.ts';

const clean = (text: string | null): string | null => text?.trim() || null;
const unsigned = (text: string | null, max: number): number | null => {
  if (!text || !/^\d+$/.test(text.trim())) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) && number <= max ? number : null;
};
/** A model includes its ink channel, and may identify the starter cartridge with SETUP. */
export function parseInkModel(model: string | null): { series: string | null; channel: string | null } {
  const match = clean(model)?.replace(/SETUP$/, '').match(/^(.+)<([A-Za-z0-9_]+)>$/);
  return { series: clean(match?.[1] ?? null), channel: match?.[2] ?? null };
}
export function parseInkStatus(print: Xml, device: Xml | null): InkReading[] {
  const counts = new Map((device ? elements(device, 'vcn:ink_replacement_count') : []).map(node => [node.getAttribute('color'), unsigned(node.textContent, Number.MAX_SAFE_INTEGER)]));
  const readings = elements(print, 'ivec:marker_info').flatMap(marker => elements(marker, 'ivec:ink')).flatMap(ink => {
    const color = clean(value(ink, 'ivec:color'));
    const channel = /^[A-Za-z0-9_]{1,16}$/.test(color ?? '') ? color : parseInkModel(value(ink, 'ivec:model')).channel;
    if (!channel || channel.length > 16) return [];
    const model = parseInkModel(value(ink, 'ivec:model'));
    return [{ channel, series: model.channel === channel ? model.series : null,
      level: unsigned(value(ink, 'ivec:level'), 100), replacement_count: counts.get(channel) ?? null }];
  });
  return [...new Map(readings.map(reading => [reading.channel, reading])).values()];
}
export function parseDeviceCapability(root: Xml): { device_model: string | null; firmware: string | null } {
  return { device_model: clean(value(root, 'ivec:model')), firmware: clean(value(root, 'ivec:firmver')) };
}
/** Each read is optional: loss of a status service does not hide other available readings. */
export async function readInkStatus(client: Transport): Promise<{
  inks: InkReading[]; device_model: string | null; firmware: string | null; failures: string[];
}> {
  const failures: string[] = [];
  const read = async (operation: 'GetStatus' | 'GetCapability', service: 'print' | 'device') => {
    try { return checked(await client.request(operation, [], service), operation, undefined, service)[0]; }
    catch { failures.push(`Printer ${service} ${operation} unavailable.`); return null; }
  };
  const print = await read('GetStatus', 'print');
  const device = await read('GetStatus', 'device');
  const capability = await read('GetCapability', 'device');
  return { inks: print ? parseInkStatus(print, device) : [],
    ...capability ? parseDeviceCapability(capability) : { device_model: null, firmware: null }, failures };
}
