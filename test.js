// deno run -A test.js
//
// The reference case is the one in diagonales.ldr, worked out by hand: a beam
// pinned to the ground at one end, a bent liftarm pinned at its corner, and the
// two joined at their far holes. Ground pins 200 LDU apart, arms of 240 and
// √(16² + 132²) LDU, so the triangle is fixed and the law of cosines gives the
// answer without going anywhere near this code.

import { apply, mul, parseModel, rotY } from './ldraw.js';
import { colourName, describe, findLibrary, holesOf } from './library.js';
import { run } from './diagonal.js';
import { moved, readModel, report, solveModel } from './model.js';
import { solvePlanar } from './solve.js';

const deg = (rad) => rad * 180 / Math.PI;
const ok = (name, got, want, tol) => {
  if (!(Math.abs(got - want) <= tol)) throw new Error(`${name}: ${got} != ${want}`);
  console.log(`ok  ${name} = ${got.toFixed(6)}`);
};
const same = (name, got, want) => {
  if (got !== want) throw new Error(`${name}: ${got} != ${want}`);
  console.log(`ok  ${name} = ${got}`);
};

// ---------- the triangle ----------

// Beam 13 with its origin at the middle, pinned at one end; bent liftarm pinned
// at its own origin. `flip` mirrors the whole thing in Z, which must give the
// mirrored answer and nothing else.
const triangle = (flip) => {
  const z = (v) => flip * v;
  const bodies = [{ c: [-90, z(90)] }, { c: [110, z(-30)] }];
  const at = (body, x, zz) => ({ body, c: bodies[body].c, p: [x, z(zz)] });
  return [bodies, [
    { a: at(0, -90, -30), b: { body: null, p: [-90, z(-30)] } },
    { a: at(1, 110, -30), b: { body: null, p: [110, z(-30)] } },
    { a: at(0, -90, 210), b: at(1, 126, 102) },
  ]];
};

for (const flip of [1, -1]) {
  const [bodies, constraints] = triangle(flip);
  const { q, error } = solvePlanar(bodies, constraints);
  ok(`closes (flip ${flip})`, Math.max(...error), 0, 1e-9);
  // Law of cosines on the triangle: the joint lands 199.8 LDU along the line
  // between the ground pins, so the beam's 240 LDU arm turns by asin(199.8/240).
  ok(`beam turns (flip ${flip})`, flip * Math.sin(q[0][2]), 199.8 / 240, 1e-9);
  ok(`liftarm turns (flip ${flip})`, flip * Math.sin(q[1][2]), -0.1218244, 1e-6);
  ok(`neither slides (flip ${flip})`, Math.hypot(q[1][0], q[1][1]), 0, 1e-9);
}

// The sketch is what picks one of the two ways to build the same triangle: same
// lengths, same pins, and the mirrored layout stays mirrored rather than
// snapping across to the other one.
{
  const up = solvePlanar(...triangle(1)).q[0][2];
  const down = solvePlanar(...triangle(-1)).q[0][2];
  ok('the two assemblies are mirrors', up + down, 0, 1e-9);
  same('and they are not the same one', Math.abs(up) > 0.1, true);
}

// Sliding beats turning. A beam on its own, joined by one end hole to a point 40
// LDU to the side, has a whole family of ways to get there and the shortest step
// decides. Measured in radians against LDU, turning looks 120 times cheaper and
// the beam swings; measured against the beam's own reach, it slides.
{
  const bodies = [{ c: [0, 0], lever: 120 }];
  const { q, error } = solvePlanar(bodies, [
    { a: { body: 0, c: [0, 0], p: [0, -120] }, b: { body: null, p: [40, -120] } }]);
  ok('the joint still closes', error[0], 0, 1e-9);
  ok('it got there by sliding', q[0][0], 40, 0.5);
  // The number to hold is the one you would notice, not the constant that
  // produces it: a twentieth of a degree is not a beam that came out crooked.
  ok('and turned less than a twentieth of a degree', deg(q[0][2]), 0, 0.05);
}

