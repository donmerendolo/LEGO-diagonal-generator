// Solving a model: the whole job, LDraw text in and LDraw text out, with no idea
// where the text came from or where the part library lives.
//
// Both front ends come through here. The command line tool reads its holes off
// the LDraw library on disk; the web app carries a table of them. Neither has its
// own copy of what a joint means, because that is the part that is easy to get
// quietly wrong.
//
//   43093  axle pin with friction     this hole stays where it is
//   3749   axle pin without friction  holes of the same colour must meet
//
// The colour of a friction pin means nothing: it is nailed down wherever you put
// it. One of them leaves the part free to swing about that hole, two hold it
// still, which is the same thing a real pin does and needs no second idea.

import { apply, mul, parseModel, rotY, writeModel } from './ldraw.js';
import { assignMarkers, leverOf } from './marks.js';
import { solvePlanar } from './solve.js';

export const GROUND = '43093.dat';
export const JOINT = '3749.dat';
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

// An MPD is one file holding several models, each opened by "0 FILE <name>". The
// first is the one on the table; the rest are submodels it refers to by name, and
// a reference to one is an ordinary type 1 line — which is exactly why a submodel
// can be treated as a part made of other parts and nothing else has to change.
export function readModel(text) {
  const lines = parseModel(text);
  const blocks = new Map();
  let name = '', main = null;
  for (const line of lines) {
    const said = line.raw.trim().match(/^0\s+FILE\s+(.+?)\s*$/i);
    if (said) { name = said[1].toLowerCase(); main ??= name; blocks.set(name, []); continue; }
    if (!blocks.has(name)) blocks.set(name, []);
    blocks.get(name).push(line);
  }
  return { lines, blocks, top: blocks.get(main ?? '') ?? [] };
}

// Where all of a part's holes are, in the frame it is placed in. A submodel is one
// rigid thing made of others, and the only thing that has to be known about it is
// this — so it walks in, and a submodel inside a submodel is simply more of the
// same body.
//
// Marker pins inside a submodel are part of the build, not marks: an axle pin has
// no holes, so they contribute nothing and need no rule of their own. You mark a
// submodel from the outside, the way you mark anything else.
function holesUnder(part, m, t, blocks, library, out, depth = 0) {
  const inner = blocks.get(part);
  if (!inner) {
    for (const h of library.holes(part)) {
      const [x, y, z] = apply(m, t, h.at);
      out.push({ x, y, z, axle: h.axle });
    }
    return out;
  }
  if (depth > 8) return out;                    // a submodel that contains itself
  for (const line of inner)
    if (line.part) holesUnder(line.part, mul(m, line.m), apply(m, t, line.t), blocks, library, out, depth + 1);
  return out;
}

// A part carried to where the answer says: an extra turn about Y, then a slide.
export function moved(line, turn, slide, c) {
  const s = Math.sin(turn), co = Math.cos(turn);
  const ux = line.t[0] - c[0], uz = line.t[2] - c[1];
  return {
    ...line,
    t: [c[0] + ux * co + uz * s + slide[0], line.t[1], c[1] - ux * s + uz * co + slide[1]],
    // Onto the matrix, not instead of it: a part standing on edge or turned a
    // quarter keeps every bit of that, and only picks up the extra swing.
    m: mul(rotY(turn), line.m),
  };
}

