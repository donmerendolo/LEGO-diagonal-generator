// Solving a model: the whole job, LDraw text in and LDraw text out, with no idea
// where the text came from or where the part library lives.
//
// Both front ends come through here. The command line tool reads its holes off
// the LDraw library on disk; the web app carries a table of them. Neither has its
// own copy of what a joint means, because that is the part that is easy to get
// quietly wrong.
//
//   18651  axle pin with a 2L axle    this hole stays where it is
//   3749   axle pin                   holes of the same colour must meet
//
// The long one is long on purpose: the short pins change colour with every joint,
// and a mark that means something else entirely should not be one more colour among
// them. Its own colour means nothing — it is nailed down wherever you put it. One of
// them leaves the part free to swing about that hole, two fix it still, which is the
// same thing two real pins do and needs no second idea.

import { apply, cross, dot, mul, parseModel, rotAbout, unit, writeModel } from './ldraw.js';
import { assignMarkers, leverOf } from './marks.js';
import { solvePlanar } from './solve.js';

export const FIXED = '18651.dat';
export const JOINT = '3749.dat';

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

// ---------- which way is round ----------

// Every marker pin is pushed into the hole it marks, so it lies along that hole —
// and that hole is the axis its part turns about. The model says which way is round,
// which is why it does not have to be stood on end in Studio first.
//
// This is the one thing in the whole tool written down about a particular part
// instead of read off it: an axle pin's length runs along its own X, so the axis it
// lies on is the first column of its matrix. Both markers are that shape, and a part
// that is already in the library is not going to change shape now.
const AXIS_TOL = Math.cos(Math.PI / 180);   // a degree, far looser than Studio ever needs

// Studio writes six decimals, so a mark meant to stand straight up comes back a
// ten-millionth off it. Within a hair of one of the model's own axes it *is* that
// axis: taking the exact one keeps the numbers in the file clean and leaves an
// upright model coming out exactly as it did before any of this. A real tilt is
// thousands of times further away than this.
const SQUARE = 1e-4;
const square = (a) => {
  const i = a.findIndex((v) => Math.abs(Math.abs(v) - 1) < SQUARE);
  return i < 0 ? a : a.map((v, k) => (k === i ? Math.sign(v) : 0));
};

// Any pair of directions across the axis will do — the model is the same shape seen
// from any of them, so which pair is picked cannot change the answer. This one gives
// back plain X and Z when the axis is the vertical one, so an upright model comes out
// digit for digit as it always did.
const across = (axis) => {
  const away = axis.map(Math.abs);
  const helper = [0, 0, 0];
  helper[away.lastIndexOf(Math.min(...away))] = 1;
  const u = unit(cross(axis, helper));
  return { axis, u, v: cross(u, axis) };
};

export const UPRIGHT = across([0, 1, 0]);

export function frameOf(markers) {
  const dirs = markers.map((l) => unit([l.m[0], l.m[3], l.m[6]]));
  // A pin goes into a hole either way round, so what it gives is a line and not an
  // arrow. The ones facing the other way are turned about before they are averaged,
  // and averaged rather than taken from the first because Studio rounds its matrices
  // and there is no reason one marker should be the one that decides.
  const one = dirs[0];
  const same = dirs.map((d) => (dot(d, one) < 0 ? d.map((v) => -v) : d));
  const axis = square(unit(same.reduce((s, d) => s.map((v, i) => v + d[i]), [0, 0, 0])));

  // Marks lying across each other are two turning planes, and this solves one. Said
  // out loud, because the alternative is an answer that is confidently wrong.
  const astray = same.findIndex((d) => dot(d, axis) < AXIS_TOL);
  if (astray >= 0)
    throw new Error(`the marker at ${markers[astray].t.map((v) => +v.toFixed(2)).join(' ')} ` +
      'lies across the others: every mark has to run along the same axis');
  return across(axis);
}

// A point in the turning plane's own frame: x and z across it, y along the axis.
// With the axis upright those are the model's own X, Y and Z, unchanged.
const flat = (f, p) => [dot(p, f.u), dot(p, f.v)];
const inFrame = (f, p) => ({ x: dot(p, f.u), y: dot(p, f.axis), z: dot(p, f.v) });

