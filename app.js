// The interface. Everything is in LDU and seen from above, which is the plane
// the parts turn in: X to the right, Z down the screen, exactly as Studio shows
// it. The solver is the one the command line tool uses, imported and not
// reimplemented — a second copy of the mathematics would be a second copy to be
// wrong.

import { CATALOGUE } from './parts.js';
import { formatLine, MM, mul, parseModel, rotY, STUD } from './ldraw.js';
import { readStudio } from './io.js';
import { assignMarkers, leverOf } from './marks.js';
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
const PIN = { joint: '3749.dat', ground: '43093.dat' };
const PIN_BASE = [0, -1, 0, 1, 0, 0, 0, 0, 1];

const state = {
  parts: [],        // { spec, x, z, turn, level }
  joints: [],       // { a: {part, hole}, b: {part, hole} }
  holds: [],        // { part, hole, anchor: [x, z] }
  tool: 'join',
  armed: null,      // the first hole of a join not finished yet
  snap: 'stud',
  selected: null,
  message: '',
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
const holeAt = (p, i) => {
  const [hx, hz] = p.spec.holes[i].at;
  const c = Math.cos(p.turn), s = Math.sin(p.turn);
  return [p.x + hx * c + hz * s, p.z - hx * s + hz * c];
};

// A part's reach never changes, so it is worked out once from the catalogue.
const levers = new Map();
function leverFor(spec) {
  if (!levers.has(spec.part))
    levers.set(spec.part, leverOf(spec.holes.map((h) => ({ x: h.at[0], z: h.at[1] })), { x: 0, z: 0 }));
  return levers.get(spec.part);
}

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
const TURNS = 24;                       // fifteen degrees

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
    svg += `<g data-p="${i}" style="cursor:grab" transform="translate(${p.x},${p.z}) rotate(${deg})">
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
  const p = state.parts[state.selected];
  if (p) {
    const held = holdsOn(state.selected);
    if (held.length < 2) {
      const c = held.length === 1 ? held[0].anchor : [p.x, p.z];
      const at = [c[0] + 80 * Math.cos(p.turn), c[1] - 80 * Math.sin(p.turn)];
      svg += `<line x1="${c[0]}" y1="${c[1]}" x2="${at[0]}" y2="${at[1]}"
                stroke="#2e7de9" stroke-width="2"/>
              <circle data-rot="${state.selected}" cx="${at[0]}" cy="${at[1]}" r="9" fill="#fff"
                stroke="#2e7de9" stroke-width="3" style="cursor:grab"/>`;
    }
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
  const said = statsHTML();
  $('stats').innerHTML = said;
  $('result').hidden = !said;
}

// Silent when there is nothing wrong. A panel that says "6 unknowns, 6
// equations, it closes" after every move is a panel nobody reads, and then the
// one time it says something that matters it is not read either.
function statsHTML() {
  const lines = state.message ? state.message.split('\n') : [];
  if (state.joints.length && !state.holds.length) lines.push(t('loose'));
  if (state.joints.length > JOINTS.length) lines.push(t('tooMany', { n: JOINTS.length }));

  // A pin hole swallows a little and a beam flexes a little more. Past that it is
  // not a tight fit, it is a model that does not exist.
  const mm = Math.max(0, ...(state.result?.error ?? [])) * MM;
  if (mm >= 0.05) lines.push(t(mm < 0.3 ? 'flex' : 'fails', { n: mm.toFixed(3) }));

  return lines.map((line) => `<b class="warn">${line}</b>`).join('\n');
}

// ---------- working it out ----------

// Solved after every change, so the board is always showing an answer rather
// than a sketch waiting for a button to be pressed.
function recompute() {
  const parts = state.parts;
  const bodies = parts.map((p) => ({ c: [p.x, p.z], lever: leverFor(p.spec) }));
  const term = (e) => ({ body: e.part, c: bodies[e.part].c, p: holeAt(parts[e.part], e.hole) });

  const constraints = state.joints.map((j) => ({ a: term(j.a), b: term(j.b) }));

  // A held hole meets its anchor: the place it was standing when you marked it,
  // remembered once. Pinning it afresh to wherever it has got to would hold
  // nothing at all. While its part is being dragged it lets go, and is set down
  // again where the part lands.
  for (const h of state.holds)
    if (h.part !== state.drag?.part)
      constraints.push({ a: term(h), b: { body: null, p: h.anchor } });

  if (state.drag) {
    const i = state.drag.part, c = bodies[i].c, to = state.drag.to;
    constraints.push({ a: { body: i, c, p: c }, b: { body: null, p: to } });
    // Held at two holes, a part is part of the frame, and dragging it should
    // carry it about without turning it. Two points asked to move by the same
    // amount say exactly that, in the only language the solver has.
    if (state.drag.rigid) {
      const L = bodies[i].lever;
      const off = [L * Math.cos(parts[i].turn), -L * Math.sin(parts[i].turn)];
      constraints.push({
        a: { body: i, c, p: [c[0] + off[0], c[1] + off[1]] },
        b: { body: null, p: [to[0] + off[0], to[1] + off[1]] },
      });
    }
  }

  if (constraints.length) {
    const { q } = solvePlanar(bodies, constraints);
    parts.forEach((p, i) => { p.x += q[i][0]; p.z += q[i][1]; p.turn += q[i][2]; });
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
  if (state.tool === 'hold') {
    remember();
    const had = holdAt(part, hole);
    if (had >= 0) state.holds.splice(had, 1);
    else state.holds.push({ part, hole, anchor: holeAt(state.parts[part], hole) });
    state.armed = null;
    return;
  }
  const had = jointAt(part, hole);
  if (had >= 0) { remember(); state.joints.splice(had, 1); state.armed = null; return; }
  if (!state.armed) { state.armed = { part, hole }; return; }
  if (state.armed.part === part && state.armed.hole === hole) { state.armed = null; return; }
  remember();
  state.joints.push({ a: state.armed, b: { part, hole } });
  state.armed = null;
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
  const rot = ev.target.closest('[data-rot]');
  const spot = ev.target.closest('[data-h]');
  const part = ev.target.closest('[data-p]');
  if (rot) { remember(); pending = { turning: +rot.dataset.rot }; return; }
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

  if (pending.turning !== undefined) {
    const p = state.parts[pending.turning];
    const held = holdsOn(pending.turning);
    // Turned about the hole it is pinned to, here and now, rather than about its
    // own origin with Newton left to drag the pin back afterwards. Same finish,
    // but the way there is a part swinging on its pin instead of wandering.
    const centre = held.length === 1 ? held[0].anchor : [p.x, p.z];
    p.turn = snapTurn(-Math.atan2(at[1] - centre[1], at[0] - centre[0]), ev);
    if (held.length === 1) {
      const now = holeAt(p, held[0].hole);
      p.x += held[0].anchor[0] - now[0];
      p.z += held[0].anchor[1] - now[1];
    }
    recompute();
    return;
  }

  if (!pending.moved && Math.hypot(at[0] - pending.from[0], at[1] - pending.from[1]) < 6) return;
  if (!pending.moved) {
    pending.moved = true;
    remember();
    state.selected = pending.part;
    state.armed = null;
    const p = state.parts[pending.part];
    pending.was = [p.x, p.z];
    pending.rigid = holdsOn(pending.part).length >= 2;
  }
  const shift = [at[0] - pending.from[0], at[1] - pending.from[1]];
  // A part that is only being carried has its *travel* snapped, not its position:
  // two anchors that started on the grid are still on the grid afterwards. A part
  // free to turn has no such promise to keep, so its origin is what snaps.
  state.drag = {
    part: pending.part, rigid: pending.rigid,
    to: pending.rigid
      ? snapPoint(shift, ev).map((v, k) => pending.was[k] + v)
      : snapPoint([pending.was[0] + shift[0], pending.was[1] + shift[1]], ev),
  };
  recompute();
});

globalThis.addEventListener('pointerup', () => {
  // Cleared before anything else is done with them. Whatever goes wrong below,
  // the gesture is over — the alternative is a part that carries on turning after
  // the button is up, because an error on the way out skipped the tidying.
  const was = pending, dragged = state.drag;
  pending = null;
  state.drag = null;

  if (panning) { panning = null; board.classList.remove('panning'); }
  else if (was?.part !== undefined && !was.moved) {
    state.selected = was.part;
    if (was.hole !== null) useTool(was.part, was.hole);
  }
  // Whatever is held on the part just dragged is held where it now stands.
  if (dragged)
    for (const h of state.holds)
      if (h.part === dragged.part) h.anchor = holeAt(state.parts[h.part], h.hole);
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
  state.parts.push({ spec: CATALOGUE[+b.dataset.spec], level: 0, turn: 0, x, z });
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
$('undo').onclick = () => step(past, future);
$('redo').onclick = () => step(future, past);
$('reset').onclick = () => {
  remember();
  state.parts = []; state.joints = []; state.holds = [];
  state.selected = state.armed = null;
  state.message = '';
  recompute();
};

// ---------- in ----------

// Opening a model does here what the command line tool does, with one limit it
// cannot get around: there is no LDraw library in a browser, so it only knows the
// parts in the palette. Anything else is named and left out rather than guessed
// at, and a part turned any way but about Y is not in this plane at all.
const isY = (m) => [m[1], m[3], m[5], m[7]].every((v) => Math.abs(v) < 1e-4)
  && Math.abs(Math.abs(m[4]) - 1) < 1e-4;

function open(text) {
  const parts = [], markers = [], lost = new Set();
  for (const line of parseModel(text)) {
    if (!line.part) continue;
    if (line.part === PIN.joint || line.part === PIN.ground) { markers.push(line); continue; }
    const spec = CATALOGUE.find((s) => s.part === line.part);
    if (!spec || !isY(line.m)) { lost.add(line.part.replace('.dat', '')); continue; }
    parts.push({ spec, x: line.t[0], z: line.t[2], level: Math.round(-line.t[1] / STUD),
                 turn: Math.atan2(line.m[2], line.m[0]) });
  }
  if (!parts.length) throw new Error(t('nothingKnown'));

  const owner = assignMarkers(
    markers.map((m) => ({ x: m.t[0], y: m.t[1], z: m.t[2],
                          group: m.part === PIN.ground ? null : m.colour })),
    parts.map((p) => ({ holes: p.spec.holes.map((h, i) => {
      const [x, z] = holeAt(p, i);
      return { x, y: -STUD * p.level, z };
    }) })));

  const holds = [], groups = new Map();
  let stray = 0;
  markers.forEach((marker, k) => {
    const part = owner[k];
    // A pin whose part was left out has nothing to be snapped into any more. It is
    // its own kind of trouble, not a missing part, and saying so as one confuses
    // a marker pin with a beam.
    if (part === null) { stray++; return; }
    const hole = nearestHole(parts[part], [marker.t[0], marker.t[2]]);
    if (marker.part === PIN.ground) { holds.push({ part, hole, anchor: holeAt(parts[part], hole) }); return; }
    if (!groups.has(marker.colour)) groups.set(marker.colour, []);
    groups.get(marker.colour).push({ part, hole });
  });

  // A colour with three pins in it is two joints, the same way three parts meeting
  // at a point is two joints. A colour with one is half a thought, and dropped.
  const joints = [];
  for (const group of groups.values())
    for (let i = 1; i < group.length; i++) joints.push({ a: group[i - 1], b: group[i] });

  remember();
  state.parts = parts; state.joints = joints; state.holds = holds;
  state.selected = state.armed = null;
  state.message = [
    lost.size ? t('leftOut', { n: [...lost].sort().join(', ') }) : '',
    stray ? t('strayPins', { n: stray }) : '',
  ].filter(Boolean).join('\n');
  recompute();
}

const nearestHole = (p, at) => p.spec.holes
  .map((_, i) => i)
  .reduce((best, i) => (gap(holeAt(p, i), at) < gap(holeAt(p, best), at) ? i : best), 0);

$('file').addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  ev.target.value = '';                        // so the same file can be opened twice
  if (!file) return;
  try {
    open(/\.io$/i.test(file.name)
      ? await readStudio(new Uint8Array(await file.arrayBuffer()))
      : await file.text());
  } catch (err) {
    state.message = String(err.message ?? err);
    render();
  }
});

// ---------- out ----------

// Written so the command line tool can read it straight back: real parts, real
// marker pins, in the colours the joints are drawn in.
function toLDR() {
  const out = ['0 FILE diagonals.ldr', '0 Made with LEGO diagonal generator', '0 Name: diagonals.ldr'];
  const y = (p) => -STUD * p.level;
  for (const p of state.parts)
    out.push(formatLine({ colour: 71, t: [p.x, y(p), p.z], m: rotY(p.turn), part: p.spec.part }));

  const pin = (e, colour, part) => {
    const p = state.parts[e.part];
    const [x, z] = holeAt(p, e.hole);
    return formatLine({ colour, t: [x, y(p), z], m: mul(rotY(p.turn), PIN_BASE), part });
  };
  state.joints.forEach((j, i) => {
    for (const end of [j.a, j.b]) out.push(pin(end, JOINTS[i % JOINTS.length][0], PIN.joint));
  });
  for (const h of state.holds) out.push(pin(h, 72, PIN.ground));
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
