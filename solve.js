// Position analysis of a planar mechanism, the way you would do it by hand:
// write down what has to be true, differentiate, and let Newton walk to it.
//
// Every body has three unknowns — how far it slides in X and Z, and how far it
// turns about its own origin. Every constraint says two points must end up in
// the same place, which is two equations. Solve r(q) = 0.
//
// It starts from the layout as drawn, and that is the whole reason this needs no
// CAD. A triangle can be assembled two ways and a four-bar likewise; starting
// beside the sketch picks the one you meant, without anyone having to say so.
// The damping does the other half: where the layout does not pin something
// down, the step of smallest norm wins, so a body nobody constrained stays
// exactly where you left it instead of wandering off to a solution of its own.

// Rotation about Y, seen in the XZ plane: x' = x cos + z sin, z' = -x sin + z cos.
function place(q, term) {
  if (term.body === null) return term.p;
  const [dx, dz, th] = q[term.body];
  const s = Math.sin(th), c = Math.cos(th);
  const ux = term.p[0] - term.c[0], uz = term.p[1] - term.c[1];
  return [term.c[0] + ux * c + uz * s + dx, term.c[1] - ux * s + uz * c + dz];
}

// Sliding and turning have to be comparable before "the smallest step" means
// anything, and they are not: dx is in LDU and dθ in radians, so turning a whole
// radian costs the same as sliding one LDU. Left alone the solver turns
// everything, because turning is nearly free — drop a beam, join one end of it
// to a point, and it swings to reach instead of sliding across.
//
// So the unknown is not the angle but the angle times the body's own reach: how
// far its furthest hole is from the point it turns about. Then a step is
// measured in how far the part actually moved, whichever way it moved, and the
// two are the same currency.
//
// The penalty on top says turning is dearer than sliding by that factor. It has
// to be a good deal more than 1, because the smallest step always splits the work
// between the two in proportion to what each costs: at 3 the beam still comes to
// rest a tenth turned, which is a tenth you can see. At 20 what is left is under
// a twentieth of a degree. It costs nothing where turning is genuinely required,
// because there the constraints say so and a preference does not get a vote.
const PENALTY = 20;
const reach = (b) => PENALTY * (b.lever || 1);

// d(place)/dθ, which is all the Jacobian needs that is not a 1 or a 0.
function turnRate(q, term) {
  const [, , th] = q[term.body];
  const s = Math.sin(th), c = Math.cos(th);
  const ux = term.p[0] - term.c[0], uz = term.p[1] - term.c[1];
  return [-ux * s + uz * c, -ux * c - uz * s];
}

// Solve A x = b in place, partial pivoting. A is (JᵀJ + λI), never big: three
// unknowns per body, and a model with fifty bodies is a big model.
function gauss(A, b, n) {
  for (let k = 0; k < n; k++) {
    let pivot = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(A[i][k]) > Math.abs(A[pivot][k])) pivot = i;
    if (!(Math.abs(A[pivot][k]) > 1e-12)) return null;
    [A[k], A[pivot]] = [A[pivot], A[k]];
    [b[k], b[pivot]] = [b[pivot], b[k]];
    for (let i = k + 1; i < n; i++) {
      const f = A[i][k] / A[k][k];
      if (!f) continue;
      for (let j = k; j < n; j++) A[i][j] -= f * A[k][j];
      b[i] -= f * b[k];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j < n; j++) s -= A[i][j] * x[j];
    x[i] = s / A[i][i];
  }
  return x;
}

const residuals = (q, constraints) => constraints.map((k) => {
  const a = place(q, k.a), b = place(q, k.b);
  return [a[0] - b[0], a[1] - b[1]];
});

// A constraint may say how much it matters. Everything the model is actually made
// of weighs 1; the odd soft one — the pull of a pointer dragging a part about —
// weighs less, so it can never talk a joint out of closing and only gets a say in
// what the joints leave undecided.
const weight = (k) => k.w ?? 1;
const cost = (r, constraints) =>
  r.reduce((s, [x, z], i) => s + weight(constraints[i]) ** 2 * (x * x + z * z), 0);

// Normal equations, accumulated straight from the two non-zero blocks of each row
// rather than building the whole Jacobian.
function normal(q, r, bodies, constraints, arm, n) {
  const A = Array.from({ length: n }, () => new Array(n).fill(0));
  const g = new Array(n).fill(0);
  constraints.forEach((k, ci) => {
    const w = weight(k);
    for (const axis of [0, 1]) {
      const row = new Map();
      for (const [term, sign] of [[k.a, w], [k.b, -w]]) {
        if (term.body === null) continue;
        const body = bodies[term.body];
        if (body.fixed) continue;              // nothing of it left to solve for
        const base = term.body * 3;
        if (!body.turnOnly) row.set(base + axis, (row.get(base + axis) ?? 0) + sign);
        row.set(base + 2, (row.get(base + 2) ?? 0)
          + sign * turnRate(q, term)[axis] / arm[term.body]);
      }
      for (const [i, vi] of row) {
        g[i] += vi * w * r[ci][axis];
        for (const [j, vj] of row) A[i][j] += vi * vj;
      }
    }
  });
  return { A, g };
}

