/** Cartridge series and sizes in millilitres for the two verified printer models. */
const models = {
  'PRO-1100 series': { standard: [{ series: 'PFI-4100', sizeMl: 80 }] },
  'PRO-2600 series': {
    standard: [{ series: 'PFI-3100', sizeMl: 160 }, { series: 'PFI-3300', sizeMl: 330 }, { series: 'PFI-3700', sizeMl: 700 }],
    MBK: [{ series: 'PFI-2100', sizeMl: 160 }, { series: 'PFI-2300', sizeMl: 330 }, { series: 'PFI-2700', sizeMl: 700 }],
  },
} as const;
export type CartridgeType = { series: string; sizeMl: number };
export function cartridgeTypes(model: string | null | undefined, channel: string): CartridgeType[] {
  if (model === 'PRO-1100 series') return channel ? [...models[model].standard] : [];
  if (model === 'PRO-2600 series') return channel ? [...(channel === 'MBK' ? models[model].MBK : models[model].standard)] : [];
  return [];
}
export function cartridgeSize(series: string): number | null {
  return [...models['PRO-1100 series'].standard, ...models['PRO-2600 series'].standard, ...models['PRO-2600 series'].MBK]
    .find(type => type.series === series)?.sizeMl ?? null;
}
