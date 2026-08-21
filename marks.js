// Which part is each marker pin snapped into?
//
// Shared, because it is the one piece of this that is easy to get quietly wrong.
// The command line tool reads the holes off the LDraw library; the web app knows
// its own catalogue. Neither should have its own opinion about the answer.
//
// The coordinates are the turning plane's own: X and Z across it, Y along the axis
// everything turns about — which for a model standing upright is the model's own X,
// Y and Z, and for one lying at an angle is the same thing said in its own terms.
//
// Only X and Z are compared, so a pin joining two parts on different levels — one
// long pin through both — is a joint like any other. The distance along the axis is
// only the tie breaker, and there is a tie whenever a model is already solved: the
// joint has done its job, so both parts have a hole in that exact spot and the
// nearest one is a coin toss.

const SNAP = 0.5;              // LDU a marker may sit from the hole it is in

// markers: [{ x, y, z, group }] — group being the colour of a joint pin, or null
// for one that holds a part to the frame.
// bodies: [{ holes: [{ x, y, z }] }] in the same frame.
//
// Returns an array the same length as markers, each entry the index of the body
// that marker belongs to, or null if it is in nobody's hole.
export function assignMarkers(markers, bodies) {
  const choices = markers.map((m) => bodies
    .map((b, i) => ({ i, away: Math.min(...b.holes
      .filter((h) => Math.abs(h.x - m.x) <= SNAP && Math.abs(h.z - m.z) <= SNAP)
      .map((h) => Math.abs(h.y - m.y))) }))
    .filter((c) => isFinite(c.away))
    .sort((p, q) => p.away - q.away)
    .map((c) => c.i));

  // Two pins of one colour are two parts meeting, so they get two different
  // parts even when both could pick the same one. Fewest choices first, so a pin
  // with only one part it can belong to takes it before a pin that has a say.
  // Pins that hold a part to the frame are not paired with anything, and two of
  // them on one part is exactly how a part is held still.
  const owner = new Array(markers.length).fill(null);
  const taken = new Map();
  const order = markers.map((_, k) => k).sort((a, b) => choices[a].length - choices[b].length);
  for (const k of order) {
    const could = choices[k];
    if (!could.length) continue;
    const group = markers[k].group;
    const used = taken.get(group) ?? [];
    owner[k] = group === null ? could[0] : could.find((i) => !used.includes(i)) ?? could[0];
    if (group !== null) taken.set(group, [...used, owner[k]]);
  }
  return owner;
}

// How far a body's furthest hole is from the point it turns about. The solver
// wants it so that turning and sliding can be compared; a part with one hole at
// its own origin still has to have some reach, or nothing about it is comparable
// to anything.
export const leverOf = (holes, origin) =>
  Math.max(20, ...holes.map((h) => Math.hypot(h.x - origin.x, h.z - origin.z)));
