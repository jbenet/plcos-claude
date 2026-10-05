import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * The working files a snapshot carries with `?files=1` (docs/deploy/railway.md §6): everything under the
 * data root but what scripts/cutover-files.sh leaves out at cutover, for the same reasons. A property
 * reads that script's three lists and fails if these drift from them.
 */
export const EXCLUDE_DIRS = ['postgres', 'database', 'dakota', 'logs', 'rehearsal', 'backups', 'cloud-copy'] as const;
export const EXCLUDE_FILES = ['database.lock', 'postgres.url', '.preview-copy'] as const;
/** Research exports under enrich/, regenerated from the database by "Export the research set". */
export const EXPORTS = ['research-set.jsonl', 'candidates.jsonl', 'team.json', 'triage.jsonl', 'identity-review.jsonl', 'lp-unit-review.jsonl'] as const;

/** Whether a path relative to the data root (POSIX separators) stays out of the archive. */
export function excluded(rel: string): boolean {
  const [top] = rel.split('/');
  if ((EXCLUDE_DIRS as readonly string[]).includes(top!) || (EXCLUDE_FILES as readonly string[]).includes(rel)) return true;
  if (rel.startsWith('enrich/') && (EXPORTS as readonly string[]).includes(rel.slice('enrich/'.length))) return true;
  return rel.split('/').some((part) => part.startsWith('.real-copy-'));
}

/** Regular files and links under root that the archive carries, as relative paths, sorted. Directories are walked, never followed through a link. */
export async function filesToCarry(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (rel: string) => {
    for (const entry of await readdir(join(root, rel), { withFileTypes: true })) {
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (excluded(path)) continue;
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() || entry.isSymbolicLink()) out.push(path);
    }
  };
  await walk('');
  return out.sort();
}