// Nobody marked it, so nobody moved it.
{
  const [bodies, constraints] = triangle(1);
  bodies.push({ c: [500, 500] });
  const { q } = solvePlanar(bodies, constraints);
  ok('an unmarked part stays put', Math.hypot(...q[2]), 0, 1e-12);
}

// ---------- the transformation ----------

// A part standing on edge must still be standing on edge afterwards. Turning
// about Y cannot change how a part leans, so the Y component of each of its own
// axes has to survive the move — which it only does if the answer is multiplied
// onto the matrix instead of replacing it.
{
  const onEdge = { t: [40, 8, -60], m: [1, 0, 0, 0, 0, -1, 0, 1, 0], part: 'x.dat', colour: 0 };
  const after = moved(onEdge, 0.7, [3, -4], [10, 10]);
  for (const [i, axis] of [[0, 'X'], [1, 'Y'], [2, 'Z']])
    ok(`lean of local ${axis} survives`, after.m[3 + i], onEdge.m[3 + i], 1e-12);
  ok('height untouched', after.t[1], onEdge.t[1], 1e-12);
  same('and it did turn', after.m[0] !== onEdge.m[0], true);
}

// ---------- the file and the library ----------

{
  const line = parseModel('1 19 126 0 102 0 -1 0 1 0 0 0 0 1 3749.dat')[0];
  same('a type 1 line reads back', `${line.colour} ${line.t} ${line.part}`, '19 126,0,102 3749.dat');
  same('anything else is left alone', parseModel('0 FILE x')[0].part, undefined);
}

const root = findLibrary();
if (!root) {
  console.log('..  no LDraw library found, skipping the hole check');
} else {
  // The hole diagonales.ldr puts its second pin in: local (16, 0, 132) on the
  // bent liftarm, which is what makes that marker belong to that part and no
  // other. Read off the part, never written down here.
  const near = ({ at }) => Math.hypot(at[0] - 16, at[1], at[2] - 132);
  ok('the bent liftarm has a hole at 16,0,132',
    Math.min(...holesOf(root, '32271.dat').map(near)), 0, 1e-6);
  // A hole can be drawn twice, once for each face, so count places and not
  // references — the same reason the marker only ever has to match in X and Z.
  const spread = holesOf(root, '41239.dat').map((h) => h.at[2]);
  ok('the beam 13 has 13 holes in a row', new Set(spread).size, 13, 0);
  ok('spanning 12 studs', Math.max(...spread) - Math.min(...spread), 240, 1e-6);
  same('a plain beam has no axle holes', holesOf(root, '41239.dat').some((h) => h.axle), false);

  // The 3 x 3 bent 90 takes an axle at both ends and at the corner, and a pin in
  // the middle of each arm. Drawing all five alike is what sends someone to the
  // parts bin for a pin that will not go in.
  const bent = new Set(holesOf(root, '32056.dat')
    .filter((h) => h.axle).map((h) => `${h.at[0]},${h.at[2]}`));
  same('the 3 x 3 bent 90 has axle holes at its ends and corner',
    [...bent].sort().join(' '), '0,0 0,40 40,0');
}

// The web app reads its holes from a generated table instead of the library on
// disk. Same model, same answer, or the two front ends have quietly drifted apart
// and only one of them is right.
if (root) {
  const { HOLES, NAMES, COLOURS } = await import('./holes.js');
  const key = (part) => part.replace(/\.dat$/, '');
  const table = {
    holes: (part) => (HOLES[key(part)] ?? [])
      .map(([x, y, z, axle]) => ({ at: [x, y, z], axle: !!axle })),
    describe: (part) => NAMES[key(part)] ?? key(part),
    colourName: (code) => COLOURS[code] ?? `colour ${code}`,
  };
  const disk = {
    holes: (part) => holesOf(root, part),
    describe: (part) => describe(root, part),
    colourName: (code) => colourName(root, code),
  };
  const text = Deno.readTextFileSync('diagonales.ldr');
  same('the table of holes answers the same as the library',
    report(solveModel(text, table), 'x', table), report(solveModel(text, disk), 'x', disk));
}

