import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** The lock sits beside the directory, not in it, so PGlite never sees a file it did not write. */
export const lockFile = (dir: string) => `${dir.replace(/\/+$/, '')}.lock`;

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists and belongs to somebody else. Still alive.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/** The process holding this directory, if one is running. */
export async function lockHolder(dir: string): Promise<number | null> {
  try {
    const pid = Number((await readFile(lockFile(dir), 'utf8')).trim());
    return pid && pid !== process.pid && alive(pid) ? pid : null;
  } catch {
    return null;
  }
}

/**
 * PGlite is single-process. Two handles on one directory do not fail — they corrupt it,
 * later, and the damage looks like a bug somewhere else. The dev server and a script opening
 * the same database is the easy way to get there, so the second opener refuses by name.
 * A lock left by a process that has exited is taken over.
 */
export async function lock(dir: string): Promise<() => Promise<void>> {
  const holder = await lockHolder(dir);
  if (holder) {
    throw new Error(
      `${dir} is open in another process (pid ${holder}). PGlite is single-process and a second ` +
        'handle corrupts the database. Stop that process first — usually a running dev server.',
    );
  }
  await mkdir(dirname(lockFile(dir)), { recursive: true });
  await writeFile(lockFile(dir), String(process.pid));
  return () => rm(lockFile(dir), { force: true });
}
