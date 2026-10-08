import { connectionsV2Properties } from './network';
import type { AffinityContext } from './affinity-fixtures';

export async function reconciliationProperties(ctx: AffinityContext & { n: (sql: string, params?: unknown[]) => Promise<number>; nadia: { pursuit_id: string } | null; juanId: string; ent: { entity_id: string; vehicle_id: string }; tr: typeof import('../../lib/connectors/affinity/translate'); file: string }) {
  const { check, adb, attempt } = ctx;
  const { n, nadia, juanId, tr, file } = ctx;
  const rc = await import('../../lib/reconcile');
  const sg = await import('../../modules/strategy');
  const pf = await import('../../modules/platform');
  const sys = await rc.systemActor();
  const canBecome = await pf.getUserByHandle('reconciliation');
  // Issue 0137 (Juan, 8 Oct 2026): the conversation rungs are recorded by Reconciliation itself, on the record behind
  // each, never for a portfolio company of ours; above them it still proposes, and a person can take a rung back.
  const portfolioCo = await adb.one<{ pursuit_id: string; entity_id: string; vehicle_id: string }>(
    `select p.pursuit_id::text, p.entity_id::text, p.vehicle_id::text from strategy.pursuit p join platform.vehicle v on v.id = p.vehicle_id
      where v.phase <> 'historical' and p.pursuit_id <> $1 and not exists (select 1 from strategy.ladder_event l where l.pursuit_id = p.pursuit_id)
      order by p.opened_at limit 1`, [nadia!.pursuit_id]);
  if (portfolioCo) {
    await adb.query(`insert into network.portfolio (portfolio_id, vehicle_id, company_entity, company_name, source, input_hash)
      values ('invented-0137', $1, $2, 'Invented portfolio company', '{"invented": true}'::jsonb, 'invented')`, [portfolioCo.vehicle_id, portfolioCo.entity_id]);
  }
  const ladder0 = await n(`select count(*)::text as n from strategy.ladder_event`);
  const first = await rc.reconcile(null);
  const ladder1 = await n(`select count(*)::text as n from strategy.ladder_event`);
  const mineNew = await adb.query<{ pursuit_id: string; rung: string; evidence_ref: string; evidence_kind: string; ticket_id: string | null; recorded_by: string; evidence_note: string }>(
    `select pursuit_id::text, rung::text, evidence_ref, evidence_kind, ticket_id::text, recorded_by::text, evidence_note from strategy.ladder_event where recorded_by = $1`, [sys]);
  // Every "Meeting held" it records rests on a meeting that happened, with this LP themselves.
  const heldFor = async (pursuitId: string) => n(
    `select count(*)::text as n from meetings.meeting t join strategy.pursuit p on p.entity_id = t.entity_id
              where p.pursuit_id = $1 and t.channel in ('meeting', 'call') and t.held_on <= current_date`, [pursuitId]);
  let unbacked = 0;
  for (const r of mineNew) {
    if (r.ticket_id || !/^(affinity:|us:|touchpoint:)/.test(r.evidence_ref) || !sg.ON_RECORD_RUNGS.includes(r.rung as never)
      || !r.evidence_note.endsWith(sg.ON_RECORD_NOTE)) unbacked++;
    if (r.rung === 'meeting_held' && (await heldFor(r.pursuit_id)) === 0) unbacked++;
  }
  const portfolioRungs = portfolioCo ? await n(`select count(*)::text as n from strategy.ladder_event where pursuit_id = $1`, [portfolioCo.pursuit_id]) : 0;
  const proposals = await adb.query<{ scope: { apply: { args: { rungs: Array<{ rung: string }> } } } }>(
    `select scope from governance.approval_ticket
              where kind = 'STAGE' and decision is null and scope->'apply'->>'command' = 'strategy.recordClimb'`);
  const proposedLow = proposals.filter((pr) => pr.scope.apply.args.rungs.some((r) => sg.ON_RECORD_RUNGS.includes(r.rung as never))).length;
  const second = await rc.reconcile(null);
  const climbed = await sg.getPursuit(nadia!.pursuit_id);
  // Only Reconciliation, only those rungs: a person's call, or a rung above them, is refused.
  const asPerson = await attempt(() => sg.recordClimbOnRecord(juanId, { pursuitId: nadia!.pursuit_id, from: climbed?.rung ?? null, rungs: [] }));
  const above = await attempt(() => sg.recordClimbOnRecord(sys, { pursuitId: nadia!.pursuit_id, from: climbed?.rung ?? null, rungs: [{
    rung: 'indication_given', evidenceKind: 'commitment', evidenceRef: 'commitment_event:invented', evidenceNote: 'Invented', occurredAt: new Date().toISOString() }] }));
  const ticketless = await attempt(() => sg.recordClimb(juanId, { pursuitId: nadia!.pursuit_id, ticketId: null, from: climbed?.rung ?? null, rungs: [] }));
  // Taken back: gone, and not recorded again from the same records.
  const tookBack = await sg.retractOnRecord(juanId, { pursuitId: nadia!.pursuit_id, rung: 'connector_willing' });
  const third = await rc.reconcile(null);
  const afterBack = await sg.getPursuit(nadia!.pursuit_id);
  const reasked = await n(`select count(*)::text as n from governance.approval_ticket where subject_id = $1 and kind = 'STAGE' and decision is null`, [nadia!.pursuit_id]);
  if (portfolioCo) await adb.query(`delete from network.portfolio where portfolio_id = 'invented-0137'`);
  check(
    'Reconciliation records the conversation rungs itself, only on records, as the system; never for a portfolio company; a person can take one back and it stays back',
    first.recorded > 0 && ladder1 > ladder0 && mineNew.length === ladder1 - ladder0 && unbacked === 0 && proposedLow === 0 &&
      second.recorded === 0 && second.proposed === 0 && canBecome === null && climbed?.rung === 'meeting_held' &&
      climbed.events.some((e) => e.rung === 'connector_willing' && e.evidenceKind === 'not_applicable') &&
      asPerson instanceof sg.LadderRefused && above instanceof sg.LadderRefused && ticketless instanceof Error &&
      (!portfolioCo || (portfolioRungs === 0 && first.notLp >= 1)) &&
      tookBack >= 3 && afterBack?.rung === null && third.recorded === 0 && reasked === 0,
    `${first.recorded} recorded (${mineNew.length} rungs, ${unbacked} without a record behind them or unmarked), ladder ${ladder0} → ${ladder1}; ${proposedLow} conversation-rung proposals; ` +
      `again: ${second.recorded} recorded, ${second.proposed} proposed; the system actor can be switched to: ${canBecome ? 'YES' : 'no'}; Nadia → ${climbed?.rung} (${climbed?.events.map((e) => `${e.rung}:${e.evidenceKind}`).join(', ')}); ` +
      `as a person: ${asPerson instanceof sg.LadderRefused ? 'refused' : 'RECORDED'}; above Meeting held: ${above instanceof sg.LadderRefused ? 'refused' : 'RECORDED'}; a ticketless approval path: ${ticketless instanceof Error ? 'refused' : 'RECORDED'}; ` +
      `portfolio company: ${portfolioCo ? `${portfolioRungs} rungs, ${first.notLp} not an LP` : 'no fixture'}; taken back: ${tookBack} rungs, then ${afterBack?.rung ?? 'nothing on file'}, recorded again ${third.recorded}, asked ${reasked}`,
  );

  // What a touchpoint is about (N59): the raise only when it says so, and only inside the
  // vehicle's window; and a proposal whose records no longer read the same is withdrawn.
  {
    const ab = await import('../../lib/connectors/affinity/about');
    const mt = await import('../../modules/meetings');
    const vs = [{ slug: 'neurotech', name: 'PLC Neurotech I', aliases: ['Neurotech I'] }, { slug: 'spv-x', name: 'SPV — X', aliases: ['Xylo'] }];
    const dom = ['fund.example'];
    const cases: Array<[string, string[], string, string]> = [
      ['Re: PLC Neurotech I — data room', [], 'raise', 'neurotech'],
      ['Acme monthly investor update', ['ceo@acme.example'], 'other', ''],
      ['Coffee next week?', ['sam@fund.example'], 'raise', ''],
      ['Coffee next week?', ['sam@research.example'], 'other', ''],
      ['Intro: would they invest in a first close?', [], 'raise', ''],
      ['Neuroscience seminar, spring schedule', [], 'other', ''],
      ['Xylo allocation', [], 'raise', 'spv-x'],
      ['Automatic reply: Invitation from PL Capital', ['sam@fund.example'], 'other', ''],
      ['Invitation from PL Capital: a dinner in April', [], 'raise', ''],
      // Someone at the fundraising domain only on copy: translation passes the sender and
      // the direct recipients, so here there is none.
      ['Re: Panel at the spring conference?', ['host@events.example'], 'other', ''],
      // N81: a short firm name in capitals is how a British company ends its name.
      ['Barclays PLC: results call', [], 'other', ''],
      ['Intro: Sam <> PLC', [], 'raise', ''],
      ['The Lattice SPV: next steps', [], 'raise', ''],
    ];
    const wrong = cases.filter(([text, addrs, about, v]) => {
      const r = ab.aboutRaise(text, addrs, vs, dom, ['PL Capital', 'PLC']);
      return r.about !== about || (v ? !r.vehicles.includes(v) : r.vehicles.length > 0);
    });
    const w = { vehicleId: 'v1', slug: 'neurotech', name: 'N', opens: new Date('2026-01-01T00:00:00Z'), closes: null, note: null };
    const touch = (on: string, about: 'raise' | 'other', vehicles: string[] = [], by: 'rule' | 'claude' | 'person' = 'rule') => ({
      touchpointId: 't', entityId: 'e', entityName: 'E', vehicleId: null, vehicleName: null, channel: 'email' as const, kind: null,
      on: new Date(on), scheduledFor: null, direction: 'theirs' as const, ownerName: 'x', attendees: [], summary: null,
      read: null, readByName: null, source: 'affinity', sourceRef: 'r', viaOrganization: null, about, aboutVehicles: vehicles, aboutBasis: null,
      aboutBy: by,
    });
    const old2021 = mt.aboutThisRaise(touch('2021-05-01T00:00:00Z', 'raise', ['neurotech']), w);
    const in2026 = mt.aboutThisRaise(touch('2026-03-01T00:00:00Z', 'raise', ['neurotech']), w);
    // N81: about a raise without saying which counts for no vehicle; a person's tag counts
    // before the window opens, Claude's doesn't.
    const unnamed2026 = mt.aboutThisRaise(touch('2026-03-01T00:00:00Z', 'raise'), w);
    const personEarly = mt.aboutThisRaise(touch('2025-11-01T00:00:00Z', 'raise', ['neurotech'], 'person'), w);
    const claudeEarly = mt.aboutThisRaise(touch('2025-11-01T00:00:00Z', 'raise', ['neurotech'], 'claude'), w);
    const shows = [mt.eventAbout(touch('2026-03-01T00:00:00Z', 'raise'), [w]).kind, mt.eventAbout(touch('2021-05-01T00:00:00Z', 'raise'), [w]).kind].join('/');
    const otherVehicle = mt.aboutThisRaise(touch('2026-03-01T00:00:00Z', 'raise', ['spv-x']), w);
    const aboutElse = mt.aboutThisRaise(touch('2026-03-01T00:00:00Z', 'other'), w);
    const noWindow = { ...w, slug: 'spv-x', opens: null };
    const generalNoWindow = mt.aboutThisRaise(touch('2026-03-01T00:00:00Z', 'raise'), noWindow);
    const namedNoWindow = mt.aboutThisRaise(touch('2026-03-01T00:00:00Z', 'raise', ['spv-x']), noWindow);
    const unread = await n(`select count(*)::text as n from meetings.meeting where source = 'affinity' and about is null`);
    const rows = await n(`select count(*)::text as n from meetings.meeting where source = 'affinity'`);
    // A proposal still open; its records then read as about something else.
    const still = await adb.one<{ id: string; subject_id: string }>(
      `select id::text, subject_id::text from governance.approval_ticket
                where kind = 'STAGE' and decision is null and scope->'apply'->>'command' = 'strategy.recordClimb' limit 1`);
    let withdrawn = 0;
    let deferred = 0;
    if (still) {
      await adb.query(`update meetings.meeting set about = 'other' where source = 'affinity' and entity_id = (select entity_id from strategy.pursuit where pursuit_id = $1)`, [still.subject_id]);
      withdrawn = (await rc.reconcile(null)).withdrawn;
      deferred = await n(`select count(*)::text as n from governance.approval_ticket where id = $1 and decision = 'defer'`, [still.id]);
    }
    check(
      'A touchpoint counts for a raise only when it says so and falls in its window; a proposal on records that changed is withdrawn',
      wrong.length === 0 && !old2021 && in2026 && !otherVehicle && !aboutElse && !generalNoWindow && namedNoWindow && unread === 0 && rows > 0 && (!still || (withdrawn >= 1 && deferred === 1)) &&
        !unnamed2026 && personEarly && !claudeEarly && shows === 'unclear/none',
      `classifier: ${cases.length - wrong.length} of ${cases.length} right${wrong.length ? ` (wrong: ${wrong.map((c) => c[0]).join('; ')})` : ''}; ` +
        `about the raise but from 2021: ${old2021 ? 'COUNTED' : 'not counted'}; in 2026: ${in2026 ? 'counted' : 'NOT COUNTED'}; naming another vehicle: ${otherVehicle ? 'COUNTED' : 'not counted'}; ` +
        `about something else: ${aboutElse ? 'COUNTED' : 'not counted'}; no window, about a raise in general: ${generalNoWindow ? 'COUNTED' : 'not counted'}, naming it: ${namedNoWindow ? 'counted' : 'NOT COUNTED'}; ${unread} of ${rows} Affinity touchpoints unread after translating; ` +
        `about a raise, no vehicle named, in 2026: ${unnamed2026 ? 'COUNTED' : 'not counted'} (shown ${shows}); tagged before the window by a person: ${personEarly ? 'counted' : 'NOT COUNTED'}, by Claude: ${claudeEarly ? 'COUNTED' : 'not counted'}; ` +
        `open proposal whose records changed: ${still ? (deferred ? 'withdrawn' : 'STILL OPEN') : 'none open to test'}`,
    );
  }

  // The network from our records (N82): every active user is a person in the graph; a meeting
  // held one to one is a tier-A tie, our event is none; a rebuild changes nothing; a person's
  // "not a real tie" ends it and a rebuild leaves it ended.
  {
    const nw = await import('../../modules/network');
    const first = await nw.buildNetwork();
    const users = await n(`select count(*)::text as n from platform.app_user where active`);
    const linked = await n(`select count(*)::text as n from identity.source_record where source = 'app_user'`);
    const met = await n(`select count(*)::text as n from network.edge where kind = 'met' and tier = 'A' and evidence @> '[{"derived": "records"}]'`);
    const before = await n(`select count(*)::text as n from network.edge`);
    const again = await nw.buildNetwork();
    const after = await n(`select count(*)::text as n from network.edge`);
    const edge = await adb.one<{ edge_id: string; a: string; b: string }>(
      `select edge_id::text, from_entity::text as a, to_entity::text as b from network.edge where evidence @> '[{"derived": "records"}]' limit 1`);
    if (edge) await nw.reviewEdge(juanId, edge.edge_id, 'decline', 'not someone they know');
    await nw.buildNetwork();
    const ended = edge ? await n(`select count(*)::text as n from network.edge where from_entity = $1 and to_entity = $2 and valid_to < current_date and reviewed_at is not null`, [edge.a, edge.b]) : 0;
    const doubled = edge ? await n(`select count(*)::text as n from network.edge where from_entity = $1 and to_entity = $2`, [edge.a, edge.b]) : 0;
    check('The network from our records: the team in the graph, a one-to-one meeting a tier-A tie, a rebuild the same, a person’s “not a real tie” kept',
      linked >= users && met >= 1 && before === after && again.fromRecords === first.fromRecords && ended === 1 && doubled === 1,
      `${users} users, ${linked} linked; ${met} tier-A ties from meetings; edges ${before} → ${after} on a rebuild (${first.fromRecords} → ${again.fromRecords} from records, ${first.fromResearch} from research); ` +
        `a tie turned down: ${ended ? 'ended, and kept ended' : 'NOT KEPT'} (${doubled} on that pair)`);
    await connectionsV2Properties(adb, check);
  }

  // An event of ours is not a meeting (N81): a calendar entry with four or more of our records
  // on it counts as their opting in, never as a meeting held, and isn't counted as a meeting.
  {
    const rcx = await import('../../lib/reconcile');
    const mtx = await import('../../modules/meetings');
    const t = (id: string, on: string, groupSize: number) => ({
      touchpointId: id, entityId: 'e', entityName: 'E', vehicleId: null, vehicleName: null, channel: 'meeting' as const, kind: null,
      on: new Date(on), scheduledFor: null, direction: 'both' as const, ownerName: 'x', attendees: [], summary: null,
      read: null, readByName: null, source: 'affinity', sourceRef: `interaction:meeting:${id}:person:1`, viaOrganization: null,
      about: 'raise' as const, aboutVehicles: ['neurotech'], aboutBasis: null, aboutBy: 'claude' as const, groupSize,
    });
    const salon = t('1', '2026-03-01T00:00:00Z', 23);
    const onlyEvent = rcx.recordsOnFile([salon], [], new Date('2026-09-01T00:00:00Z'));
    const both = rcx.recordsOnFile([salon, t('2', '2026-04-01T00:00:00Z', 1)], [], new Date('2026-09-01T00:00:00Z'));
    const sum = mtx.summarize([salon, t('2', '2026-04-01T00:00:00Z', 1)], new Date('2026-09-01T00:00:00Z'));
    // An automatic reply is no word from them (N81): nothing is owed, and our note still waits.
    const auto = { ...t('3', '2026-05-01T00:00:00Z', 1), channel: 'email' as const, direction: 'theirs' as const, aboutBasis: 'General: an automatic reply to our mailing (out of office)' };
    const ours = { ...t('4', '2026-04-30T00:00:00Z', 1), channel: 'email' as const, direction: 'ours' as const };
    const quiet = mtx.summarize([ours, auto, { ...salon, on: new Date('2026-05-02T00:00:00Z') }], new Date('2026-09-01T00:00:00Z'));
    const autoIgnored = quiet.lastFromThem === null && quiet.awaitingSince?.toISOString().slice(0, 10) === '2026-04-30';
    check('Our event is not a meeting, and an automatic reply is no word from them: opting in is not a meeting held, and nothing is owed',
      autoIgnored && !onlyEvent.meeting_held && /came to our event/.test(onlyEvent.target_opted_in?.note ?? '') &&
        both.meeting_held?.ref.includes(':2:') === true && /came to our event/.test(both.target_opted_in?.note ?? '') && sum.meetingDates.length === 1,
      `an automatic reply after our note: ${autoIgnored ? 'no word from them, our note still waits' : 'COUNTED AS A REPLY'}; event alone: held ${onlyEvent.meeting_held ? 'PROPOSED' : 'not proposed'}, opted in "${(onlyEvent.target_opted_in?.note ?? 'none').slice(0, 40)}"; with a later one-to-one: held from ${both.meeting_held?.ref.split(':')[2] ?? 'none'}; meetings counted: ${sum.meetingDates.length}`);
  }

  // Which vehicles each event is about (N81): the fundraising domain reads a message's
  // addresses only, never a meeting's invitees; Claude's file is laid over the rules; a
  // person's tag is written at once, to the notes on the meeting too, and the next
  // translation keeps it; a line naming a vehicle we don't have is refused.
  {
    const et = await import('../../lib/connectors/affinity/event-tags');
    // The rule's own words when it fires (about.ts, rule 5); "not to or from" is its absence.
    const DOMAIN = `about = 'raise' and about_basis like 'from or to the fundraising domain%'`;
    const byDomain = await n(`select count(*)::text as n from meetings.meeting where source = 'affinity' and channel in ('meeting', 'call') and ${DOMAIN}`);
    const domainChannels = (await adb.query<{ channel: string; n: string }>(
      `select channel::text, count(*)::text as n from meetings.meeting where source = 'affinity' and ${DOMAIN} group by 1 order by 1`,
    )).map((r) => `${r.channel} ${r.n}`).join(', ') || 'none';
    const ref = 'interaction:meeting:55012';
    const claudeRows = await n(`select count(*)::text as n from meetings.meeting where source = 'affinity' and about_by = 'claude'
                                          and source_ref like $1 and about_vehicles = '{neurotech}'`, [`${ref}:%`]);
    const rails = await n(`select count(*)::text as n from meetings.meeting where source_ref like 'interaction:meeting:55024:%' and about_vehicles = '{rails}'`);
    await et.tagEvent(juanId, ref, { about: 'other', vehicles: [], basis: 'a walkthrough for her partner, not the raise' });
    const personNow = await n(`select count(*)::text as n from meetings.meeting where source_ref like $1 and about_by = 'person' and about = 'other'`, [`${ref}:%`]);
    const noteTook = await n(`select count(*)::text as n from meetings.event_tag where ref = 'note:30008' and by_kind = 'person' and about = 'other'`);
    await tr.translate(null, { mappingPath: file });
    const personKept = await n(`select count(*)::text as n from meetings.meeting where source_ref like $1 and about_by = 'person' and about = 'other'`, [`${ref}:%`]);
    const logged = await n(`select count(*)::text as n from platform.audit_log where action = 'event.tagged' and detail->>'ref' = $1`, [ref]);
    const slugs = new Set(['neurotech']);
    const refused = [
      et.checkLine('interaction:meeting:1', { about: 'raise', vehicles: ['not-ours'] }, slugs),
      et.checkLine('note:1', { about: 'other', vehicles: ['neurotech'] }, slugs),
      et.checkLine('interaction:meeting:1:person:7', { about: 'raise', vehicles: [] }, slugs),
      et.checkLine('note:1', { about: 'raise', vehicles: [], basis: 'recovering from surgery' }, slugs),
    ].filter((x) => typeof x === 'string').length;
    // Put it back as Claude read it, for what follows.
    await adb.query(`delete from meetings.event_tag where ref in ($1, 'note:30008') and by_kind = 'person'`, [ref]);
    await tr.translate(null, { mappingPath: file });
    check(
      'Each event says which vehicles it is about: invitees are not evidence, Claude’s tags lie over the rules, and a person’s tag outlives a translation',
      byDomain === 0 && claudeRows >= 1 && rails >= 1 && personNow >= 1 && noteTook === 1 && personKept === personNow && logged === 1 && refused === 4,
      `meetings and calls read as about the raise by the domain: ${byDomain} (all read so: ${domainChannels}); Claude's tag on the fee walkthrough: ${claudeRows} rows; the Crypto/Rails meeting tagged Rails: ${rails}; ` +
        `a person's tag: ${personNow} rows at once, the note on it ${noteTook ? 'tagged too' : 'NOT TAGGED'}, ${personKept} after translating again, ${logged} logged; bad lines refused: ${refused} of 4`,
    );
  }

  const { shownRead } = await import('../../lib/reads');
  const at = new Date('2026-09-24T00:00:00Z');
  const note = (read: 'interested' | 'not_very_interested', on: string) => ({
    noteId: '1', entityId: 'e', on: new Date(on), summary: null, read, basis: null, by: 'claude',
    confirmedByName: null, confirmedAt: null, dismissed: false,
  });
  const cooledThenCommitted = shownRead(null, [note('not_very_interested', '2025-10-21T00:00:00Z')], [{ on: new Date('2026-09-23T00:00:00Z'), points: 'up', what: 'committed' }], at);
  const keenThenDeclined = shownRead(null, [note('interested', '2026-05-01T00:00:00Z')], [{ on: new Date('2026-07-01T00:00:00Z'), points: 'down', what: 'they declined' }], at);
  const keenThenCommitted = shownRead(null, [note('interested', '2026-05-01T00:00:00Z')], [{ on: new Date('2026-07-01T00:00:00Z'), points: 'up', what: 'committed' }], at);
  const declinedBefore = shownRead(null, [note('interested', '2026-05-01T00:00:00Z')], [{ on: new Date('2026-04-01T00:00:00Z'), points: 'down', what: 'they declined' }], at);
  const aged = shownRead(null, [note('interested', '2025-10-21T00:00:00Z')], [], at);
  check(
    'A read is superseded only by a later record pointing the other way, and is old past the threshold',
    Boolean(cooledThenCommitted?.superseded) && Boolean(keenThenDeclined?.superseded) && !keenThenCommitted?.superseded &&
      !declinedBefore?.superseded && aged?.old === true && keenThenCommitted?.old === false,
    `not very interested, then committed: ${cooledThenCommitted?.superseded ? 'superseded' : 'STILL SHOWN'}; interested, then declined: ${keenThenDeclined?.superseded ? 'superseded' : 'STILL SHOWN'}; ` +
      `interested, then committed: ${keenThenCommitted?.superseded ? 'SUPERSEDED' : 'stands'}; a decline before the read: ${declinedBefore?.superseded ? 'SUPERSEDED' : 'stands'}; 11 months old: ${aged?.old ? 'old' : 'NOT OLD'}`,
  );
}
