// The interface. Everything is in LDU and seen from above, which is the plane
// the parts turn in: X to the right, Z down the screen, exactly as Studio shows
// it. The solver is the one the command line tool uses, imported and not
// reimplemented — a second copy of the mathematics would be a second copy to be
// wrong.

import { CATALOGUE } from './parts.js';
import { formatLine, MM, mul, rotY, STUD } from './ldraw.js';
import { readStudio } from './io.js';
import { leverOf } from './marks.js';
import { solvePlanar } from './solve.js';
import { applyLanguage, lang, setLang, t } from './i18n.js';

const $ = (id) => document.getElementById(id);
const board = $('board'), scene = $('scene');

// LDraw colour codes with the colour they are, because the .ldr says one and the
// screen has to show the other. A joint takes the next one along; they only tell
// joints apart, and nobody has to choose one.
const JOINTS = [
  [4, '#c91a09'], [14, '#f2cd37'], [2, '#237841'], [1, '#0055bf'], [25, '#fe8a18'],
  [27, '#bbe90b'], [26, '#901f76'], [322, '#36aebf'], [19, '#e4cd9e'], [5, '#c870a0'],
  [212, '#9fc3e9'], [288, '#184632'], [191, '#f8bb3d'], [70, '#582a12'], [28, '#958a73'],
  [226, '#fff03a'],
];

const state = {
  parts: [],        // { spec, x, z, turn, level, flip }
  joints: [],       // { a: {part, hole}, b: {part, hole} }
  holds: [],        // { part, hole, anchor: [x, z] }
  tool: 'join',
  armed: null,      // the first hole of a join not finished yet
  snap: 'stud',
  // Kept between visits, because it is a judgement you make once and then rely on.
  tolerance: +(localStorage.getItem('tolerance') ?? 0.1),
  selected: null,
  result: null,
};
const view = { x: -400, y: -300, w: 800, h: 600 };

const ink = (i) => JOINTS[i % JOINTS.length][1];
const jointAt = (part, hole) => state.joints.findIndex((j) =>
  [j.a, j.b].some((e) => e.part === part && e.hole === hole));
const holdAt = (part, hole) => state.holds.findIndex((h) => h.part === part && h.hole === hole);
const holdsOn = (part) => state.holds.filter((h) => h.part === part);

// ---------- geometry ----------

// Turning about Y, seen from above: the same rotation the solver works in.
//
// A bent beam is not the same shape as its mirror image, and no amount of turning
// makes it one — you have to pick the piece up and put it back the other way round.
// That is a half turn about the part's own long axis, which is a real thing to do to
// a real part, and from above it reads as the shape mirrored: z for -z.
const holeAt = (p, i) => {
  const [hx, hz0] = p.spec.holes[i].at;
  const hz = p.flip ? -hz0 : hz0;
  const c = Math.cos(p.turn), s = Math.sin(p.turn);
  return [p.x + hx * c + hz * s, p.z - hx * s + hz * c];
};

// Y flipped as well as Z, because turning a part over does both. Multiplied onto
// the turn the way every other matrix here is.
const FLIPPED = [1, 0, 0, 0, -1, 0, 0, 0, -1];

// How far the part's furthest hole is from the point it turns about — which is its
// own origin most of the time, and the pin it is held by when it has one.
const leverFor = (p, centre) => leverOf(
  p.spec.holes.map((_, i) => { const [x, z] = holeAt(p, i); return { x, z }; }),
  { x: centre[0], z: centre[1] });

// ---------- snapping ----------
//
// Snapping applies to what you ask for and never to what comes back. Dragging a
// part asks for it at a round place, turning it asks for a round angle — and then
// the solver answers, and the answer is whatever the marks make it.
//
// That is the whole reason this can be switched on without breaking anything. A
// part nothing is joined to lands exactly where the grid says, because there is
// nothing to pull it off. A part in a linkage does not, because its neighbours
// have the last word, and quantising the answer is precisely the wrong thing: the
// angles this tool exists to find are not round numbers.
const STEP = { stud: STUD, half: STUD / 2, free: 0 };
const TURNS = 72;                       // five degrees

