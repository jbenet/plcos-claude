/** Invented identities only. A roster correction must not merge namesakes or alter source facts. */
import { randomUUID } from 'node:crypto';
import type { Check, Db } from './properties/harness';
import { syncTeamRoster, teamLabels, teamLabelProjector } from '../modules/identity/team';
import { listMeetings, touchpointsFor, touchpointsByEntity } from '../modules/meetings/repo';
import { resolveIdentities, undoIdentityMerge } from '../modules/identity/resolution';
import { identityEvidence } from '../modules/identity/resolution-input';

export async function teamIdentityProperties(check: Check, db: Db) {
  const profile = 'https://example.org/person/invented-roster-full';
  const profileInput = { warehouse: {people:[{key:`coinvestor:${profile}`,name:'Invented Roster Full',org:null,emailDomain:null,
    roles:[],warehouseIds:{},source:'invented',as_of:'2026-09-20',confidence:'high',last_verified_by:'fixture'}],ties:[],matches:[]},
    candidates:[],team:[{handle:'invented',name:'Invented Roster Full',roles:[{org:'Invented Firm',source:profile}],prior:[],education:[]}],
    graph:[],direct:[],findings:[] };
  check('TEAMIDENT roster profile URL explicitly links a sourced person to one account',
    identityEvidence(profileInput).some(e => e.sourceId===`coinvestor:${profile}` && e.teamReferences?.[0]==='app_user:invented')
    && !identityEvidence({...profileInput,team:[{...profileInput.team[0]!,name:'Different Person'}]}).some(e => e.teamReferences?.length),
    'A unique person-profile URL and full roster name are required; a name alone never links an account.');
  const suffix = randomUUID(), handle = `invented-team-${suffix}`;
  const user = randomUUID(), staff = randomUUID(), warehouse = randomUUID(), namesake = randomUUID(), outsideA = randomUUID(), outsideB = randomUUID(), correctionAlias = randomUUID();
  const source = `invented-roster:${suffix}`;
  const root = async (id: string) => (await db.one<{ id: string }>('select identity.canonical_entity_id($1::uuid)::text id', [id]))!.id;
  try {
    await db.query(`insert into platform.app_user(id,handle,name,initials,role,email)
      values($1,$2,'Invented R.','IR','fixture','invented.roster@example.org')`, [user, handle]);
    for (const [id, name] of [[staff, 'Invented R.'], [warehouse, 'Invented Roster Full'], [namesake, 'Invented Roster Full'], [outsideA, 'Invented Roster Full'], [outsideB, 'Invented Roster Full'], [correctionAlias, 'Invented Legacy Alias']]) {
      await db.query("insert into identity.entity(entity_id,entity_type,display_name) values($1,'person',$2)", [id, name]);
    }
    await db.query(`insert into identity.source_record(source,source_id,entity_id,resolved_by)
      values('app_user',$1,$2,'invented-fixture'),('warehouse',$3,$4,'invented-fixture'),('prospect',$5,$6,'invented-fixture')`,
    [handle, staff, source, warehouse, `namesake:${suffix}`, namesake]);
    await db.query(`insert into identity.source_record(source,source_id,entity_id,resolved_by)
      values('warehouse',$1,$2,'invented-fixture'),('prospect',$3,$4,'invented-fixture')`,
      [`outside-a:${suffix}`,outsideA,`outside-b:${suffix}`,outsideB]);
    const [left,right] = [outsideA,outsideB].sort();
    await db.query(`insert into identity.possible_match(left_entity,right_entity,confidence,signals)
      values($1,$2,0.25,'{"rule":"name_only"}')`,[left,right]);
    const outsideEvidence = [
      {source:'warehouse',sourceId:`outside-a:${suffix}`,organizations:['Invented Shared Company']},
      {source:'prospect',sourceId:`outside-b:${suffix}`,organizations:['Invented Shared Company']},
    ];
    const scoped = (evidence: import('../modules/identity/resolution').IdentityEvidence[]) => resolveIdentities(db,
      [...evidence,...outsideEvidence],undefined,{teamHandles:[handle],names:['Invented Roster Full']});
    await db.query('update identity.entity set merged_into=$1 where entity_id=$2',[staff,correctionAlias]);
    await db.query(`insert into identity.source_record(source,source_id,entity_id,resolved_by)
      values('invented_legacy',$1,$2,'invented-fixture')`,[`correction:${suffix}`,correctionAlias]);
    const roster = [{ handle, name: 'Invented Roster Full' }];
    const first = await db.transaction(q => syncTeamRoster(q, roster));
    const second = await db.transaction(q => syncTeamRoster(q, roster));
    const audit = await db.query<{ detail: { previousName: string } }>("select detail from platform.audit_log where subject_id=$1 and action='identity.team_roster_updated'", [user]);
    check('TEAMIDENT roster handle corrects both account and graph display with one replay-safe audit',
      first === 1 && second === 0 && audit.length === 1 && audit[0]?.detail.previousName === 'Invented R.'
      && (await db.one<{ name: string }>('select name from platform.app_user where id=$1', [user]))?.name === roster[0]!.name,
      'Explicit handle; original display retained in audit; unchanged replay writes nothing.');
    // Restore a different spelling to prove the explicit source handle, not name equality, merges.
    await db.query("update identity.entity set display_name='Invented alternate spelling' where entity_id=$1", [staff]);
    const evidence = [{ source: 'warehouse', sourceId: source, teamReferences: [`app_user:${handle}`] }];
    const result = await scoped(evidence);
    check('TEAMIDENT explicit team handle resolves different names without merging a namesake',
      await root(staff) === warehouse && await root(namesake) === namesake && (result.mergesByRule.team_handle ?? 0) === 1,
      'Only the explicit source mapping links identities; a matching full name is insufficient.');
    const project = await teamLabels(db);
    check('TEAMIDENT calendar projects historical owner, roster and canonical attendee labels once',
      JSON.stringify(project(['Invented R.', 'Invented Roster Full', 'Invented alternate spelling'])) === JSON.stringify(['Invented Roster Full']),
      'One team label, backed by handle audit and canonical identity aliases.');
    const meeting = (await db.one<{ id: string }>(`insert into meetings.meeting(entity_id,owner_id,kind,held_on,attendees,source)
      values($1,$2,'intro',current_date,$3,'us') returning meeting_id::text id`, [warehouse, user, ['Invented R.', 'Invented Roster Full']]))!.id;
    const meetingReads = [
      (await listMeetings()).find(m => m.meetingId === meeting),
      (await touchpointsFor(warehouse, null)).find(m => m.touchpointId === meeting),
      (await touchpointsByEntity([warehouse])).get(warehouse)?.find(m => m.touchpointId === meeting),
    ];
    const stored = await db.one<{ attendees: string[] }>('select attendees from meetings.meeting where meeting_id=$1', [meeting]);
    check('TEAMIDENT meetings and touchpoints share canonical team display without rewriting source attendees',
      meetingReads.every(m => m?.ownerName === 'Invented Roster Full' && JSON.stringify(m.attendees) === JSON.stringify(['Invented Roster Full']))
      && stored?.attendees.length === 2,
      'Read projections agree and the original attendee array remains intact.');
    let labelReads = 0;
    const observed = {
      query: async <T>(sql: string, params?: unknown[]) => { if (sql.startsWith('with recursive team')) labelReads++; return db.query<T>(sql, params); },
      one: db.one.bind(db), exec: db.exec.bind(db),
    };
    await teamLabels(observed); await teamLabels(observed);
    const sharedRead = labelReads === 1;
    await db.query("update platform.app_user set name='Invented Revised Display' where id=$1", [user]);
    const revised = await teamLabels(observed);
    check('TEAMIDENT cached labels share reads and refresh when the team display changes',
      sharedRead && labelReads === 2 && revised(['Invented R.'])[0] === 'Invented Revised Display',
      'One alias read per identity revision; account and merge triggers invalidate cached projection.');
    await db.query("update platform.app_user set name='Invented Roster Full' where id=$1", [user]);
    const replay = await scoped(evidence);
    check('TEAMIDENT identity replay creates no new merge', replay.merges === 0, 'Stable source records and canonical IDs.');
    const assertion = (await db.one<{ id: string }>('select assertion_id::text id from identity.match_assertion where merged_entity=$1 and undone_at is null', [staff]))!;
    await undoIdentityMerge(db, assertion.id, 'Invented correction');
    await scoped(evidence);
    check('TEAMIDENT explicit team linkage respects an undone merge', await root(staff) === staff, 'Correction survives the next pass.');
    await db.query(`insert into identity.match_assertion(kind,left_source,left_source_id,right_source,right_source_id,note)
      values('not_same_as','invented_legacy',$1,'prospect',$2,'Invented namesake correction')`, [`correction:${suffix}`, `namesake:${suffix}`]);
    await scoped([{ source: 'prospect', sourceId: `namesake:${suffix}`, teamReferences: [`app_user:${handle}`] }]);
    check('TEAMIDENT explicit team linkage respects not_same_as', await root(namesake) === namesake && await root(staff) === staff, 'Negative assertions on a differently named component alias constrain explicit mappings.');
    const untouched = await db.one<{active:boolean}>('select active from identity.possible_match where left_entity=$1 and right_entity=$2',[left,right]);
    check('TEAMIDENT roster-scoped repair neither merges unrelated identities nor deactivates their possible match',
      await root(outsideA) === outsideA && await root(outsideB) === outsideB && untouched?.active === true,
      'An unrelated corroborated pair and existing possible match remain outside the repair.');
    const ambiguous = teamLabelProjector([{ id: 'one', name: 'Invented One', alias: 'Invented' }, { id: 'two', name: 'Invented Two', alias: 'Invented' }]);
    check('TEAMIDENT ambiguous historical labels remain unresolved', ambiguous(['Invented'])[0] === 'Invented', 'No prefix, first-name or namesake guessing.');
  } finally {
    await db.query('delete from meetings.meeting where owner_id=$1', [user]);
    await db.query('delete from identity.possible_match where left_entity=any($1::uuid[]) or right_entity=any($1::uuid[])', [[staff, warehouse, namesake, outsideA, outsideB, correctionAlias]]);
    await db.query('delete from identity.match_assertion where left_source_id=any($1::text[]) or right_source_id=any($1::text[])', [[handle, source, `namesake:${suffix}`, `outside-a:${suffix}`, `outside-b:${suffix}`, `correction:${suffix}`]]);
    await db.query('delete from identity.source_record where entity_id=any($1::uuid[])', [[staff, warehouse, namesake, outsideA, outsideB, correctionAlias]]);
    await db.query('update identity.entity set merged_into=null where entity_id=any($1::uuid[])', [[staff, warehouse, namesake, outsideA, outsideB, correctionAlias]]);
    await db.query('delete from identity.entity where entity_id=any($1::uuid[])', [[staff, warehouse, namesake, outsideA, outsideB, correctionAlias]]);
    await db.query('delete from platform.audit_log where subject_id=$1', [user]);
    await db.query('delete from platform.app_user where id=$1', [user]);
  }
}
