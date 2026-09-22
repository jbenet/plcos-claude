import { readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { encodeShot, SHOT } from './shot-image';

/**
 * Convert every PNG under docs/changelog/shots/ to the stored format, and point
 * CHANGELOG.md at the new names (issue 0021). Idempotent: with no PNG left it does nothing.
 *
 *   npm run shots:compress
 *
 * New screenshots never need this; `npm run shots` writes the stored format directly. It is
 * here for a capture that arrived some other way, and as the record of how the old ones
 * were converted.
 */
const ROOT = join('docs', 'changelog', 'shots');

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (/\.png$/i.test(e.name)) out.push(p);
  }
  return out;
}

async function main() {
  const pngs = (await walk(join(process.cwd(), ROOT))).sort();
  let before = 0;
  let after = 0;
  for (const file of pngs) {
    const png = await readFile(file);
    const image = await encodeShot(png);
    await writeFile(file.replace(/\.png$/i, SHOT.ext), image);
    await rm(file);
    before += png.length;
    after += image.length;
  }

  const log = join(process.cwd(), 'CHANGELOG.md');
  const text = await readFile(log, 'utf8');
  // Only links into the screenshot folder change; a PNG named in prose is left alone.
  const rewritten = text.replace(/(docs\/changelog\/shots\/[^)\s]+)\.png\)/g, `$1${SHOT.ext})`);
  const links = (text.match(/docs\/changelog\/shots\/[^)\s]+\.png\)/g) ?? []).length;
  if (rewritten !== text) await writeFile(log, rewritten);

  const mb = (n: number) => (n / 1024 / 1024).toFixed(1);
  console.log(`converted ${pngs.length} screenshots · ${mb(before)} MB → ${mb(after)} MB · ${links} links rewritten in CHANGELOG.md`);
  const big = [];
  for (const f of pngs.map((p) => p.replace(/\.png$/i, SHOT.ext))) {
    if ((await stat(f)).size > SHOT.maxBytes) big.push(relative(process.cwd(), f));
  }
  if (big.length) console.log(`over ${SHOT.maxBytes / 1024} KB even so:\n  ${big.join('\n  ')}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