const loose = (ev) => ev.altKey || !STEP[state.snap];
const snapTo = (v, step) => Math.round(v / step) * step;
const snapPoint = (p, ev) => (loose(ev) ? p : p.map((v) => snapTo(v, STEP[state.snap])));
const snapTurn = (a, ev) => (loose(ev) ? a : snapTo(a, Math.PI * 2 / TURNS));

// ---------- drawing ----------

// An axle hole seen from above, drawn at the size an axle really is: 12 LDU
// across both ways, arms a shade over 4 thick. Which way round it lies is not
// read off the part, so this says "an axle goes here", not which way.
const AXLE = 'M-2.2,-6 h4.4 v3.8 h3.8 v4.4 h-3.8 v3.8 h-4.4 v-3.8 h-3.8 v-4.4 h3.8 z';

// A marked hole is filled with its joint's colour, but an axle hole keeps its
// shape either way: what a hole takes is a fact about the part, and covering it
// up with a disc would hide the one thing worth knowing.
const hole = (x, z, axle, fill) => (axle
  ? `<path transform="translate(${x},${z})" d="${AXLE}" fill="${fill ?? '#eef2f7'}"
       stroke="${fill ? '#1e2c3a' : '#9fb0c0'}" stroke-width="1.5" stroke-linejoin="round"/>`
  : `<circle cx="${x}" cy="${z}" r="${fill ? 7 : 5}" fill="${fill ?? '#eef2f7'}"
       stroke="${fill ? '#1e2c3a' : '#9fb0c0'}" stroke-width="1.5"/>`);

// A beam seen from above is a stud-wide round-ended line through its own holes,
// so the holes are the whole drawing: join every pair one stud apart and stroke
// it thickly. Straight, bent and L-shaped all come out right, and a part this
// has never seen does too.
const paths = new Map();
function shapeOf(spec) {
  if (!paths.has(spec.part)) {
    const d = [];
    spec.holes.forEach(({ at: [x, z] }, i) => spec.holes.slice(i + 1).forEach(({ at: [x2, z2] }) => {
      if (Math.abs(Math.hypot(x2 - x, z2 - z) - STUD) < 0.5) d.push(`M${x},${z}L${x2},${z2}`);
    }));
    // One hole on its own: a zero length stroke with a round cap is a disc.
    const [x, z] = spec.holes[0].at;
    paths.set(spec.part, d.length ? d.join('') : `M${x},${z}L${x},${z}`);
  }
  return paths.get(spec.part);
}

const beam = (spec, outline, fill) =>
  `<path d="${shapeOf(spec)}" fill="none" stroke="${outline}" stroke-width="20"
     stroke-linecap="round" stroke-linejoin="round"/>
   <path d="${shapeOf(spec)}" fill="none" stroke="${fill}" stroke-width="16.5"
     stroke-linecap="round" stroke-linejoin="round"/>`;

// The mechanism drawing for a point pinned to the frame: a pin, a triangle and
// hatching under it. It belongs to the frame and not to the part, so it is drawn
// in the world and does not turn with anything.
const GROUND = `<circle r="5.5" fill="#2b3440"/>
  <path d="M0,4 L-9,17 L9,17 Z" fill="#2b3440"/>
  <path d="M-12,17 H12" stroke="#2b3440" stroke-width="2.5"/>
  <path d="M-10,23 l4,-6 M-3,23 l4,-6 M4,23 l4,-6" stroke="#2b3440" stroke-width="2"/>`;

const picture = (spec) => `<img src="img/${spec.part.replace('.dat', '.png')}" alt="">`;

// "Bent 53.13" and "Bent 90" say the angle twice: the shape already tells you.
const label = (spec) => spec.what.replace(/^Beam /, '').replace(/(Bent) [\d.]+$/, '$1');

