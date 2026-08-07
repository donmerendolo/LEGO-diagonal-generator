// deno run -A tools/pictures.js  — writes img/*.png
//
// The palette picture of every part in the catalogue: the real LDraw model,
// seen from a corner so it has some thickness to it, lit from over your
// shoulder, nearest triangle wins. Coming out of the model there is nobody's
// photo involved, and an axle hole looks like an axle hole because it is one.
//
// The camera, the shading and the PNG writing are the same as in the chain
// generator's tools/outlines.js. Run it again only after adding a part.
// LDraw parts are CC BY 4.0 — https://www.ldraw.org

import { CATALOGUE } from '../parts.js';
import { findLibrary, partText } from '../library.js';

const SHOT = 160;                       // pixels across the finished picture
const OVER = 3;                         // drawn this much bigger, then averaged down
const TURN = Math.PI / 4;               // swing the camera round…
const TIP = -Math.atan(Math.SQRT1_2);   // …and tip it down: plain isometric

// A beam lies flat in the plane it turns in, so we start from straight above:
// across the screen is the part's X, down the screen its Z.
const FLAT = { x: [1, 0, 0], y: [0, 0, 1] };
const GREY = '#A0A5A9', DARK = '#6C6E68';
// The thin liftarms are the dark ones. Everything else is light bluish grey.
const DARK_PARTS = new Set(['32056.dat']);

const root = findLibrary();
if (!root) throw new Error('cannot find the LDraw library. Set LDRAWDIR.');

const apply = (m, p) => ({
  x: m[0] * p.x + m[1] * p.y + m[2] * p.z + m[9],
  y: m[3] * p.x + m[4] * p.y + m[5] * p.z + m[10],
  z: m[6] * p.x + m[7] * p.y + m[8] * p.z + m[11],
});

// child placed inside parent: compose the two matrices.
const compose = (m, c) => {
  const at = (r, k) => m[r * 3] * c[k] + m[r * 3 + 1] * c[3 + k] + m[r * 3 + 2] * c[6 + k];
  const t = apply(m, { x: c[9], y: c[10], z: c[11] });
  return [at(0, 0), at(0, 1), at(0, 2), at(1, 0), at(1, 1), at(1, 2),
          at(2, 0), at(2, 1), at(2, 2), t.x, t.y, t.z];
};

// Every triangle of the part, in part coordinates. Quads become two triangles.
function facesOf(name, m, out = []) {
  const text = partText(root, name);
  if (!text) return out;
  for (const line of text.split('\n')) {
    const f = line.trim().split(/\s+/);
    if (f[0] === '1') {
      const c = f.slice(2, 14).map(Number);
      // LDraw writes the translation first and the matrix after it.
      facesOf(f.slice(14).join(' ').replace(/\\/g, '/'),
        compose(m, [...c.slice(3), ...c.slice(0, 3)]), out);
    } else if (f[0] === '3' || f[0] === '4') {
      const n = f[0] === '3' ? 3 : 4;
      const v = [];
      for (let i = 0; i < n; i++)
        v.push(apply(m, { x: +f[2 + i * 3], y: +f[3 + i * 3], z: +f[4 + i * 3] }));
      out.push([v[0], v[1], v[2]]);
      if (n === 4) out.push([v[0], v[2], v[3]]);
    }
  }
  return out;
}

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
                         a[0] * b[1] - a[1] * b[0]];
const unit = (v) => { const n = Math.hypot(...v) || 1; return v.map((c) => c / n); };

// Swing the camera round the part's up-axis, then tip it down towards the top.
function fromACorner(view) {
  const blend = (a, b, ca, cb) => unit(a.map((v, i) => v * ca + b[i] * cb));
  const out = unit(cross(view.x, view.y));
  const x = blend(view.x, out, Math.cos(TURN), Math.sin(TURN));
  const swung = blend(out, view.x, Math.cos(TURN), -Math.sin(TURN));
  const y = blend(view.y, swung, Math.cos(TIP), Math.sin(TIP));
  return { x, y, out: unit(cross(x, y)) };
}