// Which unknowns the constraints never reached, each from 0 for tied down to 1 for
// free to move, and the sum of them all is how many ways the model can still move.
// "21 unknowns, 20 equations, 1 free" says there is one; this says whose it is.
//
// It is the diagonal of the projector onto the null space, got at without going
// anywhere near an eigenvector: solve (A + εI)x = eᵢ and take ε·xᵢ, which is
// Σ vⱼ[i]²·ε/(λⱼ+ε) — every direction the model is held in contributes nothing, and
// every direction it is not contributes the whole of its share.
//
// Where several parts swing together the freedom is shared out among them, and they
// are all named, because any one of them is somewhere it could be pinned down.
function freedom(A, n, bodies) {
  const EPS = 1e-9;
  const out = bodies.map(() => [0, 0, 0]);
  for (let i = 0; i < n; i++) {
    const body = bodies[(i / 3) | 0], k = i % 3;
    if (body.fixed || (body.turnOnly && k < 2)) continue;   // that unknown does not exist
    const e = new Array(n).fill(0);
    e[i] = 1;
    const x = gauss(A.map((row, r) => row.map((v, c) => (r === c ? v + EPS : v))), e, n);
    out[(i / 3) | 0][k] = x ? Math.min(1, Math.max(0, EPS * x[i])) : 1;
  }
  return out;
}

// bodies: [{ c: [x, z], lever, fixed, turnOnly }], the point each one turns about
// and how far its furthest hole is from it.
// constraints: [{ a, b }] where a term is { body, c, p } and a body of null means
// the point is nailed to the world.
//
// A part held to the frame does not get its held-ness as another equation to be
// weighed against the rest, because least squares would then trade a tenth of a
// millimetre of it for a tenth somewhere else, and a part that is nailed down is
// nailed down. It simply loses the freedom instead: `fixed` has no unknowns at all
// and cannot move, and `turnOnly` keeps just its angle, turning about `c`, which is
// then the hole it hangs on rather than its own origin. A freedom that does not
// exist needs no defending.
//
// The tolerance is on the sum of squares, in LDU², so it stops around a
// ten-billionth of a stud. Absurd next to a pin hole, but Newton doubles its
// digits every step, so the last few are two iterations and they keep the
// reported error meaning "the solver is done" rather than "the solver stopped".
export function solvePlanar(bodies, constraints, { iters = 80, tol = 1e-20, loose = false } = {}) {
  const n = bodies.length * 3;
  const arm = bodies.map(reach);
  const q = bodies.map(() => [0, 0, 0]);
  let r = residuals(q, constraints), best = cost(r, constraints);
  let lambda = 1e-6;

  for (let it = 0; it < iters && best > tol; it++) {
    const { A, g } = normal(q, r, bodies, constraints, arm, n);

    let stepped = false;
    for (let tries = 0; tries < 12 && !stepped; tries++) {
      for (let i = 0; i < n; i++) A[i][i] += lambda;
      const d = gauss(A.map((row) => row.slice()), g.map((v) => -v), n);
      for (let i = 0; i < n; i++) A[i][i] -= lambda;
      if (d) {
        // The third unknown was the angle times the reach, so it comes back out.
        const trial = q.map((v, i) =>
          [v[0] + d[i * 3], v[1] + d[i * 3 + 1], v[2] + d[i * 3 + 2] / arm[i]]);
        const rt = residuals(trial, constraints), ct = cost(rt, constraints);
        if (ct < best) {
          q.forEach((v, i) => v.splice(0, 3, ...trial[i]));
          r = rt; best = ct; lambda = Math.max(1e-12, lambda / 3);
          stepped = true;
          continue;
        }
      }
      lambda *= 8;                       // too far, or singular: shorten the step
    }
    if (!stepped) break;                 // nothing left to gain
  }

  return {
    q,
    error: residuals(q, constraints).map(([x, z]) => Math.hypot(x, z)),
    // Asked for, not always: it is a solve per unknown, and the board redraws this
    // on every frame of a drag where nobody is reading it.
    free: loose ? freedom(normal(q, r, bodies, constraints, arm, n).A, n, bodies) : null,
  };
}
