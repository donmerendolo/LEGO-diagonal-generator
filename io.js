// Studio's .io is an ordinary zip — no password, no obfuscation — with the
// model inside it as plain LDraw text.
//
// Only reading. There are three copies of the model in there (model.ldr,
// modelv2.ldr with Studio's own part ids, and model.lxfml) and keeping all
// three in step is Studio's job. The answer always comes back out as a .ldr.

const u16 = (d, at) => d.getUint16(at, true);
const u32 = (d, at) => d.getUint32(at, true);

// The end-of-central-directory record is last, after a comment of up to 64k.
function findDirectory(d) {
  for (let at = d.byteLength - 22; at >= 0; at--)
    if (u32(d, at) === 0x06054b50) return { count: u16(d, at + 10), start: u32(d, at + 16) };
  return null;
}

export async function readZipEntry(bytes, want) {
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dir = findDirectory(d);
  if (!dir) throw new Error('not a zip file');

  let at = dir.start;
  for (let i = 0; i < dir.count; i++) {
    if (u32(d, at) !== 0x02014b50) throw new Error('damaged zip directory');
    const nameLen = u16(d, at + 28), size = u32(d, at + 20), method = u16(d, at + 10);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen));
    if (name === want) {
      // The local header repeats the name and carries its own extra field, so
      // where the bytes actually start can only be read from there.
      const head = u32(d, at + 42);
      const from = head + 30 + u16(d, head + 26) + u16(d, head + 28);
      const data = bytes.subarray(from, from + size);
      if (method === 0) return new TextDecoder().decode(data);
      if (method !== 8) throw new Error(`${want} is compressed in a way this does not read`);
      const out = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new TextDecoder().decode(await new Response(out).arrayBuffer());
    }
    at += 46 + nameLen + u16(d, at + 30) + u16(d, at + 32);
  }
  throw new Error(`no ${want} inside that file`);
}

// What Studio hides, it hides in a copy of its own. Neither model.ldr nor the .ldr
// Studio exports — the same file, byte for byte — says anything about it, and its own
// count of bricks includes the hidden ones, so something set aside in Studio otherwise
// reads back here as an ordinary part and gets solved along with the rest.
//
// modelv2.ldr is that model again with every placement written as a line of type 11,
// in the same blocks in the same order, and the fourth field of one says whether it is
// hidden. The two are matched by position, because that is the only thing they agree
// on exactly — and checked before it is trusted: same number of placements, each in
// the same place to a thousandth. If they do not line up, nothing is left out. Solving
// a part that was out of sight is a smaller mistake than losing one.
//
// Hidden at the top level and hidden inside a submodel are not the same thing, and
// they do not get the same treatment.
//
// At the top level it is something you set aside: it goes, and its line is replaced by
// a comment rather than deleted, so the answer says what it left out and where, in the
// file rather than only on the way past.
//
// Inside a submodel it is part of that build. The answer never touches what is inside
// a submodel and does not start now — the line comes out exactly as it went in. What
// it does not get to be is somewhere a mark can land: a hole nobody can see is not a
// hole a pin was put in, and letting it claim one would hang the mark on the wrong
// body. Which is why those come back named instead of edited.
export function withoutHidden(model, own) {
  const lines = model.split(/\r?\n/);
  const placed = [];
  let block = 0;                        // 1 is the model on the table, then the submodels
  lines.forEach((raw, at) => {
    const line = raw.trim();
    if (/^0\s+FILE\b/i.test(line)) { block++; return; }
    const f = line.split(/\s+/);
    if (f[0] === '1') placed.push({ at, f, top: block <= 1 });
  });
  const theirs = own.split(/\r?\n/)
    .map((raw) => raw.trim().split(/\s+/)).filter((f) => f[0] === '11');

  const lineUp = placed.length === theirs.length && placed.every(({ f }, i) =>
    [0, 1, 2].every((k) => Math.abs(+f[2 + k] - +theirs[i][5 + k]) < 0.001));
  if (!lineUp) return { text: model, hidden: new Set() };

  const hidden = new Set();
  placed.forEach(({ at, f, top }, i) => {
    if (theirs[i][3] !== 'True') return;
    if (top) lines[at] = `0 hidden in Studio, left out: ${f.slice(14).join(' ')}`;
    else hidden.add(at);
  });
  return { text: lines.join('\n'), hidden };
}

// Studio writes the file with a byte order mark, which is one more thing than
// LDraw says a line can start with.
export async function readStudio(bytes) {
  const model = (await readZipEntry(bytes, 'model.ldr')).replace(/^﻿/, '');
  try {
    return withoutHidden(model, (await readZipEntry(bytes, 'modelv2.ldr')).replace(/^﻿/, ''));
  } catch {
    return { text: model, hidden: new Set() };   // an .io old enough not to have that copy
  }
}