function shade(solid, straightOn, colour) {
  const size = SHOT * OVER;
  const view = fromACorner(straightOn);
  const dot = (axis, p) => axis[0] * p.x + axis[1] * p.y + axis[2] * p.z;
  const lamp = unit([0, 1, 2].map((i) =>
    view.out[i] * 0.8 - view.x[i] * 0.4 + view.y[i] * 0.45));
  const rgb = [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16));

  const tris = solid.map((t) => ({
    at: t.map((v) => ({ x: dot(view.x, v), y: dot(view.y, v) })),
    z: t.map((v) => dot(view.out, v)),
    n: unit(cross([t[1].x - t[0].x, t[1].y - t[0].y, t[1].z - t[0].z],
                  [t[2].x - t[0].x, t[2].y - t[0].y, t[2].z - t[0].z])),
  }));

  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const t of tris) for (const v of t.at) {
    box[0] = Math.min(box[0], v.x); box[1] = Math.min(box[1], v.y);
    box[2] = Math.max(box[2], v.x); box[3] = Math.max(box[3], v.y);
  }
  const span = Math.max(box[2] - box[0], box[3] - box[1]) * 1.06;
  const scale = size / span;
  const midX = (box[0] + box[2]) / 2, midY = (box[1] + box[3]) / 2;
  const at = (p) => [size / 2 + (p.x - midX) * scale, size / 2 - (p.y - midY) * scale];

  const pixels = new Uint8Array(size * size * 4);
  const depth = new Float64Array(size * size).fill(-Infinity);

  for (const tri of tris) {
    const lit = Math.abs(tri.n[0] * lamp[0] + tri.n[1] * lamp[1] + tri.n[2] * lamp[2]);
    const tone = 0.42 + 0.58 * lit;
    const p = tri.at.map(at);
    const area = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1])
               - (p[2][0] - p[0][0]) * (p[1][1] - p[0][1]);
    if (Math.abs(area) < 1e-9) continue;
    const lo = [Math.max(0, Math.floor(Math.min(p[0][0], p[1][0], p[2][0]))),
                Math.max(0, Math.floor(Math.min(p[0][1], p[1][1], p[2][1])))];
    const hi = [Math.min(size - 1, Math.ceil(Math.max(p[0][0], p[1][0], p[2][0]))),
                Math.min(size - 1, Math.ceil(Math.max(p[0][1], p[1][1], p[2][1])))];
    for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((p[1][0] - px) * (p[2][1] - py) - (p[2][0] - px) * (p[1][1] - py)) / area;
      const w1 = ((p[2][0] - px) * (p[0][1] - py) - (p[0][0] - px) * (p[2][1] - py)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = w0 * tri.z[0] + w1 * tri.z[1] + w2 * tri.z[2];
      const k = y * size + x;
      if (z <= depth[k]) continue;
      depth[k] = z;
      pixels[k * 4] = rgb[0] * tone; pixels[k * 4 + 1] = rgb[1] * tone;
      pixels[k * 4 + 2] = rgb[2] * tone; pixels[k * 4 + 3] = 255;
    }
  }

  // Average the oversampled buffer down, which is where the smooth edges come from.
  const out = new Uint8Array(SHOT * SHOT * 4);
  for (let y = 0; y < SHOT; y++) for (let x = 0; x < SHOT; x++) {
    const sum = [0, 0, 0, 0];
    for (let j = 0; j < OVER; j++) for (let i = 0; i < OVER; i++) {
      const k = ((y * OVER + j) * size + x * OVER + i) * 4;
      for (let c = 0; c < 4; c++) sum[c] += pixels[k + c];
    }
    const k = (y * SHOT + x) * 4;
    // Undo the premultiplication that averaging transparent pixels causes.
    const cover = sum[3] / (OVER * OVER * 255);
    for (let c = 0; c < 3; c++) out[k + c] = cover ? sum[c] / (OVER * OVER) / cover : 0;
    out[k + 3] = sum[3] / (OVER * OVER);
  }
  return out;
}

// A PNG, by hand: header, one deflated block of rows, end.
const CRC = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes) => {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

async function png(size, rgba) {
  const rows = new Uint8Array((size * 4 + 1) * size);
  for (let y = 0; y < size; y++)
    rows.set(rgba.subarray(y * size * 4, (y + 1) * size * 4), y * (size * 4 + 1) + 1);
  const body = new Uint8Array(await new Response(new Blob([rows]).stream()
    .pipeThrough(new CompressionStream('deflate'))).arrayBuffer());

  const chunk = (type, data) => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set([...type].map((c) => c.charCodeAt(0)), 4);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const head = new Uint8Array(13);
  new DataView(head.buffer).setUint32(0, size);
  new DataView(head.buffer).setUint32(4, size);
  head.set([8, 6, 0, 0, 0], 8);                    // 8 bits, RGBA, no interlace
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
                 chunk('IHDR', head), chunk('IDAT', body), chunk('IEND', new Uint8Array())];
  const file = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { file.set(p, at); at += p.length; }
  return file;
}

await Deno.mkdir(new URL('../img/', import.meta.url), { recursive: true });

for (const spec of CATALOGUE) {
  const solid = facesOf(spec.part, [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
  if (!solid.length) throw new Error(`${spec.part} has no geometry`);
  const shot = await png(SHOT, shade(solid, FLAT, DARK_PARTS.has(spec.part) ? DARK : GREY));
  await Deno.writeFile(new URL('../img/' + spec.part.replace('.dat', '.png'), import.meta.url), shot);
  console.log(`${spec.part}  ${solid.length} triangles  ${(shot.length / 1024).toFixed(1)} kB`);
}
