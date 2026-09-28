/** Count-only build boundary audit. Never opens or traverses a forbidden target. */
import { lstat, readFile, readdir, readlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export type BuildTraceAudit = { traces: number; entries: number; outputFiles: number; violations: number; invalid: number };
const forbidden = (path: string): boolean => {
  // Case-insensitive comparison is conservative on Linux and necessary on default macOS volumes.
  const parts = path.replaceAll('\\', '/').toLowerCase().split('/').filter(Boolean);
  return parts.includes('plcos-data') || parts.some((part, i) => part === 'data' && parts[i + 1] === 'real');
};

/** Resolve each symlink before walking further, including aliases with nonexistent tails. */
async function safePath(path: string, base: string, hops = 0): Promise<string | null> {
  if (forbidden(path) || hops > 40) return null;
  // Do not normalize dot segments before inspecting links: alias/../safe may first
  // enter a private symlink target even though path.resolve erases that component.
  const absolute = isAbsolute(path) ? path : `${base}${sep}${path}`;
  if (forbidden(absolute)) return null;
  const root = parse(absolute).root;
  const parts = absolute.slice(root.length).split(sep).filter(Boolean);
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === '.') continue;
    if (parts[i] === '..') { current = dirname(current); continue; }
    current = join(current, parts[i]!);
    if (forbidden(current)) return null;
    let stat;
    try { stat = await lstat(current); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        const absent = resolve(current, ...parts.slice(i + 1));
        if (forbidden(absent)) return null;
        // Next joins trace paths before copying. A missing/../alias sequence can
        // therefore expose a link even though the literal filesystem walk stops.
        return absent === absolute ? absent : safePath(absent, root, hops + 1);
      }
      throw error;
    }
    if (stat.isSymbolicLink()) {
      const target = await readlink(current);
      if (forbidden(target)) return null;
      return safePath(`${target}${sep}${parts.slice(i + 1).join(sep)}`, dirname(current), hops + 1);
    }
  }
  return current;
}

export async function auditBuildTraces(outputDir = '.next'): Promise<BuildTraceAudit> {
  const result: BuildTraceAudit = { traces: 0, entries: 0, outputFiles: 0, violations: 0, invalid: 0 };
  const visited = new Set<string>();
  async function visit(path: string): Promise<void> {
    const safe = await safePath(path, process.cwd());
    if (safe === null) { result.violations++; return; }
    const stat = await lstat(safe);
    if (stat.isDirectory()) {
      if (visited.has(safe)) return;
      visited.add(safe);
      for (const child of await readdir(safe)) await visit(join(safe, child));
      return;
    }
    if (!stat.isFile()) { result.invalid++; return; }
    result.outputFiles++;
    if (!path.endsWith('.nft.json')) return;
    result.traces++;
    let manifest: unknown;
    try { manifest = JSON.parse(await readFile(safe, 'utf8')); }
    catch { result.invalid++; return; }
    if (!manifest || typeof manifest !== 'object' || !('version' in manifest) || manifest.version !== 1
      || !('files' in manifest) || !Array.isArray(manifest.files)
      || manifest.files.some(file => typeof file !== 'string' || !file.trim() || file.includes('\0'))) {
      result.invalid++; return;
    }
    for (const file of manifest.files as string[]) {
      result.entries++;
      const physical = await safePath(file, dirname(safe));
      const logical = await safePath(file, resolve(dirname(path)));
      if (physical === null || logical === null) result.violations++;
    }
  }
  try { await visit(outputDir); } catch { result.invalid++; }
  if (!result.traces || !result.entries) result.invalid++;
  return result;
}

export const buildTracesPass = (result: BuildTraceAudit): boolean => result.violations === 0 && result.invalid === 0;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = process.argv[2] ?? process.env.NEXT_DIST_DIR ?? (process.env.DATA_PROFILE === 'real' ? '.next-real' : '.next');
  const result = await auditBuildTraces(output);
  console.log(JSON.stringify({ check: 'build-traces', ...result, pass: buildTracesPass(result) }));
  process.exitCode = buildTracesPass(result) ? 0 : 1;
}