function render() {
  let svg = '';

  for (const [i, p] of state.parts.entries()) {
    const deg = -p.turn * 180 / Math.PI;
    svg += `<g data-p="${i}" style="cursor:grab" transform="translate(${p.x},${p.z})
              rotate(${deg})${p.flip ? ' scale(1,-1)' : ''}">
      ${beam(p.spec, i === state.selected ? '#2e7de9' : '#5d6b7c', '#fff')}`;
    p.spec.holes.forEach(({ at: [x, z], axle }, h) => {
      const joint = jointAt(i, h);
      svg += hole(x, z, axle, joint < 0 ? null : ink(joint));
      if (state.armed?.part === i && state.armed?.hole === h)
        svg += `<circle cx="${x}" cy="${z}" r="11" fill="none" stroke="#2e7de9" stroke-width="2.5"/>`;
      svg += `<circle data-p="${i}" data-h="${h}" cx="${x}" cy="${z}" r="9" fill="transparent"/>`;
    });
    svg += '</g>';
  }

  for (const h of state.holds)
    svg += `<g transform="translate(${h.anchor[0]},${h.anchor[1]})" pointer-events="none">${GROUND}</g>`;

  // The handle turns the part about whatever it is pinned to, so that is where it
  // hangs from. A part held at two holes cannot turn at all, and is given none.
  //
  // The arrow beyond it turns the part over, and lies across the handle because that
  // is the line it flips the part about — pointing both ways, because it goes back
  // the same way it came. It rides on the handle's arm so it stays the same gesture
  // wherever the part has got to.
  const p = state.parts[state.selected];
  if (p) {
    const held = holdsOn(state.selected);
    const c = held.length === 1 ? held[0].anchor : [p.x, p.z];
    const along = (d) => [c[0] + d * Math.cos(p.turn), c[1] - d * Math.sin(p.turn)];
    if (held.length < 2) {
      const at = along(80);
      svg += `<line x1="${c[0]}" y1="${c[1]}" x2="${at[0]}" y2="${at[1]}"
                stroke="#2e7de9" stroke-width="2"/>
              <circle data-rot="${state.selected}" cx="${at[0]}" cy="${at[1]}" r="9" fill="#fff"
                stroke="#2e7de9" stroke-width="3" style="cursor:grab"/>`;
    }
    const turned = along(held.length < 2 ? 112 : 80);
    svg += `<g data-flip="${state.selected}" style="cursor:pointer"
              transform="translate(${turned[0]},${turned[1]}) rotate(${-p.turn * 180 / Math.PI})">
              <title>${t('flip')}</title>
              <path d="M0,-15 L0,15 M-6,-9 L0,-15 L6,-9 M-6,9 L0,15 L6,9" fill="none"
                stroke="#2e7de9" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
              <circle r="17" fill="transparent"/>
            </g>`;
  }

  scene.innerHTML = svg;
  board.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
  renderPanels();
}

// The palette never changes, so it is built once. Rebuilding it inside render
// would mean writing every button again on every frame of a drag, for a picture
// that has not moved.
function buildPalette() {
  $('partPick').innerHTML = CATALOGUE.map((spec, i) =>
    `<button data-spec="${i}" title="${spec.what}">${picture(spec)}${label(spec)}</button>`).join('');
}

function renderPanels() {
  for (const b of $('tools').children) b.classList.toggle('on', b.dataset.tool === state.tool);
  for (const b of $('flags').children) b.classList.toggle('on', b.dataset.lang === lang);
  $('undo').disabled = !past.length;
  $('redo').disabled = !future.length;
  $('snap').value = state.snap;

  const p = state.parts[state.selected];
  $('insp').disabled = !p;
  if (p) {
    $('i-angle').value = +(p.turn * 180 / Math.PI).toFixed(1);
    $('i-level').value = p.level;
  }
  $('tolerance').value = state.tolerance;
  $('stats').innerHTML = statsHTML();
}

