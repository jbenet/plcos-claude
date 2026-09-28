import { authorizationCoverage } from './authz-coverage';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { SHOT } from './shot-image';

/**
 * The two boundaries worth enforcing from L1, both an afternoon's work and both miserable
 * to retrofit (docs/12):
 *
 *   1. No database driver is imported outside lib/db/.
 *   2. A module is imported through its index.ts, never its repo.ts or service.ts.
 *   3. Nothing outside lib/connectors/affinity/ names Affinity's host or the variable that
 *      holds its key (N39). The client there is read-only; a second way in would not be.
 *   4. Changelog screenshots are stored small (issue 0021): WebP only, none over the size
 *      in scripts/shot-image.ts. Git keeps every one forever, so a big one is paid for on
 *      every clone.
 *   5. In-app links go through components/ui/AppLink (issues 0027–0028): next/link is
 *      imported only there, so an old address is put in its place before a click instead of
 *      being redirected in the middle of a client navigation, which Safari broke on.
 *   3b. The same for Linear (docs/24-linear.md): only lib/connectors/linear/ names its host or the
 *      variable that holds its key.
 *   6. Browser code never calls crypto.randomUUID (issue 0104): it is undefined outside a secure
 *      context, and the live server is reached over plain http on the local network. A request
 *      key comes from lib/request-key.ts, which falls back to crypto.getRandomValues.
 */
const ROOTS = ['app', 'components', 'lib', 'modules', 'config', 'scripts'];
const DRIVERS = ['@electric-sql/pglite', "from 'pg'", 'from "pg"'];
const AFFINITY = ['api.affinity.co', 'AFFINITY_API_KEY'];
// Dakota (docs/20-dakota.md): only its connector names the host; its data stays in data/real and the database.
const DAKOTA = ['marketplace-as-a-service.herokuapp.com'];
// Linear (docs/24-linear.md): only its connector names the host or the key's variable; its client sends queries only.
const LINEAR = ['api.linear.app', 'LINEAR_API_KEY'];
const LINEAR_PROPERTIES = new Set(['scripts/properties/linear.ts']);
// The original harness exception follows only the three files that hold those checks.
const AFFINITY_PROPERTIES = new Set([
  'scripts/properties/affinity.ts', 'scripts/properties/affinity-notes.ts',
  'scripts/properties/deployment.ts',
]);

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) await walk(p, out);
    else if (/\.(?:tsx?|mjs|cjs)$/.test(entry.name)) out.push(p);
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

  const authorization = await authorizationCoverage(cwd);
  const violations: string[] = [...authorization.violations];
  for (const file of files) {
    const rel = relative(cwd, file);
    const text = await readFile(file, 'utf8');

    if (!rel.startsWith('lib/db') && rel !== 'scripts/boundaries.ts') {
      for (const d of DRIVERS) {
        if (text.includes(d)) violations.push(`${rel}: imports a database driver (${d}) outside lib/db/`);
      }
    }

    // The property harness is the one exception: it has to aim at the guard to test it.
    if (!rel.startsWith(join('lib', 'connectors', 'affinity')) && rel !== 'scripts/boundaries.ts' && !AFFINITY_PROPERTIES.has(rel)) {
      for (const needle of AFFINITY) {
        if (text.includes(needle)) violations.push(`${rel}: mentions ${needle} — only lib/connectors/affinity/ talks to Affinity`);
      }
    }

    if (!rel.startsWith(join('lib', 'connectors', 'dakota')) && rel !== 'scripts/boundaries.ts') {
      for (const needle of DAKOTA) {
        if (text.includes(needle)) violations.push(`${rel}: mentions ${needle} — only lib/connectors/dakota/ talks to Dakota`);
      }
    }

    if (!rel.startsWith(join('lib', 'connectors', 'linear')) && rel !== 'scripts/boundaries.ts' && !LINEAR_PROPERTIES.has(rel)) {
      for (const needle of LINEAR) {
        if (text.includes(needle)) violations.push(`${rel}: mentions ${needle} — only lib/connectors/linear/ talks to Linear`);
      }
    }

    if (rel !== join('components', 'ui', 'AppLink.tsx') && /from ['"]next\/link['"]/.test(text)) {
      violations.push(`${rel}: imports next/link — use @/components/ui/AppLink, which puts an old address in its place`);
    }

    if (/^['"]use client['"]/m.test(text) && /crypto\.randomUUID\s*\(/.test(text)) {
      violations.push(`${rel}: calls crypto.randomUUID in browser code — use newRequestKey from @/lib/request-key; plain http has no randomUUID`);
    }

    // `client.ts` is a deliberate second entrance: types and constants, no data access.
    const deep = text.match(/from '@\/modules\/([a-z-]+)\/(repo|service|types|schema)[^']*'/g) ?? [];
    for (const hit of deep) {
      const owner = /@\/modules\/([a-z-]+)\//.exec(hit)?.[1];
      if (owner && !rel.startsWith(join('modules', owner))) {
        violations.push(`${rel}: ${hit} — import the module through its index.ts`);
      }
    }
  }

  const shots = join(cwd, 'docs', 'changelog', 'shots');
  const stored: string[] = [];
  const walkShots = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) await walkShots(p);
      else stored.push(p);
    }
  };
  await walkShots(shots);
  for (const file of stored) {
    const rel = relative(cwd, file);
    if (!file.endsWith(SHOT.ext)) {
      violations.push(`${rel}: screenshots are stored as ${SHOT.ext} — npm run shots:compress converts it`);
    } else if ((await stat(file)).size > SHOT.maxBytes) {
      violations.push(`${rel}: ${Math.round((await stat(file)).size / 1024)} KB, over the ${SHOT.maxBytes / 1024} KB a screenshot may be`);
    }
  }

  if (violations.length) {
    console.error(`module boundary violations (${violations.length}):`);
    for (const v of violations) console.error('  ' + v);
    process.exit(1);
  }
  console.log(`boundaries ok · ${authorization.actions} authorized actions · ${authorization.routes} authorized handlers · ${files.length} files checked · ${stored.length} screenshots, all ${SHOT.ext} and under ${SHOT.maxBytes / 1024} KB`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
