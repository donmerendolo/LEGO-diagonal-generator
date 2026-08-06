// Reading and writing LDraw text. Nothing here touches the disk.
//
// A line of type 1 is:  1 <colour> x y z  a b c d e f g h i  <part>
// where the nine numbers are the rotation matrix, by rows, and a point of the
// part lands at M·p + t. Units are LDU: 20 LDU = 1 stud = 8 mm.
//
// Y points down, so the plane parallel to the floor is XZ and the only rotation
// this tool ever applies is about Y. Everything else in a part's matrix — on
// edge, upside down, turned a quarter — is carried through untouched, which is
// why the answer is multiplied *onto* the matrix rather than replacing it.

export const MM = 0.4;          // one LDU, in millimetres
export const STUD = 20;         // LDU

const num = (v) => {
  const r = +v.toFixed(6);
  return Object.is(r, -0) ? '0' : String(r);
};

// Every line comes back, so the file can be written out again with the ones
// nobody moved left exactly as they were.
export function parseModel(text) {
  return text.split(/\r?\n/).map((raw) => {
    const f = raw.trim().split(/\s+/);
    if (f[0] !== '1' || f.length < 15) return { raw };
    const v = f.slice(2, 14).map(Number);
    if (v.some(Number.isNaN)) return { raw };
    return { raw, colour: +f[1], t: v.slice(0, 3), m: v.slice(3, 12),
             part: f.slice(14).join(' ').replace(/\\/g, '/').toLowerCase() };
  });
}

export const formatLine = (l) =>
  ['1', l.colour, ...l.t.map(num), ...l.m.map(num), l.part].join(' ');

export const writeModel = (lines) =>
  lines.map((l) => (l.part ? formatLine(l) : l.raw)).join('\n');

export const mul = (A, B) => {
  const C = new Array(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      C[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
  return C;
};

export const apply = (m, t, p) => [
  m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + t[0],
  m[3] * p[0] + m[4] * p[1] + m[5] * p[2] + t[1],
  m[6] * p[0] + m[7] * p[1] + m[8] * p[2] + t[2],
];

export const rotY = (th) => {
  const c = Math.cos(th), s = Math.sin(th);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
};

