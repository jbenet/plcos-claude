import { spawnSync } from 'node:child_process';
import {
  constants, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

/**
 * The copy a preview serves (npm run preview, docs/COLLAB.md). In a dev worktree data/real is a
 * plain folder holding this copy; in the live folder it is a link to the real data. So a dev
 * worktree can only ever reach a copy, and these functions only ever replace one they made.
 */

/** The file that marks data/real as a copy made here. It holds the time the copy was taken. */
export const MARKER = '.preview-copy';

const isLink = (p: string) => {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

/**
 * Why a preview may not replace this checkout's data/real, or null when it may: only a folder with
 * the marker, or nothing at all. A link is how the live folder reaches the real data, so a link is
 * never touched — and neither is a folder without the marker, whatever it holds.
 */
export function previewRefusal(root: string): string | null {
  const data = join(root, 'data');
  const target = join(data, 'real');
  if (isLink(data)) return `data is a link (to ${readlinkSync(data)}). A preview writes only inside this checkout.`;
  if (isLink(target)) {
    return `data/real is a link (to ${readlinkSync(target)}), which is how the live folder reaches the real data. A preview replaces only its own copy.`;
  }
  if (!existsSync(target)) return null;
  if (!statSync(target).isDirectory()) return 'data/real is a file, not a copy made by npm run preview. Move it away first.';
  if (!existsSync(join(target, MARKER))) {
    return `data/real has no ${MARKER}, so it is not a copy made by npm run preview. Move it away first: a preview replaces only its own copy.`;
  }
  return null;
}

/**
 * An APFS clone where the disk can make one — near-instant, and no space until either side changes
 * — else a plain copy. Node's COPYFILE_FICLONE does not clone on macOS (libuv answers ENOSYS to
 * FICLONE_FORCE, measured 25 Sep 2026), so on a Mac the clone is cp's: -c is clonefile(2). -L copies
 * what a link points at rather than the link, so nothing in the copy can reach back into the source.
 */
function copyTree(source: string, dest: string): 'clone' | 'copy' {
  if (process.platform === 'darwin') {
    const r = spawnSync('/bin/cp', ['-c', '-R', '-L', source, dest], { encoding: 'utf8' });
    if (r.status === 0) return 'clone';
    rmSync(dest, { recursive: true, force: true });
  }
  cpSync(source, dest, { recursive: true, dereference: true, mode: constants.COPYFILE_FICLONE });
  return 'copy';
}

/**
 * Copy the source into data/real: into a temporary folder, then a rename, so a copy that fails
 * leaves the last one in place and never half a folder. Returns when the copy was taken — the
 * moment it began, so the copy never claims to be newer than it is.
 *
 * The live server may be writing while the copy is taken, so a copy can catch a half-written
 * page. checkOpens() finds most of those; the fix is to run npm run preview again.
 */
export function takeCopy(source: string, root: string): { takenAt: string; how: 'clone' | 'copy' } {
  const data = join(root, 'data');
  const target = join(data, 'real');
  const tmp = join(data, '.real-copy-tmp');
  const old = join(data, '.real-copy-old');
  // Left by a run that stopped half-way. Nothing but this function makes these two.
  rmSync(tmp, { recursive: true, force: true });
  rmSync(old, { recursive: true, force: true });
  mkdirSync(data, { recursive: true });
  const takenAt = new Date().toISOString();
  let how: 'clone' | 'copy';
  try {
    how = copyTree(source, tmp);
    // A lock names the process that has a database open (lib/db/lock.ts): in the source, the live
    // server. Carried into the copy it would make the copy refuse to open, so it stays behind.
    for (const f of readdirSync(tmp)) if (f.endsWith('.lock')) rmSync(join(tmp, f), { force: true });
    writeFileSync(join(tmp, MARKER), `${takenAt}\n`);
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
  if (existsSync(target)) renameSync(target, old);
  renameSync(tmp, target);
  rmSync(old, { recursive: true, force: true });
  return { takenAt, how };
}

/** That the copy's database opens, and how many tables it has — a count, never a name. */
export async function checkOpens(root: string): Promise<string> {
  const dir = join(root, 'data', 'real', 'database');
  if (!existsSync(join(dir, 'PG_VERSION'))) {
    throw new Error('the copy has no database (data/real/database/PG_VERSION is missing). Is previewSource the real data’s folder?');
  }
  const { openPglite } = await import('../lib/db/pglite');
  const db = await openPglite(dir);
  try {
    const row = await db.one<{ n: string }>(
      `select count(*)::text as n from information_schema.tables where table_schema not in ('pg_catalog', 'information_schema')`,
    );
    return `${row?.n ?? '0'} tables`;
  } finally {
    await db.close();
  }
}
