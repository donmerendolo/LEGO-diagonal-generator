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

// Studio writes the file with a byte order mark, which is one more thing than
// LDraw says a line can start with.
export const readStudio = async (bytes) =>
  (await readZipEntry(bytes, 'model.ldr')).replace(/^﻿/, '');