// Silent when there is nothing wrong. A panel that says "6 unknowns, 6
// equations, it closes" after every move is a panel nobody reads, and then the
// one time it says something that matters it is not read either.
// How far the worst joint is from closing is the one number worth a permanent
// place, so it has one and it is legible from across the room.
//
// Whether that number is bad is not something this can know: a pin hole swallows a
// little and a beam flexes a little more, and how much is a matter of what you have
// got away with before. So the line where it turns red is yours to move.
function statsHTML() {
  const mm = Math.max(0, ...(state.result?.error ?? [])) * MM;
  const said = [`<div id="off" class="${mm > state.tolerance ? 'warn' : ''}">` +
                `${t('offBy', { n: mm.toFixed(3) })}</div>`];

  if (state.joints.length && !state.holds.length) said.push(t('loose'));
  if (state.joints.length > JOINTS.length) said.push(t('tooMany', { n: JOINTS.length }));
  return said[0] + said.slice(1).map((line) => `\n<b class="warn">${line}</b>`).join('');
}

// ---------- working it out ----------

// Solved after every change, so the board is always showing an answer rather
// than a sketch waiting for a button to be pressed.
function recompute() {
  const parts = state.parts;
  const bodies = parts.map((p) => ({ c: [p.x, p.z], lever: leverFor(p, [p.x, p.z]) }));
  const term = (e) => ({ body: e.part, c: bodies[e.part].c, p: holeAt(parts[e.part], e.hole) });

  // A part being placed rather than pulled is not solved for at all: it is already
  // exactly where you put it, and the rest of the model is what has to give.
  if (state.drag && !state.drag.to) bodies[state.drag.part].fixed = true;

  // Being held is not a constraint the solver weighs against the others either, it
  // is a freedom the part does not have: one pin leaves it its angle and nothing
  // else, about that pin rather than about its own origin, and two leave it nothing
  // at all. Its pins let go only while it is the one being dragged.
  for (const h of state.holds) {
    if (h.part === state.drag?.part) continue;
    const b = bodies[h.part];
    if (b.held) { b.held = 2; b.fixed = true; b.turnOnly = false; continue; }
    b.held = 1;
    b.turnOnly = true;
    b.c = [...h.anchor];
    b.lever = leverFor(parts[h.part], h.anchor);
  }

  const constraints = state.joints.map((j) => ({ a: term(j.a), b: term(j.b) }));

  // Weighed at a five-hundredth of a joint, which is what makes dragging a link
  // drive the mechanism instead of pulling it apart. It can be this faint without
  // going numb: in the directions the joints leave free there is nothing to push
  // back, so the weight cancels out and the part follows all the same. All the
  // weight decides is how much error in a joint the pointer is allowed to buy, and
  // the answer to that should be as near none as it can be.
  if (state.drag?.to) {
    const c = bodies[state.drag.part].c;
    constraints.push({ a: { body: state.drag.part, c, p: c },
                       b: { body: null, p: state.drag.to }, w: 0.002 });
  }

  if (constraints.length) {
    const { q } = solvePlanar(bodies, constraints);
    // A part held by one pin turns about that pin, not about its own origin, so
    // that is the centre the answer has to be applied around too.
    parts.forEach((p, i) => {
      const [dx, dz, turn] = q[i];
      const c = bodies[i].c, s = Math.sin(turn), co = Math.cos(turn);
      const ux = p.x - c[0], uz = p.z - c[1];
      p.x = c[0] + ux * co + uz * s + dx;
      p.z = c[1] - ux * s + uz * co + dz;
      p.turn += turn;
    });
  }


  // Measured on the answer and off the drag: what the panel says has to be about
  // what you asked for, not about where your finger is.
  const error = [
    ...state.joints.map((j) => gap(holeAt(parts[j.a.part], j.a.hole), holeAt(parts[j.b.part], j.b.hole))),
    ...state.holds.map((h) => gap(holeAt(parts[h.part], h.hole), h.anchor)),
  ];
  state.result = { error };
  render();
}

const gap = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// ---------- what was ----------

// A model is a handful of small objects, so a step of history is a copy of the
// whole thing rather than a description of what changed — no action has to
// remember how to undo itself, and none can get it wrong. That is cheap enough
// to keep a great many of them.
//
// Only the parts a person sets. Not the view, because moving the board is not a
// change to the model and having undo scroll the screen about is maddening.
const HISTORY = 1000;
let past = [], future = [];

