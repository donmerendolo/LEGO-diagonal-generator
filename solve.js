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

const cost = (r) => r.reduce((s, [x, z]) => s + x * x + z * z, 0);

// bodies: [{ c: [x, z] }], the origin each one turns about — its own position in
// the file. constraints: [{ a, b }] where a term is { body, c, p } and a body of
// null means the point is nailed to the world.
// The tolerance is on the sum of squares, in LDU², so it stops around a
// ten-billionth of a stud. Absurd next to a pin hole, but Newton doubles its
// digits every step, so the last few are two iterations and they keep the
// reported error meaning "the solver is done" rather than "the solver stopped".
export function solvePlanar(bodies, constraints, { iters = 80, tol = 1e-20 } = {}) {
  const n = bodies.length * 3;
  const q = bodies.map(() => [0, 0, 0]);
  let r = residuals(q, constraints), best = cost(r);
  let lambda = 1e-6;

  for (let it = 0; it < iters && best > tol; it++) {
    // Normal equations, accumulated straight from the two non-zero blocks of
    // each row rather than building the whole Jacobian.
    const A = Array.from({ length: n }, () => new Array(n).fill(0));
    const g = new Array(n).fill(0);
    constraints.forEach((k, ci) => {
      for (const axis of [0, 1]) {
        const row = new Map();
        for (const [term, sign] of [[k.a, 1], [k.b, -1]]) {
          if (term.body === null) continue;
          const base = term.body * 3;
          row.set(base + axis, (row.get(base + axis) ?? 0) + sign);
          row.set(base + 2, (row.get(base + 2) ?? 0) + sign * turnRate(q, term)[axis]);
        }
        for (const [i, vi] of row) {
          g[i] += vi * r[ci][axis];
          for (const [j, vj] of row) A[i][j] += vi * vj;
        }
      }
    });

    let stepped = false;
    for (let tries = 0; tries < 12 && !stepped; tries++) {
      for (let i = 0; i < n; i++) A[i][i] += lambda;
      const d = gauss(A.map((row) => row.slice()), g.map((v) => -v), n);
      for (let i = 0; i < n; i++) A[i][i] -= lambda;
      if (d) {
        const trial = q.map((v, i) => [v[0] + d[i * 3], v[1] + d[i * 3 + 1], v[2] + d[i * 3 + 2]]);
        const rt = residuals(trial, constraints), ct = cost(rt);
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

  return { q, error: residuals(q, constraints).map(([x, z]) => Math.hypot(x, z)) };
}
