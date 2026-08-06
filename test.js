// deno run -A test.js
//
// The reference case is the one in diagonales.ldr, worked out by hand: a beam
// pinned to the ground at one end, a bent liftarm pinned at its corner, and the
// two joined at their far holes. Ground pins 200 LDU apart, arms of 240 and
// √(16² + 132²) LDU, so the triangle is fixed and the law of cosines gives the
// answer without going anywhere near this code.

import { apply, mul, parseModel, rotY } from './ldraw.js';
import { findLibrary, holesOf } from './library.js';
import { moved, run } from './diagonal.js';
import { solvePlanar } from './solve.js';

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
  const near = (p) => Math.hypot(p[0] - 16, p[1], p[2] - 132);
  ok('the bent liftarm has a hole at 16,0,132',
    Math.min(...holesOf(root, '32271.dat').map(near)), 0, 1e-6);
  // A hole can be drawn twice, once for each face, so count places and not
  // references — the same reason the marker only ever has to match in X and Z.
  const spread = holesOf(root, '41239.dat').map((h) => h[2]);
  ok('the beam 13 has 13 holes in a row', new Set(spread).size, 13, 0);
  ok('spanning 12 studs', Math.max(...spread) - Math.min(...spread), 240, 1e-6);
}

// The whole tool, on the model it was written for. Run here rather than read
// from a file lying about, so the check cannot pass on yesterday's answer.
if (root) {
  const out = Deno.makeTempFileSync({ suffix: '.ldr' });
  run('diagonales.ldr', out, root);
  const pins = parseModel(Deno.readTextFileSync(out)).filter((l) => l.part === '3749.dat');
  Deno.removeSync(out);
  same('both marker pins ended up in one place',
    pins.length === 2 && Math.hypot(pins[0].t[0] - pins[1].t[0], pins[0].t[2] - pins[1].t[2]) < 1e-6,
    true);
}