const snapshot = () => JSON.stringify({
  parts: state.parts.map((p) => ({ ...p, spec: p.spec.part })),
  joints: state.joints, holds: state.holds, selected: state.selected,
});

function restore(shot) {
  const was = JSON.parse(shot);
  state.parts = was.parts.map((p) => ({ ...p, spec: CATALOGUE.find((s) => s.part === p.spec) }));
  state.joints = was.joints;
  state.holds = was.holds;
  state.selected = was.selected;
  state.armed = null;
}

// Called before a change, never after. A step that would repeat the one before it
// is dropped, which is what stops a click into a number field that changes
// nothing from costing a press of undo.
function remember() {
  const now = snapshot();
  if (past[past.length - 1] === now) return;
  past.push(now);
  if (past.length > HISTORY) past.shift();
  future = [];
}

function step(from, to) {
  if (!from.length) return;
  to.push(snapshot());
  restore(from.pop());
  recompute();
}

// ---------- marking ----------

// Two clicks make a joint: this hole, then the one it has to meet. No colour to
// choose first — the colour only tells one joint from another, and the app can
// count. Clicking a hole that is already in a joint takes that joint off.
function useTool(part, hole) {
  if (state.tool === 'fix') {
    remember();
    const had = holdAt(part, hole);
    if (had >= 0) state.holds.splice(had, 1);
    else state.holds.push({ part, hole, anchor: holeAt(state.parts[part], hole) });
    state.armed = null;
    return;
  }
  // With a hole already picked, this click is the other end of that join and nothing
  // else — a hole can be in more than one joint, which is how three parts meet at a
  // point, so landing on one that is already joined adds to it rather than undoing
  // it. Undoing is what a click means when nothing is waiting.
  if (state.armed) {
    const { part: was, hole: wasHole } = state.armed;
    state.armed = null;
    if (was === part && wasHole === hole) return;             // the same hole twice
    if (was === part) { state.armed = { part, hole }; return; }  // a part cannot meet itself
    remember();
    state.joints.push({ a: { part: was, hole: wasHole }, b: { part, hole } });
    return;
  }
  const had = jointAt(part, hole);
  if (had >= 0) { remember(); state.joints.splice(had, 1); return; }
  state.armed = { part, hole };
}

// ---------- turning ----------

// Turning follows the pointer from wherever it was taken hold of: the part swings
// by however far the pointer has gone round since, not round to meet it. Grab the
// middle of a beam and it does not leap a quarter turn first.
const bearing = (c, at) => -Math.atan2(at[1] - c[1], at[0] - c[0]);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const centreOf = (g) => (g.pivot ? g.pivot.anchor
  : [state.parts[g.part].x, state.parts[g.part].z]);

function grip(part, pivot, at) {
  const g = { part, pivot };
  g.was = state.parts[part].turn;
  g.from = bearing(centreOf(g), at);
  return g;
}

// Carrying a part about. Which of two quite different things that is depends on
// whether the part is pinned to the frame:
//
// Pinned, you are moving the frame itself, so it goes exactly where you put it and
// every pin on it moves by the very same amount — two pins on one part cannot drift
// apart or turn against each other, whatever the rest of the model is doing.
//
// Not pinned, it is a link in a mechanism, so it is *pulled* rather than placed and
// the joints have the last word. It turns when turning is what it takes to stay
// joined, and it stops when the linkage stops, instead of tearing away from what it
// is joined to and leaving the model in a state it could never be built in.
function carry(g, at, ev) {
  const p = state.parts[g.part];
  const raw = [at[0] - g.from[0], at[1] - g.from[1]];
  // With pins in it, the *travel* is what snaps and not the position: an anchor
  // that started on a grid point is on one afterwards, and one that never was —
  // because its hole does not sit on the grid — keeps exactly the offset it had
  // instead of being dragged onto a line it does not belong on.
  const shift = g.held.length
    ? snapPoint(raw, ev)
    : snapPoint([g.was[0] + raw[0], g.was[1] + raw[1]], ev).map((v, k) => v - g.was[k]);
  const to = [g.was[0] + shift[0], g.was[1] + shift[1]];

  if (g.held.length) {
    p.x = to[0];
    p.z = to[1];
    g.held.forEach((h, i) => { h.anchor = [g.anchors[i][0] + shift[0], g.anchors[i][1] + shift[1]]; });
    state.drag = { part: g.part };
  } else {
    state.drag = { part: g.part, to };
  }
  recompute();
}

