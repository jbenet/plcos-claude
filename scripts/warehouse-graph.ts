/** WGRAPH: SELECT-only extraction. Never opens the app database or runs W3. */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { config } from '../config/deployment';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { classifyWarehouseTie, graphKey, matchWarehousePeople, normalizedName, redactWarehouseText,
  addWarehouseNetworkTies, addWarehouseMembershipTies, type WarehouseMembership, addWarehouseFirmTies, warehouseCoverage, type GraphIdentity, type WarehousePerson, type WarehouseTie, type TieEvidence } from '../lib/enrich/warehouse-graph';
import { peopleSql, tieQueries, fundingCoverageSql, sourceCoverageQueries, personOrganizationsSql, coinvestorOrganizationsSql, directoryMembershipSql } from '../lib/enrich/warehouse-sql';

const exec = promisify(execFile);
const ROOT = resolve(process.cwd(), '../plcos-data/real');
const OUT = join(ROOT,'enrich/warehouse');
const PAGE = 10000;
const inputPages: Array<{queryHash:string;hash:string;rows:number;retrievedAt:string}>=[];
type Row = Record<string, unknown>;
const str = (v: unknown) => typeof v === 'string' && v ? v : null;
const yes = (v: unknown) => v === true || v === 'true';
const rows = <T>(s: string): T[] => s.trim() ? s.trim().split('\n').map(l => JSON.parse(l) as T) : [];
async function jsonl(name: string, data: unknown[]) {
  const path = join(OUT,name);
  await writeFile(path+'.tmp',data.map(d=>JSON.stringify(d)).join('\n')+'\n',{mode:0o600});
  await rename(path+'.tmp',path);
}
async function query(sql: string): Promise<Row[]> {
  // All SQL comes from the versioned query module; no arbitrary CLI SQL or identifiers.
  if (!/^\s*(WITH|SELECT)\b/i.test(sql) || /\b(INSERT|UPDATE|DELETE|MERGE|CREATE|DROP|EXPORT|ALTER|TRUNCATE|CALL)\b/i.test(sql)) throw new Error('Only SELECT queries are allowed');
  const out: Row[]=[];
  for (let offset=0;;offset+=PAGE) {
    // bq's display default is 100 rows: set max_rows as well as SQL LIMIT.
    const paged = `SELECT * FROM (${sql}) t ORDER BY TO_JSON_STRING(t) LIMIT ${PAGE} OFFSET ${offset}`;
    const cache = join(OUT,'pages',graphKey(paged)+'.json');
    let page: Row[];
    if (process.argv.includes('--resume')) {
      try { page=JSON.parse(await readFile(cache,'utf8')) as Row[]; }
      catch { page=await fetchPage(paged); await writeFile(cache,JSON.stringify(page),{mode:0o600}); }
    } else { page=await fetchPage(paged); await writeFile(cache,JSON.stringify(page),{mode:0o600}); }
    inputPages.push({queryHash:graphKey(paged),hash:createHash('sha256').update(JSON.stringify(page)).digest('hex'),rows:page.length,retrievedAt:(await stat(cache)).mtime.toISOString()});
    out.push(...page);
    if (page.length<PAGE) break;
    console.log(`Read ${out.length} rows; exact page cap reached, continuing with OFFSET.`);
  }
  return out;
}
async function fetchPage(sql: string): Promise<Row[]> {
  // Existing application-default login; token is passed in the environment, never argv or a file.
  const token=await exec('gcloud',['auth','application-default','print-access-token']);
  try {
    const r=await exec('bq',['--project_id=plrs-data-platform','query','--use_legacy_sql=false','--format=json',
      '--maximum_bytes_billed=10737418240',`--max_rows=${PAGE}`,sql],
    {env:{...process.env,CLOUDSDK_AUTH_ACCESS_TOKEN:token.stdout.trim()},maxBuffer:128*1024*1024});
    return JSON.parse(r.stdout) as Row[];
  } catch (error) {
    // bq can echo SQL and private values. Keep diagnostics under the private output root.
    const e=error as {stdout?:string;stderr?:string};
    await writeFile(join(OUT,'query-error.txt'),(e.stdout??'')+'\n'+(e.stderr??''),{mode:0o600});
    throw new Error('Warehouse SELECT failed; private query-error.txt contains diagnostics.');
  }
}
async function main() {
  if (process.env.DATA_PROFILE!=='real') throw new Error('WGRAPH requires DATA_PROFILE=real');
  await mkdir(join(OUT,'pages'),{recursive:true,mode:0o700});
  const asOf=new Date().toISOString();
  const candidates=rows<GraphIdentity>(await readFile(join(ROOT,'enrich/candidates.jsonl'),'utf8'))
    .map(({key,name,org,domains})=>({key,name,org,domains}));
  const team=(JSON.parse(await readFile(join(ROOT,'enrich/us/team.json'),'utf8')) as {team:{handle:string;name:string}[]}).team;
  const aliases=JSON.parse(await readFile(join(ROOT,'enrich/team.json'),'utf8')) as {handle:string;name:string}[];
  await writeFile(join(OUT,'inputs.json'),JSON.stringify({candidates,team,aliases}),{mode:0o600});
  const sourceCoverage: Record<string,Row[]>={};
  for (const [name,sql] of Object.entries(sourceCoverageQueries)) sourceCoverage[name]=await query(sql);
  const fundingCoverage=await query(fundingCoverageSql);
  const sourceRows=await query(peopleSql);
  const organizations=new Map((await query(personOrganizationsSql)).map(r=>[String(r.dw_member_id),r]));
  for (const r of sourceRows) {
    const extra=organizations.get(String(r.member_id));
    if (!str(r.org) && extra) r.org=extra.org;
    if (!str(r.role) && extra) r.role=extra.role;
  }
  const allPeople: WarehousePerson[]=sourceRows.map(r=>({key:String(r.key), name:redactWarehouseText(String(r.name)),org:str(r.org) ? redactWarehouseText(String(r.org)) : null,emailDomain:str(r.email_domain),
    roles:[str(r.role) ? redactWarehouseText(String(r.role)) : null,yes(r.founder)?'founder':null,yes(r.staff)?'PL team':null,yes(r.investor)?'investor':null].filter((r):r is string=>!!r),
    warehouseIds:Object.fromEntries([['dw_member_id',str(r.member_id)],[r.member_id ? 'labos_member_uid' : 'demo_day_member_uid',str(r.labos_member_uid)]].filter((e):e is [string,string]=>!!e[1])),
    oneHop:yes(r.founder)||yes(r.staff),source:String(r.source)+(r.member_id?'+prod_records.companies':''),
    as_of:asOf,confidence:'warehouse record; not human verified',last_verified_by:'warehouse-graph deterministic SELECT'}));
  for (const r of await query(coinvestorOrganizationsSql)) allPeople.push({key:String(r.key),name:redactWarehouseText(String(r.name)),
    org:null,emailDomain:null,roles:['co-investor'],nodeType:'organization',warehouseIds:{},
    source:'prod_lists.pl_portfolio_coinvestors',as_of:asOf,confidence:'firm attribution; not a personal decision',last_verified_by:'warehouse-graph deterministic SELECT'});
  for (const t of team) {
    const names=[t.name,...aliases.filter(a=>a.handle===t.handle).map(a=>a.name)].map(normalizedName);
    const matches=allPeople.filter(p=>names.includes(normalizedName(p.name)));
    if (matches.length===1) matches[0]!.teamKey=t.handle;
    else allPeople.push({key:`team:${t.handle}`,name:t.name,org:null,emailDomain:null,roles:['our team'],warehouseIds:{},teamKey:t.handle,
      source:'enrich/us/team.json',as_of:asOf,confidence:'local team record',last_verified_by:'local team file'});
  }
  const ties: WarehouseTie[]=[];
  for(const [label,sql] of Object.entries(tieQueries)) {
    const result=await query(sql);
    for(const r of result) {
      const classification=classifyWarehouseTie(String(r.evidence) as TieEvidence,Number(r.count));
      ties.push({key:graphKey([r.a,r.b,r.evidence,r.source].join('|')),from:String(r.a),to:String(r.b),...classification,...(r.evidence==='portfolio'?{basis:'firm_attribution' as const}:{}),
        firstSeen:str(r.first_seen),lastSeen:str(r.last_seen),source:String(r.source)+(r.member_id?'+prod_records.companies':''),rowIds:r.row_ids as string[],count:Number(r.count)});
    }
    console.log(`${label}: ${result.length} pairwise ties`);
  }
  const matches=matchWarehousePeople(candidates,allPeople);
  for (const tie of addWarehouseNetworkTies(allPeople,asOf)) ties.push(tie);
  const memberships=(await query(directoryMembershipSql)).map(r=>({personKey:String(r.person_key),source:String(r.source) as WarehouseMembership['source'],rowId:String(r.row_id)}));
  for (const tie of addWarehouseMembershipTies(allPeople,memberships)) ties.push(tie);
  for (const tie of addWarehouseFirmTies(candidates,matches,allPeople,ties)) ties.push(tie);
  const touched=new Set([...ties.flatMap(t=>[t.from,t.to]),...matches.map(m=>m.personKey)]);
  // Directory founders/staff and investors are useful starting nodes even without a pairwise observation.
  const people=allPeople.filter(p=>touched.has(p.key)||p.teamKey||p.oneHop||p.roles.includes('investor'));
  const keys=new Set(people.map(p=>p.key));
  if(ties.some(t=>!keys.has(t.from)||!keys.has(t.to))) throw new Error('Dangling warehouse tie');
  if(keys.size!==people.length) throw new Error('Duplicate warehouse person key');
  if (/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i.test(JSON.stringify([people,ties,matches]))) throw new Error('Graph output contains an address; refusing publication');
  await jsonl('people.jsonl',people.sort((a,b)=>a.key.localeCompare(b.key)));
  await jsonl('ties.jsonl',ties.sort((a,b)=>a.key.localeCompare(b.key)));
  await jsonl('matches.jsonl',matches.sort((a,b)=>a.lpKey.localeCompare(b.lpKey)||a.personKey.localeCompare(b.personKey)));
  const files=Object.fromEntries(await Promise.all(['people.jsonl','ties.jsonl','matches.jsonl'].map(async name=>[name,createHash('sha256').update(await readFile(join(OUT,name))).digest('hex')])));
  await writeFile(join(OUT,'graph-manifest.json.tmp'),JSON.stringify({asOf,files,inputPages}),{mode:0o600});
  await rename(join(OUT,'graph-manifest.json.tmp'),join(OUT,'graph-manifest.json'));
  const countBy=(field:'kind'|'tier')=>Object.fromEntries([...new Set(ties.map(t=>t[field]))].sort().map(k=>[k,ties.filter(t=>t[field]===k).length]));
  const confident=new Set(matches.filter(m=>m.status==='confident').map(m=>m.lpKey));
  const ambiguous=new Set(matches.filter(m=>m.status==='ambiguous'&&!confident.has(m.lpKey)).map(m=>m.lpKey));
  const summary={asOf,sourceSnapshotWindow:{first:inputPages.map(p=>p.retrievedAt).sort()[0],last:inputPages.map(p=>p.retrievedAt).sort().at(-1)},sourceCoverage,fundingCoverage,resolvedConfig:{page:PAGE,maximumBytesBilled:10737418240,repeatedContacts:config.routeWarmth.repeatedContacts,frequentDeals:config.routeWarmth.frequentDeals},people:people.length,ties:ties.length,byKind:countBy('kind'),byTier:countBy('tier'),
    connectivity:warehouseCoverage(people,ties,matches),lps:candidates.length,confident:confident.size,ambiguous:ambiguous.size,unmatched:candidates.length-confident.size-ambiguous.size,
    tables:[...new Set((peopleSql+fundingCoverageSql+personOrganizationsSql+coinvestorOrganizationsSql+directoryMembershipSql+Object.values(tieQueries).join('\n')).match(/prod_(records|lists)\.[a-z_]+/g))],
    coverage:'All source dates through extraction time; unknown dates remain null. Campaigns excluded. Calendar guests are proximity. Demo views and company actions do not prove personal contact. Firm-attributed investments remain tier C. PL directory membership and investor-list rows establish ties to the PL organization. Named team policy ties are reserved for founders and team members. Deal dates and rounds are unknown.'};
  await writeFile(join(OUT,'summary.json'),JSON.stringify(summary,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify(summary,null,2));
}
main().catch(e=>{console.error(e instanceof Error?e.message:'Warehouse graph failed');process.exitCode=1;});
