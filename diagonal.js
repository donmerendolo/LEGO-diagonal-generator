// deno run -A diagonal.js modelo.ldr        (or modelo.io, straight from Studio)
//
// Reads a model laid out roughly by hand in Studio, reads the marker pins in it,
// works out where every part has to go for the marked holes to meet, and writes
// the model back out.
//
// The work is in model.js, which is the same code the web app runs. All that is
// here is where the text comes from and where the holes are read: on this side of
// the fence there is a whole LDraw library on disk, so any part at all can be
// used, submodels included.

import { colourName, describe, findLibrary, holesOf } from './library.js';
import { readStudio } from './io.js';
import { report, solveModel, withoutMarks } from './model.js';

const readModel = async (path) => (path.toLowerCase().endsWith('.io')
  ? readStudio(Deno.readFileSync(path))
  : Deno.readTextFileSync(path));

export async function run(path, outPath, root) {
  const library = {
    holes: (part) => holesOf(root, part),
    describe: (part) => describe(root, part),
    colourName: (code) => colourName(root, code),
  };
  const res = solveModel(await readModel(path), library);
  Deno.writeTextFileSync(outPath, withoutMarks(res.text));
  console.log(report(res, path, library) + `\n\nwritten ${outPath}`);
  return res;
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
  await run(args[0], flag('out') ?? args[0].replace(/\.[^.]+$/, '') + '-solved.ldr', root);
}