// Turned over about the line the arrow is drawn on, which is the one through the
// point the part turns about. Mirroring in the part's own frame flips it about a
// line through its origin, so the part is then slid back until that point is where
// it was — the two together being a mirror about the line that runs through it.
//
// Which is the intuitive line, and it pays for itself: a part hanging on one pin is
// flipped about that very pin, so the pin does not move at all. Nothing has to be
// done to keep a joint to the frame where it was, because nothing moved it.
function flipPart(i) {
  remember();
  const p = state.parts[i];
  const pivot = holdsOn(i).length === 1 ? holdsOn(i)[0] : null;
  p.flip = !p.flip;
  if (pivot) {
    const now = holeAt(p, pivot.hole);
    p.x += pivot.anchor[0] - now[0];
    p.z += pivot.anchor[1] - now[1];
  }
  // Any other pins on it have moved with their holes, and go where the holes went.
  for (const h of state.holds) if (h.part === i) h.anchor = holeAt(p, h.hole);
  recompute();
}

function turnBy(g, at, ev) {
  const p = state.parts[g.part];
  p.turn = snapTurn(g.was + wrap(bearing(centreOf(g), at) - g.from), ev);
  // Held still for the solver the same way a dragged part is: you are turning it,
  // so it goes where you turn it and the rest of the model follows.
  state.drag = { part: g.part };
  // The pin stays where it is, so the part is put back on it. Done here and not
  // left to Newton, which would drag it back afterwards and make the way there a
  // wander rather than a swing.
  if (g.pivot) {
    const now = holeAt(p, g.pivot.hole);
    p.x += g.pivot.anchor[0] - now[0];
    p.z += g.pivot.anchor[1] - now[1];
  }
  recompute();
}

// ---------- pointer ----------

function atPointer(ev) {
  const p = board.createSVGPoint();
  p.x = ev.clientX; p.y = ev.clientY;
  const q = p.matrixTransform(board.getScreenCTM().inverse());
  return [q.x, q.y];
}

// Moving and letting go are listened for on the window, not on the board. The
// board only hears where a gesture starts; a gesture that ends anywhere else —
// over a panel, off the edge of the window — still ends.
let pending = null, panning = null;
board.addEventListener('contextmenu', (ev) => ev.preventDefault());
board.addEventListener('dragstart', (ev) => ev.preventDefault());

board.addEventListener('pointerdown', (ev) => {
  ev.preventDefault();
  if (ev.button === 2) {
    panning = [ev.clientX, ev.clientY];
    board.classList.add('panning');
    return;
  }
  const flip = ev.target.closest('[data-flip]');
  const rot = ev.target.closest('[data-rot]');
  const spot = ev.target.closest('[data-h]');
  const part = ev.target.closest('[data-p]');
  if (flip) { flipPart(+flip.dataset.flip); return; }
  if (rot) {
    remember();
    const part = +rot.dataset.rot, held = holdsOn(part);
    pending = { turning: grip(part, held.length === 1 ? held[0] : null, atPointer(ev)) };
    return;
  }
  if (!part) { state.selected = null; state.armed = null; render(); return; }
  // A hole covers most of a beam, so which one you meant is only known once you
  // either move or let go: a drag is a drag, a tap on a hole is a mark.
  pending = { part: +part.dataset.p, hole: spot ? +spot.dataset.h : null,
              from: atPointer(ev), moved: false };
});

