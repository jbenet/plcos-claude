import { readdir,stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pagesOnly as isPagesOnly,partialSearch,type Finding } from './schema';
import type { Triage } from './triage';
import type { ConnectorPlan } from './connectors';
import { readQuality } from './quality';
async function fileInfo(path: string): Promise<{ at: Date; lines: number } | null> {
  try {
    const s = await stat(path);
    const { readFile } = await import('node:fs/promises');
    const lines = (await readFile(path, 'utf8')).split('\n').filter(Boolean).length;
    return { at: s.mtime, lines };
  } catch { return null; }
}

async function count(dir: string): Promise<number> {
  try { return (await readdir(dir)).filter((f) => f.endsWith('.json')).length; } catch { return 0; }
}

/** Findings still owed a pass with search (v1.6): from page reads alone, or with too few searches. */
async function pagesOnly(dir: string): Promise<{ pages: number; partial: number }> {
  const { readFile } = await import('node:fs/promises');
  let pages = 0, partial = 0;
  const files=(await readdir(dir).catch(()=>[])).filter(x=>x.endsWith('.json'));
  // Bounded concurrent local reads: a large findings folder must not serialize every file.
  for(let offset=0;offset<files.length;offset+=32) {
    const batch=await Promise.allSettled(files.slice(offset,offset+32).map(async f=>JSON.parse(await readFile(join(dir,f),'utf8')) as Finding));
    for(const result of batch) if(result.status==='fulfilled') {
      if(isPagesOnly(result.value)) pages++;
      if(partialSearch(result.value)) partial++;
    }
  }
  return { pages, partial };
}

/** File parsing lives in a worker; the request receives only page inputs and compact counts. */
export async function enrichmentFileSummary(dir:string) {
  const {readFile}=await import('node:fs/promises');
  const triage=(await readFile(join(dir,'triage.jsonl'),'utf8').catch(()=>'')).split('\n').filter(Boolean).map(l=>JSON.parse(l) as Triage);
  const plans=JSON.parse(await readFile(join(dir,'connectors.json'),'utf8').catch(()=>'[]')) as ConnectorPlan[];
  const quality=await readQuality(dir);
  const [set,cands,raw,pages,strategies]=await Promise.all([
    fileInfo(join(dir,'research-set.jsonl')),fileInfo(join(dir,'candidates.jsonl')),
    count(join(dir,'raw')),pagesOnly(join(dir,'raw')),count(join(dir,'strategy')),
  ]);
  return {triage,plans,quality,set,cands,raw,pages,strategies};
}
