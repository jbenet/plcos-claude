import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkStrategy, type Strategy } from './strategy';

export interface StrategyFile {
  s: Strategy;
  hash: string;
  fileKey: string;
  file: string;
  folder: string | null;
}

/** W5 accepts a legacy file or one vehicle folder, never a recursive tree or symlink. */
export async function readStrategyFiles(dir: string, refuse: (file: string, reasons: string[]) => void): Promise<StrategyFile[]> {
  const root = join(dir, 'strategy');
  const files: Array<{ name: string; folder: string | null }> = [];
  const entries = await readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.json')) files.push({ name: entry.name, folder: null });
    else if (entry.isDirectory()) {
      for (const child of await readdir(join(root, entry.name), { withFileTypes: true })) {
        if (child.isFile() && child.name.endsWith('.json')) files.push({ name: child.name, folder: entry.name });
        else if (child.isDirectory() || child.isSymbolicLink()) refuse(`${entry.name}/${child.name}`, ['only one vehicle folder level is allowed; symlinks are not read']);
      }
    } else if (entry.isSymbolicLink()) refuse(entry.name, ['symlinks are not read']);
  }
  const records: StrategyFile[] = [];
  for (const { name, folder } of files.sort((a, b) => `${a.folder ?? ''}/${a.name}`.localeCompare(`${b.folder ?? ''}/${b.name}`))) {
    const file = folder ? `${folder}/${name}` : name;
    const fileKey = name.replace(/\.json$/, '');
    let text: string;
    let value: unknown;
    try { text = await readFile(join(root, file), 'utf8'); value = JSON.parse(text); }
    catch { refuse(file, ['not readable JSON']); continue; }
    const problems = checkStrategy(value, fileKey);
    if (problems.length) { refuse(file, problems); continue; }
    records.push({ s: value as Strategy, hash: createHash('sha1').update(text).digest('hex'), fileKey, file, folder });
  }
  return records;
}
