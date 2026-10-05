import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * The working files a snapshot carries with `?files=1` (docs/deploy/railway.md §6): everything under the
 * data root but what scripts/cutover-files.sh leaves out at cutover. Its three lists are read from the
 * script itself, so the two can never drift: what cutover moves up is what a pull brings down. A script
 * that cannot be read or holds no lists refuses the archive (fail closed).
 */
export interface Exclusions { dirs: string[]; files: string[]; exports: string[] }

export async function cutoverExclusions(script = join(process.cwd(), 'scripts/cutover-files.sh')): Promise<Exclusions> {
  const text = await readFile(script, 'utf8');
  const list = (name: string) => {
    const m = new RegExp(`^${name}=\\(([^)]*)\\)`, 'm').exec(text);
    if (!m) throw new Error(`cutover-files.sh has no ${name} list.`);
    return m[1]!.trim().split(/\s+/).filter(Boolean);
  };
  return { dirs: list('EXCLUDE_DIRS'), files: list('EXCLUDE_FILES'), exports: list('EXPORTS') };
}

/** Whether a path relative to the data root (POSIX separators) stays out of the archive. */
export function excluded(rel: string, x: Exclusions): boolean {
  const [top] = rel.split('/');
  if (x.dirs.includes(top!) || x.files.includes(rel)) return true;
  if (rel.startsWith('enrich/') && x.exports.includes(rel.slice('enrich/'.length))) return true;
  return rel.split('/').some((part) => part.startsWith('.real-copy-'));
}

/** Regular files and links under root that the archive carries, as relative paths, sorted. Directories are walked, never followed through a link. */
export async function filesToCarry(root: string, x?: Exclusions): Promise<string[]> {
  const rules = x ?? await cutoverExclusions();
  const out: string[] = [];
  const walk = async (rel: string) => {
    for (const entry of await readdir(join(root, rel), { withFileTypes: true })) {
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (excluded(path, rules)) continue;
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() || entry.isSymbolicLink()) out.push(path);
    }
  };
  await walk('');
  return out.sort();
}