// The whole tool, on the model it was written for. Run here rather than read
// from a file lying about, so the check cannot pass on yesterday's answer.
if (root) {
  // Nothing here knows what is in the sample files, so they can be redrawn in
  // Studio without the test having to be rewritten after it.
  const solve = async (from) => {
    const out = Deno.makeTempFileSync({ suffix: '.ldr' });
    const res = await run(from, out, root);
    const text = Deno.readTextFileSync(out);
    Deno.removeSync(out);
    return { ...res, text };
  };

  for (const from of ['diagonales.ldr', 'diagonales.io']) {
    const solved = await solve(from);
    ok(`${from} closes`, solved.worst, 0, 1e-9);

    // Whatever the solver reported, the file has to agree: every pin of a
    // colour standing in one place, measured off the text that was written.
    const groups = new Map();
    for (const l of parseModel(solved.text).filter((l) => l.part === '3749.dat'))
      groups.set(l.colour, [...(groups.get(l.colour) ?? []), l]);
    const spread = Math.max(...[...groups.values()].flatMap((g) =>
      g.map((l) => Math.hypot(l.t[0] - g[0].t[0], l.t[2] - g[0].t[2]))));
    ok(`${from} put every joint's pins in one place`, spread, 0, 1e-6);

    // And solving the answer again is a no-op, which is the only way the file
    // can go back into Studio, get nudged, and come out here again.
    const twice = Deno.makeTempFileSync({ suffix: '.ldr' });
    Deno.writeTextFileSync(twice, solved.text);
    const again = await solve(twice);
    same(`${from} is already solved once it is solved`, again.text, solved.text);
    Deno.removeSync(twice);

    // A held hole does not move. Not nearly, not to within a hundredth of a
    // millimetre that the rest of the model talked it into: the same numbers that
    // went in. It is the one thing in the file the answer is not allowed to touch.
    if (solved.held.length) {
      const was = parseModel(Deno.readTextFileSync(from.endsWith('.io') ? 'diagonales.ldr' : from))
        .filter((l) => l.part === '43093.dat');
      const now = parseModel(solved.text).filter((l) => l.part === '43093.dat');
      ok(`${from} never moves a held hole`,
        Math.max(...now.map((l, i) => Math.hypot(l.t[0] - was[i].t[0], l.t[2] - was[i].t[2]))), 0, 0);
    }

    // A submodel is one rigid part made of others. What is inside it must come out
    // byte for byte as it went in: it travels with the line that refers to it, so
    // moving its contents as well would move them twice — and the only sign would
    // be a hole a stud from where it should be.
    // Compared as numbers and not as text, because the writer does not pad its
    // decimals the way Studio does and 31.67572 is 31.675720.
    const inside = (text) => {
      const { blocks, top } = readModel(text);
      return JSON.stringify([...blocks.values()].filter((b) => b !== top)
        .flat().filter((l) => l.part).map((l) => [l.part, l.t, l.m]));
    };
    if (solved.bodies.some((b) => b.submodel)) {
      const before = Deno.readTextFileSync(from.endsWith('.io') ? 'diagonales.ldr' : from);
      same(`${from} leaves the inside of a submodel alone`, inside(solved.text), inside(before));
      const moved = solved.bodies.filter((b) => b.submodel && b.markers.length);
      same(`${from} still moves the submodel itself`,
        moved.length > 0 && moved.every((b) => Math.hypot(...solved.q[b.index]) > 0), true);
    }

    // Which it would also be if every joint had quietly collapsed onto one part:
    // in a solved model both pins of a joint stand in the same place, and both
    // parts have a hole there, so the two have to be told apart on purpose.
    const paired = (res) => [...res.joints.values()]
      .every((g) => new Set(g.map((e) => e.body.index)).size === g.length);
    same(`${from} still joins two different parts when solved again`,
      paired(solved) && paired(again) && solved.joints.size > 0, true);
  }
}