globalThis.addEventListener('pointermove', (ev) => {
  if (panning) {
    const perPixel = view.w / board.clientWidth;
    view.x -= (ev.clientX - panning[0]) * perPixel;
    view.y -= (ev.clientY - panning[1]) * perPixel;
    panning = [ev.clientX, ev.clientY];
    render();
    return;
  }
  if (!pending) return;
  const at = atPointer(ev);

  // Taking hold of the handle is already the whole gesture; taking hold of a part is
  // only a gesture once it has gone somewhere, or every click on a hole would count
  // as a drag of nothing.
  if (!pending.turning) {
    if (!pending.moved && Math.hypot(at[0] - pending.from[0], at[1] - pending.from[1]) < 6) return;
    if (!pending.moved) {
      pending.moved = true;
      remember();
      state.selected = pending.part;
      state.armed = null;
      // What a drag means is decided once, here, by what the part is pinned to —
      // because that is what decides what it is able to do at all.
      const held = holdsOn(pending.part);
      if (held.length === 1) pending.turning = grip(pending.part, held[0], pending.from);
      else {
        const p = state.parts[pending.part];
        pending.was = [p.x, p.z];
        pending.held = held;
        pending.anchors = held.map((h) => [...h.anchor]);
      }
    }
  }
  if (pending.turning) turnBy(pending.turning, at, ev);
  else carry(pending, at, ev);
});

globalThis.addEventListener('pointerup', () => {
  // Cleared before anything else is done with them. Whatever goes wrong below,
  // the gesture is over — the alternative is a part that carries on turning after
  // the button is up, because an error on the way out skipped the tidying.
  const was = pending;
  pending = null;
  state.drag = null;

  if (panning) { panning = null; board.classList.remove('panning'); }
  else if (was?.part !== undefined && !was.moved) {
    state.selected = was.part;
    if (was.hole !== null) useTool(was.part, was.hole);
  }
  recompute();
});

globalThis.addEventListener('pointercancel', () => {
  pending = panning = state.drag = null;
  board.classList.remove('panning');
  render();
});

board.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  const k = Math.min(4, Math.max(0.25, Math.exp(ev.deltaY * 0.0015)));
  const at = atPointer(ev);                          // fixed point of the zoom
  const w = Math.min(6000, Math.max(120, view.w * k)), scale = w / view.w;
  view.x = at[0] - (at[0] - view.x) * scale;
  view.y = at[1] - (at[1] - view.y) * scale;
  view.w = w; view.h *= scale;
  render();
}, { passive: false });

globalThis.addEventListener('keydown', (ev) => {
  const typing = /input|select|textarea/i.test(ev.target.tagName);
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') {
    ev.preventDefault();
    return ev.shiftKey ? step(future, past) : step(past, future);
  }
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'y') {
    ev.preventDefault();
    return step(future, past);
  }
  if (ev.key === 'Escape') { state.armed = null; render(); }
  if (ev.key === 'Delete' && state.selected !== null && !typing) removePart();
});

// ---------- panels ----------

$('partPick').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-spec]');
  if (!b) return;
  remember();
  // Staggered, because parts dropped exactly on top of each other are both
  // impossible to grab and impossible to tell apart once exported.
  const n = state.parts.length;
  const [x, z] = snapPoint([view.x + view.w / 2 + (n % 5) * 30,
                            view.y + view.h / 2 + (n % 5) * 30], {});
  state.parts.push({ spec: CATALOGUE[+b.dataset.spec], level: 0, turn: 0, flip: false, x, z });
  state.selected = state.parts.length - 1;
  recompute();
});

$('tools').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-tool]');
  if (!b) return;
  state.tool = b.dataset.tool;
  state.armed = null;
  render();
});

$('flags').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-lang]');
  if (!b) return;
  setLang(b.dataset.lang);
  applyLanguage();
  render();
});

function removePart() {
  remember();
  const gone = state.selected;
  const shift = (e) => ({ ...e, part: e.part > gone ? e.part - 1 : e.part });
  state.parts.splice(gone, 1);
  // Everything points at parts by number, so the ones after the hole shuffle up.
  state.joints = state.joints.filter((j) => j.a.part !== gone && j.b.part !== gone)
    .map((j) => ({ a: shift(j.a), b: shift(j.b) }));
  state.holds = state.holds.filter((h) => h.part !== gone).map(shift);
  state.selected = null;
  state.armed = null;
  recompute();
}

