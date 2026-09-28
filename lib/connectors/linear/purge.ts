import { readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { COLUMNS, normalize, readManifests, type Replica, type Row } from './replica';
import { ENTITIES, type Entity } from './queries';
import { scopeReplicas } from './scope';

function rawRow(entity: Entity, row: Row): Record<string, unknown> {
  const raw: Record<string, unknown> = { id: row.id };
  for (const [col,key,kind] of COLUMNS[entity]) {
    if (!(col in row)) continue;
    const value = row[col];
    if (value === null) { raw[key] = null; continue; }
    if (kind === 'ref') raw[key] = {id:value};
    else if (kind === 'refs') raw[key] = {nodes:(value as string[]).map(id => ({id}))};
    else if (kind === 'statusName' || kind === 'statusType') raw[key] = {...(raw[key] as object ?? {}), [kind === 'statusName' ? 'name' : 'type']:value};
    else raw[key] = value;
  }
  return raw;
}

/** No backup containing discarded records is retained. Atomic replacements can be retried after interruption. */
export async function purgeRawReplicas(dir: string, teams: readonly string[]) {
  const replicas: Replica[] = [];
  const staleTemps: string[] = [];
  for (const entity of ENTITIES) {
    let names: string[];
    try { names = await readdir(join(dir,entity)); } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw new Error('Linear replica unavailable.');
    }
    staleTemps.push(...names.filter(n => n.endsWith('.jsonl.filtered')).map(n => join(dir,entity,n)));
    for (const name of names.filter(n => n.endsWith('.jsonl')).sort()) {
      const file = `${entity}/${name}`;
      let records: Row[];
      try { records = (await readFile(join(dir,file),'utf8')).split('\n').filter(l => l.trim()).map(l => normalize(entity,JSON.parse(l))); }
      catch { throw new Error('Invalid Linear replica records; rebuild stopped.'); }
      replicas.push({entity,file,hash:'',at:name,records});
    }
  }
  const filtered = scopeReplicas(replicas,teams);
  let purged = 0, removedFiles = staleTemps.length;
  for (const file of staleTemps) await rm(file);
  const counts = new Map<string, number>();
  for (const [i,r] of filtered.entries()) {
    purged += replicas[i]!.records.length - r.records.length;
    counts.set(r.file,r.records.length);
    if (!r.records.length) { await rm(join(dir,r.file)); removedFiles++; continue; }
    const text = r.records.map(row => JSON.stringify(rawRow(r.entity,row))).join('\n')+'\n';
    const temp = join(dir,`${r.file}.filtered`);
    await writeFile(temp,text,{mode:0o600});
    await rename(temp,join(dir,r.file));
  }
  for (const {name,...manifest} of await readManifests(dir)) {
    const stamp = name.replace('.manifest.json','');
    for (const entity of ENTITIES) {
      const e = manifest.entities[entity];
      if (e) e.written = counts.get(`${entity}/${stamp}.jsonl`) ?? 0;
    }
    // Counts only; historical request/budget counts remain historical.
    const previous = (manifest as typeof manifest & {purge?: {records:number;files:number}}).purge;
    const note = { ...manifest, purge: {records:(previous?.records ?? 0)+purged,files:(previous?.files ?? 0)+removedFiles} };
    await writeFile(join(dir,`${name}.filtered`),JSON.stringify(note,null,1)+'\n',{mode:0o600});
    await rename(join(dir,`${name}.filtered`),join(dir,name));
  }
  return {purged,removedFiles};
}
