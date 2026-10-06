// The update button's ink splat, generated once from a fixed seed so it's the same splat everywhere: a lumpy body
// thrown up and to the right, and the droplets it flung, in a 28×26 box. Ported from the design mockup.

export type Droplet = { cx: number; cy: number; rx: number; ry: number; rotate: number; opacity: number };
type Point = [number, number];
type Bump = { th: number; a: number; w: number };

/** A seeded PRNG (mulberry32), returning [0, 1). */
const rng = (seed: number) => () => {
  seed = seed + 0x6D2B79F5 | 0;
  let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};
type Random = ReturnType<typeof rng>;
/** Roughly normal, mean 0 and sd 1. */
const gauss = (r: Random) => { let s = 0; for (let i = 0; i < 4; i++) s += r(); return (s - 2) / 0.577; };
const n2 = (v: number) => +v.toFixed(2);
const angDiff = (a: number, b: number) => {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
};

/** A closed Catmull-Rom curve through the points, as cubic Béziers. */
function smooth(pts: Point[]) {
  const n = pts.length, P = (i: number) => pts[(i + n) % n]!;
  let d = `M${n2(P(0)[0])} ${n2(P(0)[1])}`;
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [P(i - 1), P(i), P(i + 1), P(i + 2)];
    d += `C${n2(p1[0] + (p2[0] - p0[0]) / 6)} ${n2(p1[1] + (p2[1] - p0[1]) / 6)} ${n2(p2[0] - (p3[0] - p1[0]) / 6)} ${n2(p2[1] - (p3[1] - p1[1]) / 6)} ${n2(p2[0])} ${n2(p2[1])}`;
  }
  return d + 'Z';
}

/** A wobbly circle with gaussian bumps pushed out of its edge. */
function blob(cx: number, cy: number, R: number, r: Random, bumps: Bump[], wobble: number, n = 72) {
  const wob = Array.from({ length: 7 }, () => [r() * 2 * Math.PI, (r() - .5) * 2 * wobble] as const);
  const pts: Point[] = [];
  for (let i = 0; i < n; i++) {
    const th = 2 * Math.PI * i / n;
    let rad = R * (1 + wob.reduce((s, [ph, a], k) => s + a * Math.sin((k + 2) * th + ph) / (k * .6 + 1), 0));
    for (const b of bumps) rad += R * b.a * Math.exp(-((angDiff(th, b.th) / b.w) ** 2));
    pts.push([cx + rad * Math.cos(th), cy + rad * Math.sin(th)]);
  }
  return smooth(pts);
}

const droplet = (x: number, y: number, rx: number, ry: number, deg: number, a: number): Droplet =>
  ({ cx: n2(x), cy: n2(y), rx: n2(rx), ry: n2(ry), rotate: n2(deg), opacity: n2(a) });

/** The body and its droplets: spikes and most droplets thrown along `dir`, a couple flicked back the other way. */
export function splatParts({ R, cx, cy, seed = 31, dir = -.55, sats = 9, reach = 2.1 }:
  { R: number; cx: number; cy: number; seed?: number; dir?: number; sats?: number; reach?: number }) {
  const r = rng(seed);
  const bumps: Bump[] = [
    ...Array.from({ length: 6 }, (_, i) => ({ th: dir + (i - 2.5) * .33 + (r() - .5) * .2, a: .25 + r() * .5, w: .06 + r() * .06 })),
    ...Array.from({ length: 4 }, () => ({ th: r() * 2 * Math.PI, a: .08 + r() * .14, w: .3 + r() * .25 })),
  ];
  const body = blob(cx, cy, R, r, bumps, .05);
  const droplets: Droplet[] = [];
  for (let i = 0; i < sats; i++) {
    const th = dir + gauss(r) * .38, k = Math.pow(r(), 1.2), dist = R * (1.55 + k * reach), size = (.3 + (1 - k) * 1.1) * (.6 + r() * .5) * R / 7;
    droplets.push(droplet(cx + Math.cos(th) * dist, cy + Math.sin(th) * dist, size * (1.15 + k * 1.1), size, th * 180 / Math.PI, .75 + r() * .25));
  }
  for (let i = 0; i < 2; i++) {
    const th = dir + Math.PI + gauss(r) * .7, dist = R * (1.35 + r() * 1.2), size = (.25 + r() * .4) * R / 7;
    droplets.push(droplet(cx + Math.cos(th) * dist, cy + Math.sin(th) * dist, size * 1.3, size, th * 180 / Math.PI, .7 + r() * .3));
  }
  return { body, droplets };
}

export const SPLAT = splatParts({ R: 6.2, cx: 13, cy: 15 });
