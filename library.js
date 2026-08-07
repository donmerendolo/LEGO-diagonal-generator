// The LDraw part library, asked one question only: where are a part's holes?
//
// Studio ships the library, so there is no list of Technic parts to keep here.
// A part's own .dat says where its holes are, the same way the chain generator
// took every diameter off the model instead of writing it down.
//
// A hole is a sub-file called beamhole, connhole, peghole or axlehol-something,
// and its own origin is the centre of the hole. Not everything with "hol" in the
// name is one: npeghole and npeghol4 are the rim *between* two holes, half a stud
// off, and a beam that offered a hole there would be lying.
//
// If a hole shape ever turns up under a name not on that list, nothing here goes
// quietly wrong: a marker pin that lands on it belongs to no part, and the tool
// says so and names the pin.

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

// Sub-file names carry their own folder ("s/32271s01.dat", "48/4-4cyli.dat"), so
// only the library roots have to be tried.
//
// UnOfficial among them: Studio keeps every part LDraw has not adopted yet
// there, which is most of the ones released in the last few years. Leaving it out
// does not fail loudly — the part simply has no holes, and every marker pin in it
// is reported as belonging to nothing.
const SEARCH = ['parts', 'p', 'UnOfficial/parts', 'UnOfficial/p'];

const files = new Map();
function readPart(root, name) {
  if (!files.has(name)) {
    let found = null;
    for (const dir of SEARCH) {
      try {
        found = { primitive: dir.endsWith('p'), text: Deno.readTextFileSync(`${root}/${dir}/${name}`) };
        break;
      } catch { /* next */ }
    }
    files.set(name, found);
  }
  return files.get(name);
}

// An axle hole takes an axle and will not let it turn; a pin hole is round and
// will. Both take an axle pin, so either can be marked, but a drawing that shows
// them alike is a drawing that has to be double checked against the real part.
const base = (name) => name.split('/').pop();
const isHole = (name) => /^(beamhole|connhole|peghole|axlehol)/i.test(base(name));
const isAxle = (name) => /^axlehol/i.test(base(name));

export const partText = (root, name) => readPart(root, name)?.text ?? null;

function walk(root, name, m, t, out, depth) {
  if (isHole(name)) { out.push({ at: t, axle: isAxle(name) }); return; }
  const file = readPart(root, name);
  // Primitives that are not holes are cylinders, discs and edges: nothing below
  // them is a connection point, and there are thousands of them.
  if (!file || file.primitive || depth > 6) return;
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

// The description is the first comment line, except in the unofficial files,
// which open with "0 FILE <name>" and put it on the line after. LDraw also pads
// its descriptions into columns, and nothing here wants that.
export function describe(root, part) {
  for (const line of readPart(root, part)?.text.split(/\r?\n/, 3) ?? []) {
    const said = line.replace(/^0\s*/, '').replace(/\s+/g, ' ').trim();
    if (said && !/^(FILE|Name:)\b/i.test(said)) return said;
  }
  return part;
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
