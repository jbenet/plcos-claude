/** Rule 6 regression cases: invented people and organizations only. */
import type { Queryable } from '../lib/db';
import type { Candidate } from '../lib/enrich/candidates';
import type { Finding } from '../lib/enrich/schema';
import { connectionPaths, type TeamMember, type PlDirectoryEntry } from '../lib/enrich/connect';
import { materializeResearchNodes } from '../lib/enrich/pl-network';
import { resolveConnectionPeople } from '../lib/enrich/connection-people';
import { buildNetwork, planRoutes, edgeWarmth, foldRoutes, type Route } from '../modules/network';

export async function plRuleProperties(db: Queryable, check: (name: string, ok: boolean, detail: string) => void) {
  const before = new Set((await db.query<{ id: string }>('select entity_id::text as id from identity.entity')).map((r) => r.id));
  const userIds: string[] = [];
  const keys: string[] = [];
  const team: TeamMember[] = [{ handle: 'plrule-iris', name: 'Iris Vale', roles: [{ org: 'Protocol Labs' }], prior: [], education: [] },
    { handle: 'plrule-noel', name: 'Noel Grove', roles: [], prior: [{ org: 'Protocol Labs' }], education: [] }];
  try {
    for (const t of team) userIds.push((await db.one<{ id: string }>(`insert into platform.app_user (handle,name,initials,role,email) values ($1,$2,'IV','test','fixture@example.org') returning id::text`, [t.handle,t.name]))!.id);
    for (const name of ['Tessa Elm', 'Rory Ash', 'Linden Works', 'Cora Reed']) keys.push((await db.one<{ id: string }>(`insert into identity.entity (entity_type,display_name) values ($1::identity.entity_type,$2) returning entity_id::text as id`, [name === 'Linden Works' ? 'org' : 'person',name]))!.id);
    const person = (key: string, name: string): Candidate => ({ key, name, type: 'person', org: null, role: null, location: null, domains: [], enriched: {}, pursuits: [], notes: [], context: [], money: null, restrictions: [],
      contact: { since: null, earlier: { meetings: 0, first: null, last: null }, meetings: 0, lastTouch: null, lastFromThem: null, awaitingSince: null, read: null, lastTouchChannel: null, groupMeetings: 0, meetingDates: [], recent: [], outreachShared: 0 } });
    const target = person(keys[0]!, 'Tessa Elm'), colleague = person(keys[1]!, 'Rory Ash'), member = person(keys[3]!, 'Cora Reed');
    const finding = (p: Candidate): Finding => ({ key: p.key, name: p.name, researched: { at: '2026-09-26', by: 'fixture', workflow: 'W1', version: '1' }, identity: { match: 'confirmed', basis: 'Invented record' }, facts: [] });
    const f: Finding = { ...finding(colleague), facts: [{ field: 'prior_role', value: 'Worked at Protocol Labs', confidence: 'high', source: { kind: 'primary', url: 'https://example.org/career' } }] };
    const findings = new Map([[colleague.key, f], [target.key, { ...finding(target), connections: [{ to: colleague.name, kind: 'board' as const, tier: 'C' as const, basis: 'Shared board; direct interaction not recorded.', source: 'https://example.org/board' }] }]]);
    const directory: PlDirectoryEntry[] = [{ key: member.key, name: member.name, members: [{ match: 'confirmed', why: 'Invented directory match', investor: false, since: null, roles: [], investorProfile: null, events: [] }], firmTeams: [] }];
    const network = { orgs: [{ name: 'Protocol Labs', aliases: ['Protocol Labs'] }], backers: [], backer_people: [] };
    const paths = connectionPaths([target, colleague, member], findings, network, team, directory).paths;
    const staffTies = paths.filter((p) => p.lp === colleague.key && p.other.type === 'team' && p.tie?.basis === 'pl_affiliation');
    check('PLRULE current and former PL colleagues are warm without meetings, emails or dated overlap',
      new Set(staffTies.map((p) => p.other.handle)).size === 2 && staffTies.every((p) => p.tier === 'B' && p.tie?.kind === 'worked_together' && !p.tie.lastInteraction && p.warmth!.score >= 3),
      'Affiliation policy is labelled; no contact date is fabricated.');
    const unrelated = connectionPaths([target, colleague], new Map([[colleague.key, { ...f, facts: [{ ...f.facts[0]!, value: 'Worked at Linden Works' }] }]]), network, team).paths;
    check('PLRULE another employer and ambiguous public identity cannot fabricate PL affiliation',
      !unrelated.some((p) => p.lp === colleague.key && p.tie?.basis === 'pl_affiliation')
        && !connectionPaths([colleague], new Map([[colleague.key, { ...f, identity: { match: 'ambiguous', basis: 'Namesake' } }]]), network, team).paths.some((p) => p.tie?.basis === 'pl_affiliation'),
      'No human review gate is substituted for evidence; uncertain identities remain labelled.');
    const mentions = materializeResearchNodes(['https://example.org/one', 'https://example.org/two'].map((source) => ({
      lp: target.key, other: { type: 'backer' as const, name: 'Linden Works' }, kind: 'other' as const, tier: 'C' as const, basis: 'Invented firm reference', source,
    })), [target], network, team);
    check('PLRULE the same research node has one identity across different source pages',
      mentions[0]!.other.key === mentions[1]!.other.key && mentions[0]!.source !== mentions[1]!.source,
      'The node stays stable; independent evidence retains its own provenance.');
    const personal = connectionPaths([member], new Map([[member.key, { ...finding(member), connections: [{
      to: team[0]!.name, kind: 'other', tier: 'B', basis: 'First-hand team statement: a personal angel investor in Protocol Labs.', source: null,
    }] }]]), network, team).paths;
    check('PLRULE a first-hand backing statement retains a route without inventing a warm personal relationship',
      personal.some((p) => p.lp === member.key && p.other.handle === team[0]!.handle && p.tier === 'C' && p.warmth!.score >= 3)
        && personal.some((p) => p.lp === member.key && p.other.name === 'PL' && p.tier === 'C'),
      '0070: the policy affiliation remains routable; missing personal relationship evidence is grade C.');
    const resolved = await resolveConnectionPeople(db, paths);
    for (const lp of new Set(resolved.map((p) => p.lp))) await db.query(`insert into research.note (entity_id,kind,body,data) values ($1,'connection_candidates','Invented PL rule fixture',$2)`, [lp,JSON.stringify({ paths: resolved.filter((p) => p.lp === lp) })]);
    await buildNetwork();
    const result = await planRoutes(team[0]!.handle, target.key, 3, 'fund', 'team');
    const routes = result!.routes;
    check('PLRULE a recorded PL colleague starts their own route without redundant team prefixes',
      routes.some(r => r.fromEntity === colleague.key && r.hops.length === 1 && r.verdict === 'recommend')
      && routes.every(r => !r.connectorIds.includes(colleague.key)),
      '0084: PL employment is source evidence, including staff without an app login.');
    const memberRoutes = await planRoutes(team[0]!.handle, member.key, 3, 'fund', 'team');
    check('PLRULE directory membership routes from PL with grade C when no named holder is recorded',
      Boolean(memberRoutes?.routes.some((r) => r.fromName === 'PL' && r.hops.length === 1 && r.weakestTier === 'C' && edgeWarmth(r.hops[0]!.edge).score >= 3)),
      'A sourced network affiliation is enough; no contact record is required.');
    const signature = (r: Route) => `${r.fromEntity}:${r.hops.map((h) => h.edge.edgeId).join('/')}`;
    await db.query(`update network.edge set reviewed_by = $1, reviewed_at = now() where from_entity = $2 or to_entity = $2`, [userIds[0],target.key]);
    const reviewed = (await planRoutes(team[0]!.handle, target.key, 3, 'fund', 'team'))!.routes;
    check('PLRULE human review changes neither route eligibility, rank nor folding',
      JSON.stringify(routes.map(signature)) === JSON.stringify(reviewed.map(signature)) && JSON.stringify(routes.map((r) => r.foldedUnder)) === JSON.stringify(reviewed.map((r) => r.foldedUnder)),
      'Evidence tier and warmth order information, independent of review metadata.');
    await db.query(`update network.edge set tier = 'C', reviewed_by = $1, reviewed_at = now() where (from_entity = $2 or to_entity = $2) and tier = 'B'`, [userIds[0],colleague.key]);
    await buildNetwork();
    const refreshed = (await planRoutes(team[0]!.handle, colleague.key))!.routes;
    check('PLRULE a prior human confirmation cannot freeze an obsolete modelled tier',
      refreshed.some((r) => r.hops.length === 1 && r.weakestTier === 'B' && r.hops[0]!.edge.reviewedByName === team[0]!.name),
      'Rebuilding restores the affiliation-derived B tie and retains review provenance.');
    const own = routes.find((r) => r.fromEntity === colleague.key)!;
    const direct: Route = { ...own, fromEntity: 'invented-fold-source', hops: [{ ...own.hops[0]!, toEntity: colleague.key, edge: { ...own.hops[0]!.edge, edgeId: 'invented-fold-prefix', tier: 'B', evidence: [{ note: 'Invented working tie', tie: { kind: 'worked_together', basis: 'pl_affiliation' } }] } }, ...own.hops] };
    const prefix = direct.hops[0]!;
    const detour: Route = { ...direct, hops: [{ ...prefix, toEntity: 'detour', edge: { ...prefix.edge, edgeId: 'invented-prefix', tier: 'C' } }, { ...prefix, edge: { ...prefix.edge, edgeId: 'invented-return', tier: 'C' } }, direct.hops[1]!] };
    check('PLRULE a warm B prefix folds weaker detours even with a shared C suffix and unknown contact date',
      foldRoutes([direct, detour])[1]?.foldedUnder === 0 && foldRoutes([direct, { ...detour, fromEntity: 'another-source' }])[1]?.foldedUnder === null,
      'Same source, exact suffix, evidence strength and warmth; no review or date-presence gate.');
    await db.query(`insert into coordination.restriction (entity_id,scope,instruction) values ($1,'blanket','Invented do-not-approach instruction')`, [target.key]);
    check('PLRULE target restrictions still exclude every team and PL path',
      (await planRoutes(team[0]!.handle, target.key, 3, 'fund', 'team'))!.routes.every((r) => r.verdict === 'excluded'),
      'Information uncertainty changes no action approval or non-circumvention rule.');
  } finally {
    const added = (await db.query<{ id: string }>('select entity_id::text as id from identity.entity')).map((r) => r.id).filter((id) => !before.has(id));
    await db.query('delete from coordination.restriction where entity_id = any($1::uuid[])', [added]);
    await db.query('delete from network.edge where from_entity = any($1::uuid[]) or to_entity = any($1::uuid[])', [added]);
    await db.query('delete from research.note where entity_id = any($1::uuid[])', [added]);
    await db.query('delete from identity.source_record where entity_id = any($1::uuid[])', [added]);
    await db.query('delete from identity.entity where entity_id = any($1::uuid[])', [added]);
    await db.query('delete from platform.app_user where id = any($1::uuid[])', [userIds]);
  }
}
