// deno run --allow-read --allow-write --allow-env diagonal.js modelo.ldr
//
// Reads a model laid out roughly by hand in Studio, reads the marker pins in it,
// works out where every part has to go for the marked holes to meet, and writes
// the model back out.
//
//   43093  axle pin with friction     this hole stays where it is
//   3749   axle pin without friction  holes of the same colour must meet
//
// The colour of a friction pin means nothing: it is nailed down wherever you put
// it. One of them leaves the part free to swing about that hole, two hold it
// still, which is the same thing a real pin does and needs no second idea.
//
// Both are axle pins, which is why they snap into pin holes and axle holes
// alike, so nearly every Technic connection can be marked with one or the other.

import { apply, MM, mul, parseModel, rotY, STUD, writeModel } from './ldraw.js';
import { colourName, describe, findLibrary, holesOf } from './library.js';
import { solvePlanar } from './solve.js';

const GROUND = '43093.dat';
const JOINT = '3749.dat';
const SNAP = 0.5;              // LDU a marker may sit from the hole it is in

const deg = (rad) => rad * 180 / Math.PI;
const pad = (s, n) => String(s).padEnd(n);

// ---------- reading the model ----------

// Which part is this marker snapped into? Answered off the part library rather
// than guessed: the marker sits on one of that part's holes, to the LDU. Only X
// and Z are compared, so a pin joining two parts on different levels — one long
// pin through both — is a joint like any other.
function bodyOf(marker, bodies) {
  let best = null;
  for (const b of bodies) {
    for (const h of b.holes) {
      if (Math.abs(h[0] - marker.t[0]) > SNAP || Math.abs(h[2] - marker.t[2]) > SNAP) continue;
      const away = Math.abs(h[1] - marker.t[1]);
      if (!best || away < best.away) best = { body: b, away };
    }
  }
  return best?.body ?? null;
}

function build(lines, root) {
  const bodies = [], markers = [];
  for (const line of lines) {
    if (!line.part) continue;
    if (line.part === GROUND || line.part === JOINT) { markers.push(line); continue; }
    bodies.push({
      line,
      index: bodies.length,
      what: describe(root, line.part),
      holes: holesOf(root, line.part).map((h) => apply(line.m, line.t, h)),
      c: [line.t[0], line.t[2]],
      markers: [],
    });
  }

  const stray = [];
  const held = [], joints = new Map();
  for (const marker of markers) {
    const body = bodyOf(marker, bodies);
    if (!body) { stray.push(marker); continue; }
    body.markers.push(marker);
    const at = { body: body.index, c: body.c, p: [marker.t[0], marker.t[2]] };
    if (marker.part === GROUND) { held.push({ body, at, marker }); continue; }
    if (!joints.has(marker.colour)) joints.set(marker.colour, []);
    joints.get(marker.colour).push({ body, at, marker });
  }

  // One pin of a colour has nobody to meet. It is a half-finished thought, not a
  // constraint, and silently dropping it would leave the model looking solved.
  for (const [colour, group] of joints)
    if (group.length < 2) { stray.push(group[0].marker); joints.delete(colour); }

  return { bodies, held, joints, stray };
}

// ---------- writing it back ----------