// A part carried to where the answer says: an extra turn about the axis, through the
// point it turns about, and then a slide across the plane.
export function moved(line, turn, slide, c, frame = UPRIGHT) {
  const R = rotAbout(frame.axis, turn);
  const o = frame.u.map((_, i) => frame.u[i] * c[0] + frame.v[i] * c[1]);
  const p = apply(R, o, line.t.map((v, i) => v - o[i]));
  return {
    ...line,
    t: p.map((v, i) => v + slide[0] * frame.u[i] + slide[1] * frame.v[i]),
    // Onto the matrix, not instead of it: a part standing on edge or turned a
    // quarter keeps every bit of that, and only picks up the extra swing.
    m: mul(R, line.m),
  };
}

export function solveModel(text, library) {
  const { lines, blocks, top } = readModel(text);
  const isMark = (l) => l.part === FIXED || l.part === JOINT;
  const markers = top.filter(isMark);
  if (!markers.length) throw new Error('no marker pins in that model: nothing to solve');

  // Read before anything else, because everything else is measured in it.
  const frame = frameOf(markers);

  const bodies = [];
  for (const line of top) {
    if (!line.part || isMark(line)) continue;
    const holes = holesUnder(line.part, line.m, line.t, blocks, library, [])
      .map((h) => ({ ...inFrame(frame, [h.x, h.y, h.z]), axle: h.axle }));
    const c = flat(frame, line.t);
    bodies.push({
      line, holes, c, markers: [], pinned: [],
      index: bodies.length,
      submodel: blocks.has(line.part),
      what: blocks.has(line.part) ? line.part : library.describe(line.part),
      lever: leverOf(holes.length ? holes : [{ x: c[0], z: c[1] }], { x: c[0], z: c[1] }),
    });
  }
  if (!bodies.length) throw new Error('no parts in that model');

  const stray = [], fixed = [], joints = new Map();
  const owner = assignMarkers(markers.map((m) => ({
    ...inFrame(frame, m.t), group: m.part === FIXED ? null : m.colour,
  })), bodies);

  markers.forEach((marker, k) => {
    const body = bodies[owner[k]];
    if (!body) { stray.push({ marker, alone: false }); return; }
    body.markers.push(marker);
    if (marker.part === FIXED) { body.pinned.push(marker); fixed.push({ body, marker }); return; }
    if (!joints.has(marker.colour)) joints.set(marker.colour, []);
    joints.get(marker.colour).push({ body, marker });
  });

  // One pin of a colour has nobody to meet. It is a half-finished thought, not a
  // constraint, and silently dropping it would leave the model looking solved.
  for (const [colour, group] of joints)
    if (group.length < 2) { stray.push({ marker: group[0].marker, alone: true }); joints.delete(colour); }

  // Being fixed is not an equation, it is a freedom the part does not have. One pin
  // leaves it its angle, and about that pin rather than about its own origin; two
  // leave it nothing. Which is why a fixed part comes back out of here with its line
  // untouched to the last digit, whatever the rest of the model would have preferred.
  for (const b of bodies) {
    if (b.pinned.length >= 2) { b.fixed = true; continue; }
    if (b.pinned.length !== 1) continue;
    b.turnOnly = true;
    b.c = flat(frame, b.pinned[0].t);
    b.lever = leverOf(b.holes.length ? b.holes : [{ x: b.c[0], z: b.c[1] }], { x: b.c[0], z: b.c[1] });
  }

  // A joint of three markers is three points at one place, so each one after the
  // first has to meet the one before: two equations apiece, no more.
  const at = (e) => ({ body: e.body.index, c: e.body.c, p: flat(frame, e.marker.t) });
  const constraints = [];
  for (const group of joints.values())
    for (let i = 1; i < group.length; i++)
      constraints.push({ a: at(group[i - 1]), b: at(group[i]) });
  if (!constraints.length)
    throw new Error('nothing to join: two pins of one colour make a joint, and there are none');

  const { q, error, free } = solvePlanar(bodies, constraints, { loose: true });

  for (const b of bodies) {
    // A fixed part is not moved by nothing, it is not moved. Passing it through the
    // arithmetic with a turn of zero would come back a fraction of a nanometre off,
    // and untouched to the last digit is the whole promise of being fixed.
    if (b.fixed) continue;
    const [dx, dz, turn] = q[b.index];
    Object.assign(b.line, moved(b.line, turn, [dx, dz], b.c, frame));
    // The top level markers ride along, so the file can go straight back in and be
    // solved again without putting every pin back by hand. What is inside a
    // submodel is not touched at all: it travels with the line that refers to it,
    // and moving it here as well would move it twice.
    for (const marker of b.markers) Object.assign(marker, moved(marker, turn, [dx, dz], b.c, frame));
  }

  return { bodies, fixed, joints, stray, q, error, free, frame, worst: Math.max(0, ...error),
           text: writeModel(lines).replace(/\s+$/, '') + '\n' };
}

