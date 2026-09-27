/** Read only a stopped, marked preview copy. Counts only; audits every stored candidate. */
import { existsSync, lstatSync } from 'node:fs';
import { getDb } from '../lib/db';
import { scoreRoute, edgeWarmth } from '../modules/network/warmth';
import type { Edge, StructuralRoutes } from '../modules/network/types';
if (process.env.DATA_PROFILE!=='real' || !existsSync('data/real/.preview-copy') || lstatSync('data/real').isSymbolicLink()) throw Error('Use a marked preview copy, never the live DB.');
const db=await getDb();
let cursor='',targets=0,routes=0,changed=0,zeroHopChanged=0,missing=0;
const at=new Date();
for (;;) {
  const rows=await db.query<{id:string;search:{structural?:StructuralRoutes;routes?:unknown[]}}>(`select target_id::text id,search from network.route_cache where target_id::text>$1 order by target_id limit 1`,[cursor]);
  if(!rows.length)break;
  for(const row of rows){targets++; const s=row.search.structural;
    if(!s){missing++;continue;}
    const edges=s.edges.map(e=>({...e} as unknown as Edge));
    const warmth=new Map(edges.map(e=>[e,edgeWarmth(e,at)]));
    for(const p of s.candidates){
      const hops=p.edges.map((i,k)=>({edge:edges[i]!,toName:'',toEntity:s.nodes[p.nodes[k+1]!]!.entityId}));
      const role=s.roles[s.nodes[p.nodes.at(-2)!]?.entityId??''];
      const score=scoreRoute({hops},at,role,e=>warmth.get(e)!);
      const previous=Math.round(Math.max(0,Math.min(100,score.factors.filter(f=>f.key!=='weakestHop').reduce((n,f)=>n+f.points,0)))*100)/100;
      routes++;
      if(previous>score.value+0.011){changed++;if(hops.some(h=>warmth.get(h.edge)!.score===0))zeroHopChanged++;}
    }
  }
  cursor=rows.at(-1)!.id;
}
console.log(JSON.stringify({targets,routes,changed,zeroHopChanged,missingStructural:missing,scope:'Every stored candidate in the copied route cache; unenumerated paths are outside coverage.'}));
await db.close();