function moved(line, turn, slide, c) {
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

// ---------- the report ----------

function report(model, out, root) {
  const { bodies, held, joints, stray, q, error, path } = model;
  const say = [];

  const many = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;
  say.push(`${path} — ${many(bodies.length, 'part')}, ${many(joints.size, 'joint')}, ${held.length} held`);
  say.push('');
  for (const b of bodies) {
    const [dx, dz, turn] = q[b.index];
    const how = b.markers.length === 0
      ? 'nothing marked, left alone'
      // Where the part's own origin ended up. A part swinging about a pin far
      // from its origin moves a long way without sliding anywhere, so this is
      // not slack — it is the tell for a part that flipped to the other way of
      // assembling the same triangle.
      : `turns ${deg(turn).toFixed(2)}°, origin moves ${(Math.hypot(dx, dz) / STUD).toFixed(2)} studs`;
    say.push(`  #${pad(b.index + 1, 3)} ${pad(b.line.part.replace('.dat', ''), 8)} ${pad(b.what, 34)} ${how}`);
  }

  say.push('');
  let worst = 0, k = 0;
  for (const [colour, group] of joints) {
    const gap = Math.max(...group.slice(1).map(() => error[k++]));
    worst = Math.max(worst, gap);
    const parts = group.map((g) => '#' + (g.body.index + 1)).join(' ↔ ');
    say.push(`  joint ${pad(colourName(root, colour), 16)} ${pad(parts, 16)} ${(gap * MM).toFixed(3)} mm`);
  }
  for (const h of held) {
    const gap = error[k++];
    worst = Math.max(worst, gap);
    say.push(`  held  ${pad('#' + (h.body.index + 1), 16)} ${pad('', 16)} ${(gap * MM).toFixed(3)} mm`);
  }

  const unknowns = bodies.length * 3;
  const equations = 2 * error.length;
  say.push('');
  say.push(`${unknowns} unknowns, ${equations} equations, ` +
    (unknowns > equations ? `${unknowns - equations} free`
      : unknowns < equations ? `${equations - unknowns} more than needed`
        : 'exactly determined'));

  // A pin hole swallows a little, and a beam flexes a little more. Past that it
  // is not a tight fit, it is a model that does not exist.
  const mm = worst * MM;
  say.push(mm < 0.05 ? `Worst error ${mm.toFixed(3)} mm. It closes.`
    : mm < 0.3 ? `Worst error ${mm.toFixed(3)} mm. It will go together with a bit of flex.`
      : `Worst error ${mm.toFixed(3)} mm. That does not close — try another hole.`);

  for (const marker of stray)
    say.push(`WARNING  a marker at ${marker.t.join(' ')} is in no part's hole, ignored`);
  if (out) say.push(`\nwritten ${out}`);
  return say.join('\n');
}

// ---------- the tool ----------

function run(path, outPath, root) {
  const lines = parseModel(Deno.readTextFileSync(path));
  const model = build(lines, root);
  const { bodies, held, joints } = model;
  if (!bodies.length) throw new Error('no parts in that file');

  // A joint of three markers is three points at one place, so each one after the
  // first has to meet the one before: two equations apiece, no more.
  const constraints = [];
  for (const group of joints.values())
    for (let i = 1; i < group.length; i++)
      constraints.push({ a: group[i - 1].at, b: group[i].at });
  for (const h of held)
    constraints.push({ a: h.at, b: { body: null, p: h.at.p } });
  if (!constraints.length) throw new Error('no marker pins in that file: nothing to solve');

  const { q, error } = solvePlanar(bodies, constraints);

  for (const b of bodies) {
    const [dx, dz, turn] = q[b.index];
    Object.assign(b.line, moved(b.line, turn, [dx, dz], b.c));
    // The markers ride along, so the file can go straight back in and be solved
    // again without putting every pin back by hand.
    for (const marker of b.markers) Object.assign(marker, moved(marker, turn, [dx, dz], b.c));
  }
  Deno.writeTextFileSync(outPath, writeModel(lines).replace(/\s+$/, '') + '\n');
  console.log(report({ ...model, q, error, path }, outPath, root));
}

if (import.meta.main) {
  const args = Deno.args.filter((a) => !a.startsWith('--'));
  const flag = (name) => Deno.args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
  if (!args.length) {
    console.error('usage: deno run -A diagonal.js model.ldr [--out=solved.ldr] [--ldraw=DIR]');
    Deno.exit(2);
  }
  const root = findLibrary(flag('ldraw'));
  if (!root) {
    console.error('cannot find the LDraw library. Pass --ldraw=DIR or set LDRAWDIR.');
    Deno.exit(2);
  }
  run(args[0], flag('out') ?? args[0].replace(/\.[^.]+$/, '') + '-solved.ldr', root);
}

export { build, moved, run };
