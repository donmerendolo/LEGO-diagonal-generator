// The LDraw part library, asked one question only: where are a part's holes?
//
// Studio ships the library, so there is no list of Technic parts to keep here.
// A part's own .dat says where its holes are, the same way the chain generator
// took every diameter off the model instead of writing it down.
//
// A hole is any sub-file whose name contains "hol" — beamhole, connhole,
// peghole, npeghole, axlehol4, npeghol4. Being generous is the safe side: a
// candidate nobody ever puts a pin in costs nothing, because the holes are only
// ever used to answer "which part is this marker snapped into", and a spurious
// one is never where a marker sits. A hole *missed* loses a joint.

import { apply, mul, parseModel } from './ldraw.js';

const DEFAULT_ROOTS = [
  'C:/Program Files/Studio 2.0/ldraw',
  'C:/Program Files (x86)/Studio 2.0/ldraw',
  'C:/Users/Public/Documents/LDraw',
  '/usr/share/ldraw',
  `${Deno.env.get('HOME') ?? ''}/ldraw`,
];

export function findLibrary(given) {
  for (const root of [given, Deno.env.get('LDRAWDIR'), ...DEFAULT_ROOTS]) {
    try {
      if (root && Deno.statSync(`${root}/parts`).isDirectory) return root;
    } catch { /* next */ }
  }
  return null;
}

// Sub-file names carry their own folder ("s/32271s01.dat", "48/4-4cyli.dat"),
// so `parts` and `p` are the only two places to look.
const files = new Map();
function readPart(root, name) {
  if (!files.has(name)) {
    let found = null;
    for (const dir of ['parts', 'p']) {
      try {
        found = { dir, text: Deno.readTextFileSync(`${root}/${dir}/${name}`) };
        break;
      } catch { /* next */ }
    }
    files.set(name, found);
  }
  return files.get(name);
}

function walk(root, name, m, t, out, depth) {
  if (/hol/i.test(name)) { out.push(t); return; }   // the reference's own origin
  const file = readPart(root, name);
  // Primitives that are not holes are cylinders, discs and edges: nothing below
  // them is a connection point, and there are thousands of them.
  if (!file || file.dir === 'p' || depth > 6) return;
  for (const l of parseModel(file.text)) {
    if (!l.part) continue;
    walk(root, l.part, mul(m, l.m), apply(m, t, l.t), out, depth + 1);
  }
}

const holes = new Map();
export function holesOf(root, part) {
  if (!holes.has(part)) {
    const out = [];
    walk(root, part, [1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, 0], out, 0);
    holes.set(part, out);
  }
  return holes.get(part);
}

export function describe(root, part) {
  const file = readPart(root, part);
  // LDraw pads its descriptions into columns; nothing here wants that.
  return file?.text.split(/\r?\n/, 1)[0].replace(/^0\s*/, '').replace(/\s+/g, ' ').trim() || part;
}

// Colour names, so the report can say "the Tan joint" and you can find it in
// Studio by looking rather than by counting.
let names = null;
export function colourName(root, code) {
  if (!names) {
    names = new Map();
    try {
      for (const line of Deno.readTextFileSync(`${root}/LDConfig.ldr`).split(/\r?\n/)) {
        const m = line.match(/^0\s+!COLOUR\s+(\S+).*?\sCODE\s+(\d+)/);
        if (m) names.set(+m[2], m[1].replace(/_/g, ' '));
      }
    } catch { /* names are a nicety */ }
  }
  return names.get(code) ?? `colour ${code}`;
}
