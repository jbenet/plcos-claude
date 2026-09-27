import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { config } from '../../config/deployment';
import { RawDigester, type RawDigest } from './raw-digest';

// Bump when extraction/coverage semantics change. Resolved estimate configuration
// participates too, so a deployment cannot retain old token-to-byte assumptions.
export const cacheVersion = `1:${config.activity.bytesPerToken}:${config.activity.legacyMatchWindowMs}`;
type Entry = { signature: string; checksum: string; value: unknown };
export const checksum = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Disk = { version: string; entries: Record<string, Entry> };
export interface ActivityFiles {
  parsed<T>(path: string, kind: string, extract: () => Promise<T>): Promise<T>;
  raw(path: string): Promise<RawDigest | null>;
}
export async function atomicJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
    await rename(temporary, path);
  } finally { await rm(temporary, { force:true }); }
}

/** Private, disposable per-file extraction cache; never persisted outside its root. */
export class ActivityFileCache implements ActivityFiles {
  private entries: Record<string, Entry> = Object.create(null);
  private seen = new Set<string>();
  private digester = new RawDigester();
  readonly stats = { reads: 0, hits: 0 };
  constructor(private root: string) {}
  async load(): Promise<void> {
    try {
      const disk: Disk = JSON.parse(await readFile(join(this.root, 'activity/digests-v1.json'), 'utf8'));
      if (disk.version === cacheVersion && disk.entries && typeof disk.entries === 'object') {
        let count = 0;
        for (const [key, entry] of Object.entries(disk.entries)) {
          if (++count % 32 === 0) await yieldTurn();
          // Treat valid-JSON corruption like a miss, not an endlessly failing hit.
          if (entry && typeof entry.signature === 'string' && entry.value !== undefined
            && entry.checksum === checksum(entry.value)) this.entries[key] = entry;
        }
      }
    } catch { /* Missing/torn/old caches are disposable. Sources remain authoritative. */ }
  }
  begin() { this.seen.clear(); }
  async parsed<T>(path: string, kind: string, extract: () => Promise<T>): Promise<T> {
    // Even cache hits yield. No microtask-only loop through thousands of entries.
    await yieldTurn();
    const key = `${kind}:${relative(this.root, path)}`;
    this.seen.add(key);
    let signature: string;
    try { const s = await stat(path); signature = `${s.size}:${s.mtimeMs}:${s.ctimeMs}`; }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; signature = 'missing'; }
    const old = this.entries[key];
    if (old?.signature === signature) { this.stats.hits++; return old.value as T; }
    const value = await extract();
    this.stats.reads++;
    // Changes during a read are not cached under the earlier stat. The next pass
    // will retry, including after an external writer replaces a file atomically.
    let after = 'missing';
    try { const s = await stat(path); after = `${s.size}:${s.mtimeMs}:${s.ctimeMs}`; }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    if (after !== signature) throw new Error('Activity source changed during refresh');
    this.entries[key] = { signature, checksum:checksum(value), value };
    return value;
  }
  raw(path: string) { return this.parsed(path, 'research', () => this.digester.read(path)); }
  async save(): Promise<void> {
    for (const key of Object.keys(this.entries)) if (!this.seen.has(key)) delete this.entries[key];
    await mkdir(join(this.root, 'activity'), { recursive: true });
    await yieldTurn();
    await atomicJson(join(this.root, 'activity/digests-v1.json'), { version: cacheVersion, entries: this.entries });
  }
  async close() { await this.digester.close(); }
}