// The marks are scaffolding. They said which hole had to meet which, and once the
// holes have met there is nothing left for them to say — so the file you build
// from does not carry them. Top level only: inside a submodel a pin is a part of
// the build like any other, and the answer never touched it.
//
// Kept apart from solveModel because it is not part of solving: what comes out of
// there is still marked, which is what lets the answer be checked against the
// marks that asked for it.
export function withoutMarks(text) {
  const { lines, top } = readModel(text);
  const marks = new Set(top.filter((l) => l.part === FIXED || l.part === JOINT));
  return writeModel(lines.filter((l) => !marks.has(l))).replace(/\s+$/, '') + '\n';
}

// ---------- saying what happened ----------

const MM = 0.4;                         // one LDU, in millimetres
const STUD = 20;                        // LDU
const pad = (s, n) => String(s).padEnd(n);
const deg = (rad) => rad * 180 / Math.PI;

export function report(res, name, library) {
  const { bodies, fixed, joints, stray, q, error, free, frame } = res;
  const many = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;
  // Which way the marks said to turn. It used to be an assumption the model had to
  // be bent to fit, so now that it is read off the file it is worth reading back.
  const say = [`${name} — ${many(bodies.length, 'part')}, ${many(joints.size, 'joint')}, ` +
               `${fixed.length} fixed, turning about ` +
               frame.axis.map((v) => +v.toFixed(4)).join(' '), ''];

  for (const b of bodies) {
    const [dx, dz, turn] = q[b.index];
    const how = b.fixed ? 'fixed still'
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

  // Fixed parts are not in that list because they have no error to report: they did
  // not move at all, so there is nothing for them to be off by.
  const unknowns = bodies.reduce((n, b) => n + (b.fixed ? 0 : b.turnOnly ? 1 : 3), 0);
  const equations = 2 * error.length;
  say.push('');

  // Subtracting the one from the other was arithmetic, not an answer: it added up a
  // part nobody constrained and a joint that was said twice and came out with a number
  // belonging to neither. This is the real count, and it says whose it is — because
  // "one freedom left" is only useful if you know where to put the pin.
  const ways = free.flat().reduce((s, v) => s + v, 0);
  const round = Math.round(ways);
  say.push(`${unknowns} unknowns, ${equations} equations, ` +
    (round === 0 ? 'nothing left loose' : `${round} way${round === 1 ? '' : 's'} left to move`));
  for (const b of bodies) {
    const [dx, dz, turn] = free[b.index];
    if (dx + dz + turn < 0.02) continue;
    const how = [[dx + dz, 'slide'], [turn, 'turn']].filter(([v]) => v > 0.01).map(([, w]) => w);
    say.push(`  loose  #${pad(b.index + 1, 3)} ${pad(b.line.part.replace('.dat', ''), 8)} ` +
      `${pad(b.submodel ? `[${b.what}]` : b.what, 34)} can still ${how.join(' and ')}`);
  }

  // How near is near enough is not something this can know: a pin hole swallows a
  // little and a beam flexes a little more, and how much is a matter of what you
  // have got away with before. So it reports the number and leaves the verdict.
  say.push(`Off by ${(res.worst * MM).toFixed(3)} mm at worst.`);

  // Studio will not tell you where a part is, but the colour is right there on the
  // screen: it is the one thing about a mark you can pick out from across the model,
  // so it is what says which mark this is. On a fix pin the colour means nothing to
  // the answer — here it is only how you find the thing.
  //
  // And the two ways of being ignored are not the same mistake. A pin that is in no
  // hole has been dropped somewhere it does not belong; a pin that is the only one of
  // its colour is sitting exactly where it should with nothing to meet. Sending
  // somebody to look for the first when it is the second wastes an afternoon.
  for (const { marker, alone } of stray) {
    const colour = library.colourName(marker.colour);
    const what = marker.part === FIXED ? `${colour} fix mark` : `${colour} mark`;
    say.push(`WARNING  the ${what} at ${marker.t.map((v) => +v.toFixed(2)).join(' ')} ` +
      (alone ? 'is the only one of its colour, nothing to meet' : "is in no part's hole") +
      ', ignored');
  }
  return say.join('\n');
}
