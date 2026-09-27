/** W9 export regressions: invented records only, isolated from configured databases. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Check } from './harness';
import type { Candidate } from '../../lib/enrich/candidates';
import type { Touchpoint } from '../../modules/meetings';
import { triageExportRows, writeTriageExport, refreshTriageExport, type TriageExport, type TriagePair } from '../../lib/enrich/triage-export';
import { withDb, type Db } from '../../lib/db';
import { openPglite } from '../../lib/db/pglite';
import { migrate } from '../../lib/db/migrate';

const now = new Date('2026-09-27T00:00:00Z');
const day = (days: number) => new Date(now.getTime() - days * 86_400_000);
const candidate = (key: string): Candidate => ({
  key, name: `Invented Person ${key}`, type: 'person', org: 'Invented Office', role: null, location: null,
  domains: [], enriched: {}, money: null, notes: [], context: [], restrictions: [],
  pursuits: [{ pursuitId: `${key}-a`, vehicle: 'Invented Alpha', status: 'selected', owner: 'Invented Owner',
    rung: null, stageSaid: null, nextStep: null, contact: { meetings: 0, lastTouch: null, lastFromThem: null, awaitingSince: null, nextMeeting: null } }],
  contact: { since: null, earlier: { meetings: 0, first: null, last: null }, meetings: 0, lastTouch: null,
    lastFromThem: null, awaitingSince: null, read: null, lastTouchChannel: null, groupMeetings: 0,
    meetingDates: [], recent: [], outreachShared: 0 },
});
const touch = (id: string, days: number, direction: Touchpoint['direction'] = 'theirs'): Touchpoint => ({
  touchpointId: id, entityId: 'reply', entityName: 'Invented Person', vehicleId: null, vehicleName: null,
  channel: 'email', kind: null, on: day(days), scheduledFor: null, direction, ownerName: 'Invented Owner',
  attendees: ['Invented Colleague'], summary: null, read: null, readByName: null, source: 'affinity',
  sourceRef: `interaction:email:${Number(id.replace(/\D/g, '')) || 1}:person:1`, viaOrganization: null,
  about: 'other', aboutVehicles: [], aboutBasis: 'Generated classification is not a snippet', aboutBy: 'rule', groupSize: 1,
});
const team = [{ handle: 'owner', name: 'Invented Owner' }, { handle: 'colleague', name: 'Invented Colleague' }];
const pairsFor = (cs: Candidate[]): TriagePair[] => cs.flatMap(c => c.pursuits.map(p => ({
  pursuitId: p.pursuitId, vehicle: p.vehicle === 'Invented Alpha' ? 'alpha' : 'beta', owner: p.owner === 'Not on the team' ? null : 'owner',
})));

export async function triageExportProperties(check: Check) {
  const base = join(process.cwd(), 'data', 'demo');
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(join(base, 'props-triage-'));
  const previousDir = process.env.ENRICH_DIR;
  let db: Db | undefined;
  try {
    const reply = candidate('reply');
    reply.pursuits[0]!.status = 'discussing';
    reply.contact.lastFromThem = reply.contact.lastTouch = day(1).toISOString().slice(0, 10);
    reply.contact.lastTouchChannel = 'email';
    const sent = candidate('sent'); sent.pursuits[0]!.stageSaid = 'Contacted';
    const personal = candidate('personal'); personal.contact.awaitingSince = personal.contact.lastTouch = '2026-09-01'; personal.contact.outreachShared = 12;
    const unowned = candidate('unowned'); unowned.enriched['Relationship Tier'] = 'close'; unowned.pursuits[0]!.owner = 'Not on the team';
    const warm = candidate('warm'); warm.enriched['Relationship Tier'] = 'close';
    const senior = candidate('senior'); senior.role = 'Partner'; senior.org = 'Invented Venture Capital';
    const slow = candidate('slow'); slow.org = 'Invented University Endowment';
    const cold = candidate('cold');
    cold.pursuits.push({ ...cold.pursuits[0]!, pursuitId: 'cold-z' });
    const multi = candidate('multi'); multi.pursuits[0]!.status = 'committed';
    multi.pursuits.push({ ...multi.pursuits[0]!, pursuitId: 'multi-b', vehicle: 'Invented Beta', status: 'selected' });
    const excluded = candidate('excluded'); excluded.pursuits[0]!.status = 'passed';
    const cs = [reply, sent, personal, unowned, warm, senior, slow, cold, multi, excluded];
    const records = [touch('t6', 5), touch('t2', 1), touch('t1', 1), touch('t5', 4), touch('t4', 3), touch('t3', 2), touch('t7', 20, 'ours')];
    records.push({ ...touch('future', -1), summary: 'Must not leak future records' }, { ...touch('firm', 0), viaOrganization: 'Invented Firm' });
    const details = new Map([['interaction:email:1', { subject: 'Recorded subject', snippet: 'Stored first line\nStored second line' }]]);
    const touches = new Map([['reply', records]]);
    const rows = await triageExportRows(dir, cs, touches, pairsFor(cs), details, team, now);
    const firsts = new Set(rows.flatMap(r => r.first ? [r.first] : []));
    const lanes = new Set(rows.map(r => r.lane));
    check('TRIAGE every W9 lane and first step exports once per eligible LP × vehicle',
      rows.length === 9 && lanes.size === 4 && firsts.size === 4
      && rows.some(r => r.key === 'multi' && r.vehicle === 'beta') && !rows.some(r => r.key === 'multi' && r.vehicle === 'alpha')
      && rows.find(r => r.key === 'unowned')?.owner === null && rows.find(r => r.key === 'personal')?.massMailing === true
      && rows.every(r => r.lanes.includes(r.lane) && (!r.first || r.lanes.includes(r.first))),
      `${rows.length} eligible pairs; ${lanes.size} lanes; ${firsts.size} first steps; an ineligible first pursuit does not hide its second.`);
    const r = rows.find(r => r.key === 'reply')!;
    const reordered = await triageExportRows(dir, [...cs].reverse().map(c => ({ ...c, pursuits: [...c.pursuits].reverse() })), new Map([['reply', [...records].reverse()]]), [...pairsFor(cs)].reverse(), details, [...team].reverse(), now);
    check('TRIAGE last five recorded touches and row ordering are stable, with uncropped inbound/outbound ages',
      JSON.stringify(rows) === JSON.stringify(reordered) && r.touches.length === 5 && r.touches[0]!.subject === 'Recorded subject'
      && r.touches[0]!.snippet === 'Stored first line Stored second line' && r.touches.slice(1).every(t => t.snippet === null)
      && r.touches.every(t => t.team.join(',') === 'colleague,owner' && t.direction === 'in')
      && r.daysSinceLastInbound === 1 && r.daysSinceLastOutbound === 20,
      'Date ties use record IDs; future/firm records are excluded; missing snippets remain null; the last outbound lies beyond the five displayed touches.');

    const poison = candidate('redacted');
    poison.name = 'Invented Person person@example.org +1 (415) 555-0134';
    poison.role = 'Partner partner@example.org'; poison.org = 'Invented Capital';
    poison.notes = [{ on: '2026-09-01', summary: 'Opened deck: desk@example.org; +44 20 7946 0958', read: null, about: ['general'] }];
    const badTouch = { ...touch('t1', 1), ownerName: 'bad@example.org', attendees: ['+1 (212) 555-0134'] };
    const safe = await triageExportRows(dir, [poison], new Map([[poison.key, [badTouch]]]),
      [{ pursuitId: poison.pursuits[0]!.pursuitId, vehicle: 'alpha', owner: 'bad@example.org' }],
      new Map([['interaction:email:1', { subject: 'To desk@example.org +1 (415) 555-0134', snippet: 'Meet at 400 Harbor Street, Suite 12.' }]]),
      [{ name: 'bad@example.org', handle: 'bad@example.org' }, { name: '+1 (212) 555-0134', handle: '+1 (212) 555-0134' }], now);
    const encoded = JSON.stringify(safe);
    check('TRIAGE text, owner and team fields never export contact addresses or phone numbers',
      !encoded.includes('@') && !/555|7946|Harbor Street/.test(encoded) && safe[0]!.owner === null
      && safe[0]!.touches[0]!.team.length === 0 && safe[0]!.touches[0]!.snippet === '[address redacted]',
      'Invented contacts in names, reasons, titles, snippets and team handles are removed before serialization.');
    await writeTriageExport(dir, rows);
    await writeFile(join(dir, 'candidates.jsonl'), cs.map(c => JSON.stringify(c)).join('\n') + '\n');
    const refreshed = await refreshTriageExport(dir, now);
    check('TRIAGE file-only refresh preserves exported record text and contact context',
      JSON.stringify(refreshed) === JSON.stringify(rows), 'Refreshing the same pinned inputs preserves every touch, owner, vehicle and observation date.');
    await writeTriageExport(dir, await triageExportRows(dir, [excluded], new Map(), pairsFor([excluded]), new Map(), team, now));
    check('TRIAGE empty lanes produce a zero-byte JSONL file', (await readFile(join(dir, 'triage.jsonl'))).length === 0,
      'No placeholder row and no blank JSON record are written.');
    await writeFile(join(dir, 'candidates.jsonl'), '');
    check('TRIAGE empty file-only refresh stays empty', (await refreshTriageExport(dir, now)).length === 0
      && (await readFile(join(dir, 'triage.jsonl'))).length === 0, 'No phantom records appear on rerun.');

    db = await openPglite(join(dir, 'db'));
    await migrate(db);
    const actor = '11111111-1111-4111-8111-111111111111';
    await db.query(`insert into platform.app_user(id,handle,name,initials,role,email) values($1,'owner','Invented Owner','IO','fixture','')`, [actor]);
    await db.exec(`insert into platform.vehicle(slug,name,kind,exemption,raise_opens_on) values
      ('alpha','Invented Alpha','fund','506(c)','2026-01-01'), ('beta','Invented Beta','fund','506(c)','2026-01-01');
      insert into identity.entity(entity_type,display_name) select 'person','Invented Export LP '||n from generate_series(1,500) n;`);
    await db.query(`insert into strategy.pursuit(entity_id,vehicle_id,owner_id,status)
      select e.entity_id,v.id,$1,'selected' from identity.entity e cross join platform.vehicle v`, [actor]);
    await db.query(`insert into meetings.meeting(entity_id,vehicle_id,owner_id,channel,direction,held_on,source,source_ref,summary)
      select e.entity_id,null,$1,'email',case when n%2=0 then 'theirs' else 'ours' end,
        current_date-n,'us','fixture:'||e.entity_id||':'||n,case when n=1 then 'Invented stored record' else null end
      from identity.entity e cross join generate_series(1,10) n`, [actor]);
    const sample = (await db.one<{ id: string }>(`select entity_id::text id from identity.entity order by display_name limit 1`))!.id;
    await db.query(`update meetings.meeting set source='affinity',source_ref='interaction:email:801:person:1',summary=null
      where source_ref=$1`, [`fixture:${sample}:1`]);
    await db.query(`update meetings.meeting set source='affinity',source_ref='interaction:meeting:802:person:1',channel='meeting',direction='both',summary=null
      where source_ref=$1`, [`fixture:${sample}:2`]);
    await db.query(`insert into sources.raw_record(source,kind,source_id,payload_hash,payload,fetched_at) values
      ('affinity','list_entry','invented-entry','email',$1::jsonb,'2026-09-01'),
      ('affinity','meeting','802','old',$2::jsonb,'2026-09-01'),
      ('affinity','meeting','802','new',$3::jsonb,'2026-09-01')`, [
      JSON.stringify({ id: 1, type: 'person', entity: { id: 1, fields: [{ id: 'interaction', name: 'Last Email', type: 'global', value: {
        type: 'interaction', data: { type: 'email', id: 801, subject: 'Recorded email subject', snippet: 'Stored email snippet\nSecond line' },
      } }] } }), JSON.stringify({ title: 'Obsolete meeting title' }), JSON.stringify({ title: 'Recorded meeting title' }),
    ]);
    const { exportResearchSet, researchSet } = await import('../../lib/enrich/candidates');
    process.env.ENRICH_DIR = dir;
    const identities = await db.query<{ id: string; name: string }>('select entity_id::text id, display_name name from identity.entity');
    await mkdir(join(dir, 'raw'));
    await Promise.all(identities.map(identity => writeFile(join(dir, 'raw', `${identity.id}.json`), JSON.stringify({
      key: identity.id, name: identity.name, identity: { match: 'confirmed', basis: 'Invented fixture only.' },
      researched: { at: '2026-09-01T00:00:00Z', by: 'fixture', workflow: 'W1', version: 1 },
      facts: [], profile: { summary: 'Invented public profile.', investorType: 'fo_principal' },
    }))));
    await writeFile(join(dir, 'connections.jsonl'), identities.map(identity => JSON.stringify({
      lp: identity.id, kind: 'other', tier: 'C', basis: 'Invented relationship clue.',
      other: { type: 'backer', name: 'Invented Backer', key: 'invented-backer' },
    })).join('\n'));
    let queries = 0;
    const counted: Db = { ...db, query: async (sql, params) => { queries++; return db!.query(sql, params); },
      one: async (sql, params) => { queries++; return db!.one(sql, params); }, exec: db.exec.bind(db), transaction: db.transaction.bind(db), close: db.close.bind(db) };
    const baselineStart = performance.now();
    await withDb(counted, researchSet);
    const baselineMs = performance.now() - baselineStart, baselineQueries = queries;
    queries = 0;
    const exportStart = performance.now();
    const exported = await withDb(counted, exportResearchSet);
    const exportMs = performance.now() - exportStart, exportQueries = queries;
    const fullRows = (await readFile(join(dir, 'triage.jsonl'), 'utf8')).split('\n').filter(Boolean).map(s => JSON.parse(s) as TriageExport);
    const recorded = fullRows.find(row => row.key === sample)!.touches;
    check('TRIAGE full export joins stored raw subjects, latest meeting titles and optional snippets',
      recorded[0]!.subject === 'Recorded email subject' && recorded[0]!.snippet === 'Stored email snippet Second line'
      && recorded[0]!.channel === 'email' && recorded[0]!.direction === 'out'
      && recorded[1]!.subject === 'Recorded meeting title' && recorded[1]!.snippet === null
      && recorded[1]!.channel === 'meeting' && recorded[1]!.direction === null,
      'Realistic fixture exercises local raw_record joins, same-timestamp revisions and null text without any connector call.');
    check('TRIAGE full export remains bulk and bounded on 500 LPs × two vehicles × ten touches',
      exported.candidates === 500 && fullRows.length === 1000 && fullRows.every(row => row.touches.length === 5)
      && exportQueries <= baselineQueries + 4 && exportMs < 30_000 && exportMs < baselineMs + 5_000,
      `Invented fixture with 500 W1 files and 500 connection records: baseline ${Math.ceil(baselineMs)} ms/${baselineQueries} queries; export ${Math.ceil(exportMs)} ms/${exportQueries} queries. `
      + 'GUESS regression ceilings: 30 s total and 5 s added; these are conservative test limits, not a documented existing deadline.');
  } finally {
    if (previousDir === undefined) delete process.env.ENRICH_DIR; else process.env.ENRICH_DIR = previousDir;
    await db?.close();
    await rm(dir, { recursive: true, force: true });
  }
}
