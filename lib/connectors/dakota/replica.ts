import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import FIELDS from './fields.json';

export type Module = 'account' | 'contact';
export type RecordFields = Record<string, string | null> & { id: string; lastmodifieddate: string };
export interface Replica { module: Module; file: string; hash: string; records: RecordFields[] }
export const needed = (module: Module): string[] => FIELDS.needed[module];
/** Drop everything except the public needed fields before data reaches any persistence code. */
export function neededRecord(module: Module, raw: unknown): RecordFields {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid Dakota record.');
  const r = raw as Record<string,unknown>, result: Record<string,string|null> = {};
  for (const key of needed(module)) {
    const value = key === 'id' ? r[`${module}_id`] ?? r.id : r[key];
    if (value === undefined) continue; // Missing fields from partial pulls do not erase prior fields.
    if (value === null) result[key] = null;
    else if (['string','number','boolean'].includes(typeof value)) result[key] = String(value);
    else if (Array.isArray(value) && value.every(x=>['string','number','boolean'].includes(typeof x))) result[key] = value.join('; ');
    else throw new Error('Invalid Dakota field shape.');
  }
  if (!result.id || !result.lastmodifieddate || !Number.isFinite(Date.parse(result.lastmodifieddate))) throw new Error('Dakota identity or modification date missing.');
  result.lastmodifieddate = new Date(result.lastmodifieddate).toISOString();
  return result as RecordFields;
}
/** Complete manifests are the authority. Replay complete deltas through the newest per module.
 * This reader has no filesystem writes, network calls, logger or DB-opening entry point. */
export async function readReplicas(rawDir: string): Promise<Replica[]> {
  const names = (await readdir(rawDir)).filter(f=>/^[-\dTZ]+\.manifest\.json$/.test(f)).sort();
  const replicas: Array<Replica & { at: string }> = [];
  for (const name of names) {
    let manifest: { at: string; modules: Partial<Record<Module,{ expected: number; written: number; error?: string }>> };
    try { manifest = JSON.parse(await readFile(join(rawDir,name),'utf8')); }
    catch { throw new Error('Invalid Dakota manifest.'); }
    if (!Number.isFinite(Date.parse(manifest.at)) || !manifest.modules) throw new Error('Invalid Dakota manifest.');
    for (const module of ['account','contact'] as const) {
      const m = manifest.modules[module];
      if (!m || m.error || !Number.isSafeInteger(m.expected) || !Number.isSafeInteger(m.written) || m.expected<0 || m.written<m.expected) continue;
      const file = `${module}/${name.replace('.manifest.json','.jsonl')}`;
      let text: string;
      try { text = await readFile(join(rawDir,file),'utf8'); }
      catch (e) { if (m.written===0 && (e as NodeJS.ErrnoException).code==='ENOENT') text=''; else throw new Error('Dakota replica unavailable.'); }
      const lines = text.split('\n').filter(l=>l.trim());
      if (lines.length!==m.written) throw new Error('Dakota replica count does not match its manifest.');
      let records: RecordFields[];
      try { records=lines.map(l=>neededRecord(module,JSON.parse(l))); }
      catch { throw new Error('Invalid Dakota replica records.'); }
      replicas.push({module,file,hash:createHash('sha256').update(text).digest('hex'),records,at:manifest.at});
    }
  }
  return replicas.sort((a,b)=>a.at.localeCompare(b.at)||a.file.localeCompare(b.file));
}
