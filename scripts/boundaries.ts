import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

/**
 * The two boundaries worth enforcing from L1, both an afternoon's work and both miserable
 * to retrofit (docs/12):
 *
 *   1. No database driver is imported outside lib/db/.
 *   2. A module is imported through its index.ts, never its repo.ts or service.ts.
 */
const ROOTS = ['app', 'components', 'lib', 'modules', 'config', 'scripts'];
const DRIVERS = ['@electric-sql/pglite', "from 'pg'", 'from "pg"'];

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) await walk(p, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(p);
  }
  return out;
}

async function main() {
  const cwd = process.cwd();
  const files: string[] = [];
  for (const r of ROOTS) {
    try {
      await walk(join(cwd, r), files);
    } catch {
      /* root not present yet */
    }
  }

  const violations: string[] = [];
  for (const file of files) {
    const rel = relative(cwd, file);
    const text = await readFile(file, 'utf8');

    if (!rel.startsWith('lib/db') && rel !== 'scripts/boundaries.ts') {
      for (const d of DRIVERS) {
        if (text.includes(d)) violations.push(`${rel}: imports a database driver (${d}) outside lib/db/`);
      }
    }

    const deep = text.match(/from '@\/modules\/([a-z-]+)\/(repo|service|types|schema)[^']*'/g) ?? [];
    for (const hit of deep) {
      const owner = /@\/modules\/([a-z-]+)\//.exec(hit)?.[1];
      if (owner && !rel.startsWith(join('modules', owner))) {
        violations.push(`${rel}: ${hit} — import the module through its index.ts`);
      }
    }
  }

  if (violations.length) {
    console.error(`module boundary violations (${violations.length}):`);
    for (const v of violations) console.error('  ' + v);
    process.exit(1);
  }
  console.log(`boundaries ok · ${files.length} files checked`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