$('i-del').onclick = removePart;
// Remembered when the field is entered rather than on every keystroke, so typing
// "135" is one step back and not three.
for (const id of ['i-angle', 'i-level']) $(id).addEventListener('focus', remember);
$('i-angle').addEventListener('input', () => {
  state.parts[state.selected].turn = +$('i-angle').value * Math.PI / 180;
  recompute();
});
$('i-level').addEventListener('input', () => {
  state.parts[state.selected].level = +$('i-level').value;
  render();
});
$('snap').onchange = () => { state.snap = $('snap').value; render(); };
$('tolerance').addEventListener('input', () => {
  state.tolerance = Math.max(0, +$('tolerance').value || 0);
  localStorage.setItem('tolerance', state.tolerance);
  render();
});
$('undo').onclick = () => step(past, future);
$('redo').onclick = () => step(future, past);
$('reset').onclick = () => {
  remember();
  state.parts = []; state.joints = []; state.holds = [];
  state.selected = state.armed = null;
  recompute();
};

// ---------- solving a model from Studio ----------
//
// Not the board: this is the command line tool, for anyone who would rather not
// clone a repository. The same model.js runs, so any part at all can be used and
// submodels work — the only difference is where the holes are read. There is no
// LDraw library in a browser, so it carries a table of every hole in it instead,
// fetched only when somebody actually opens a file.
//
// What comes back is a solved .ldr and the report, which is the whole output. The
// board is left alone: a model built in Studio is not a sketch to be redrawn here.
let library = null;

async function ldrawTable() {
  if (!library) {
    const { HOLES, NAMES, COLOURS } = await import('./holes.js');
    const key = (part) => part.replace(/\.dat$/, '');
    library = {
      holes: (part) => (HOLES[key(part)] ?? [])
        .map(([x, y, z, axle]) => ({ at: [x, y, z], axle: !!axle })),
      describe: (part) => NAMES[key(part)] ?? key(part),
      colourName: (code) => COLOURS[code] ?? `colour ${code}`,
    };
  }
  return library;
}

$('file').addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  ev.target.value = '';                        // so the same file can be opened twice
  if (!file) return;
  $('output').textContent = t('working');
  $('sheet').hidden = false;
  try {
    const text = /\.io$/i.test(file.name)
      ? await readStudio(new Uint8Array(await file.arrayBuffer()))
      : await file.text();
    const { report, solveModel, withoutMarks } = await import('./model.js');
    const lib = await ldrawTable();
    const res = solveModel(text, lib);
    $('output').textContent = report(res, file.name, lib);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([withoutMarks(res.text)], { type: 'text/plain' }));
    a.download = file.name.replace(/\.[^.]+$/, '') + '-solved.ldr';
    a.click();
  } catch (err) {
    $('output').textContent = String(err.message ?? err);
  }
});

$('close').onclick = () => { $('sheet').hidden = true; };

// ---------- out ----------

// The parts where they ended up, and nothing else. The joints and the fixings are
// the question, not the answer: they are what was asked here, and by the time this
// file exists the holes already meet. Opening it in Studio should give you the
// thing you are building, not the thing you are building it with.
function toLDR() {
  const out = ['0 FILE diagonals.ldr', '0 Made with LEGO diagonal generator', '0 Name: diagonals.ldr'];
  const sits = (p) => (p.flip ? mul(rotY(p.turn), FLIPPED) : rotY(p.turn));
  for (const p of state.parts)
    out.push(formatLine({ colour: 71, t: [p.x, -STUD * p.level, p.z], m: sits(p), part: p.spec.part }));
  out.push('0');
  return out.join('\n');
}

$('save').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([toLDR()], { type: 'text/plain' }));
  a.download = 'diagonals.ldr';
  a.click();
};

buildPalette();
applyLanguage();
recompute();