export function solveModel(text, library) {
  const { lines, blocks, top } = readModel(text);
  const bodies = [], markers = [];
  for (const line of top) {
    if (!line.part) continue;
    if (line.part === GROUND || line.part === JOINT) { markers.push(line); continue; }
    const holes = holesUnder(line.part, line.m, line.t, blocks, library, []);
    const c = [line.t[0], line.t[2]];
    bodies.push({
      line, holes, c, markers: [], held: [],
      index: bodies.length,
      submodel: blocks.has(line.part),
      what: blocks.has(line.part) ? line.part : library.describe(line.part),
      lever: leverOf(holes.length ? holes : [{ x: c[0], z: c[1] }], { x: c[0], z: c[1] }),
    });
  }
  if (!bodies.length) throw new Error('no parts in that model');

  const stray = [], held = [], joints = new Map();
  const owner = assignMarkers(markers.map((m) => ({
    x: m.t[0], y: m.t[1], z: m.t[2], group: m.part === GROUND ? null : m.colour,
  })), bodies);

  markers.forEach((marker, k) => {
    const body = bodies[owner[k]];
    if (!body) { stray.push(marker); return; }
    body.markers.push(marker);
    if (marker.part === GROUND) { body.held.push(marker); held.push({ body, marker }); return; }
    if (!joints.has(marker.colour)) joints.set(marker.colour, []);
    joints.get(marker.colour).push({ body, marker });
  });

  // One pin of a colour has nobody to meet. It is a half-finished thought, not a
  // constraint, and silently dropping it would leave the model looking solved.
  for (const [colour, group] of joints)
    if (group.length < 2) { stray.push(group[0].marker); joints.delete(colour); }

  // Being held is not an equation, it is a freedom the part does not have. One pin
  // leaves it its angle, and about that pin rather than about its own origin; two
  // leave it nothing. Which is why a held part comes back out of here with its line
  // untouched to the last digit, whatever the rest of the model would have preferred.
  for (const b of bodies) {
    if (b.held.length >= 2) { b.fixed = true; continue; }
    if (b.held.length !== 1) continue;
    b.turnOnly = true;
    b.c = [b.held[0].t[0], b.held[0].t[2]];
    b.lever = leverOf(b.holes.length ? b.holes : [{ x: b.c[0], z: b.c[1] }], { x: b.c[0], z: b.c[1] });
  }

  // A joint of three markers is three points at one place, so each one after the
  // first has to meet the one before: two equations apiece, no more.
  const at = (e) => ({ body: e.body.index, c: e.body.c, p: [e.marker.t[0], e.marker.t[2]] });
  const constraints = [];
  for (const group of joints.values())
    for (let i = 1; i < group.length; i++)
      constraints.push({ a: at(group[i - 1]), b: at(group[i]) });
  if (!constraints.length)
    throw new Error(markers.length
      ? 'nothing to join: two pins of one colour make a joint, and there are none'
      : 'no marker pins in that model: nothing to solve');

  const { q, error } = solvePlanar(bodies, constraints);

  for (const b of bodies) {
    const [dx, dz, turn] = q[b.index];
    Object.assign(b.line, moved(b.line, turn, [dx, dz], b.c));
    // The top level markers ride along, so the file can go straight back in and be
    // solved again without putting every pin back by hand. What is inside a
    // submodel is not touched at all: it travels with the line that refers to it,
    // and moving it here as well would move it twice.
    for (const marker of b.markers) Object.assign(marker, moved(marker, turn, [dx, dz], b.c));
  }

  return { bodies, held, joints, stray, q, error, worst: Math.max(0, ...error),
           text: writeModel(lines).replace(/\s+$/, '') + '\n' };
}

// ---------- saying what happened ----------

const MM = 0.4;                         // one LDU, in millimetres
const STUD = 20;                        // LDU
const pad = (s, n) => String(s).padEnd(n);
const deg = (rad) => rad * 180 / Math.PI;

export function report(res, name, library) {
  const { bodies, held, joints, stray, q, error } = res;
  const many = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;
  const say = [`${name} — ${many(bodies.length, 'part')}, ${many(joints.size, 'joint')}, ` +
               `${held.length} held`, ''];

  for (const b of bodies) {
    const [dx, dz, turn] = q[b.index];
    const how = b.fixed ? 'held still'
      : b.turnOnly ? `turns ${deg(turn).toFixed(2)}° about its pin`
        : b.markers.length === 0 ? (b.holes.length ? 'nothing marked, left alone' : 'no holes, left alone')
          // Where the part's own origin ended up. A part swinging about a pin far
          // from its origin moves a long way without sliding anywhere, so this is
          // not slack — it is the tell for a part that flipped to the other way of
          // assembling the same triangle.
          : `turns ${deg(turn).toFixed(2)}°, origin moves ${(Math.hypot(dx, dz) / STUD).toFixed(2)} studs`;
    const what = b.submodel ? `[${b.what}]` : b.what;
    say.push(`  #${pad(b.index + 1, 3)} ${pad(b.line.part.replace('.dat', ''), 8)} ${pad(what, 34)} ${how}`);
  }

  say.push('');
  let k = 0;
  for (const [colour, group] of joints) {
    const worst = Math.max(...group.slice(1).map(() => error[k++]));
    const parts = group.map((g) => '#' + (g.body.index + 1)).join(' ↔ ');
    say.push(`  joint ${pad(library.colourName(colour), 16)} ${pad(parts, 16)} ${(worst * MM).toFixed(3)} mm`);
  }

  // Held parts are not in that list because they have no error to report: they did
  // not move at all, so there is nothing for them to be off by.
  const unknowns = bodies.reduce((n, b) => n + (b.fixed ? 0 : b.turnOnly ? 1 : 3), 0);
  const equations = 2 * error.length;
  say.push('');
  say.push(`${unknowns} unknowns, ${equations} equations, ` +
    (unknowns > equations ? `${unknowns - equations} free`
      : unknowns < equations ? `${equations - unknowns} more than needed`
        : 'exactly determined'));

  // How near is near enough is not something this can know: a pin hole swallows a
  // little and a beam flexes a little more, and how much is a matter of what you
  // have got away with before. So it reports the number and leaves the verdict.
  say.push(`Off by ${(res.worst * MM).toFixed(3)} mm at worst.`);

  for (const marker of stray)
    say.push(`WARNING  a marker at ${marker.t.map((v) => +v.toFixed(2)).join(' ')} ` +
             `is in no part's hole, ignored`);
  return say.join('\n');
}
