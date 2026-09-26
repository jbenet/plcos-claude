import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { translatedNotesProperties } from './affinity-notes';
import { readingProperties } from './readings';
import { reconciliationProperties } from './reconciliation';
import { updateProperties } from './updates';
import { enrichmentProperties, connectionProperties, triageProperties, searchProperties, connectorPlanProperties } from './enrichment';
import { enrichmentStrategyProperties } from './enrichment-strategy';
import type { AffinityContext } from './affinity-fixtures';

export async function affinityTranslationProperties(ctx: AffinityContext & { report: Awaited<ReturnType<typeof import('../../lib/connectors/affinity/inventory').inventory>> }) {
  const { check, adb, attempt } = ctx;
  const { report } = ctx;
  // Translation (N47), on the fake Affinity, through a mapping of its own.
  const map = await import('../../lib/connectors/affinity/mapping');
  const tr = await import('../../lib/connectors/affinity/translate');
  const { readFile: rf, writeFile: wf } = await import('node:fs/promises');
  const file = join('data', 'demo', 'props-translate.jsonc');
  await rm(join(process.cwd(), file), { force: true });
  await map.writeMapping(report, {}, file);
  const n = async (sql: string, params: unknown[] = []) => Number((await adb.one<{ n: string }>(sql, params))!.n);
  const ladderBefore = await n(`select count(*)::text as n from strategy.ladder_event`);
  const first = await tr.translate(null, { mappingPath: file });
  const hard = await n(`select count(*)::text as n from pipeline.exposure where source = 'affinity' and track = 'hard'`);
  const soft = await n(`select count(*)::text as n from pipeline.exposure where source = 'affinity' and track = 'soft'`);
  const ladderAfter = await n(`select count(*)::text as n from strategy.ladder_event`);
  check(
    'Translation makes nothing hard and writes nothing onto the ladder',
    first?.status === 'ok' && hard === 0 && soft > 0 && ladderBefore === ladderAfter,
    `${first?.status}: ${first?.note}; hard from Affinity ${hard}; ladder events ${ladderBefore} → ${ladderAfter}`,
  );

  const signed = await adb.one<{ track: string; claim: string }>(
    `select x.track::text as track, x.claim from pipeline.exposure x
             join identity.source_record r on r.entity_id = x.entity_id and r.source = 'affinity' and r.source_id = 'person:7006'`,
  );
  check(
    'A signed stage stays soft, marked ready to harden once countersigned',
    signed?.track === 'soft' && /ready to harden once countersigned/.test(signed.claim ?? ''),
    `track ${signed?.track}; "${signed?.claim}"`,
  );

  const claimSig = await adb.one<{ step: string; occurred_on: string | null; source: string; track: string }>(
    `select ce.step::text as step, ce.occurred_on::text as occurred_on, ce.source, x.track::text as track
             from pipeline.commitment_event ce join pipeline.exposure x on x.exposure_id = ce.exposure_id
             join identity.source_record r on r.entity_id = x.entity_id and r.source = 'affinity' and r.source_id = 'person:7006'`,
  );
  check(
    'Affinity’s “Signed” is an undated signature claimed by Affinity, and the money stays soft',
    claimSig?.step === 'signed' && claimSig.occurred_on === null && claimSig.source === 'affinity' && claimSig.track === 'soft',
    `${claimSig?.step}, dated ${claimSig?.occurred_on ?? 'never'}, by ${claimSig?.source}; track ${claimSig?.track}`,
  );

  const dnc = await n(
    `select count(*)::text as n from coordination.restriction c join identity.source_record r
             on r.entity_id = c.entity_id and r.source = 'affinity' and r.source_id = 'person:7005' where c.scope = 'blanket'`,
  );
  const dncPursuit = await adb.one<{ status: string; passed_by: string | null; status_reason: string | null }>(
    `select p.status::text as status, p.passed_by, p.status_reason from strategy.pursuit p join identity.source_record r
             on r.entity_id = p.entity_id and r.source = 'affinity' and r.source_id = 'person:7005'`,
  );
  const co = await import('../../modules/coordination');
  const overview = (await co.listRestrictions()).filter((x) => (x.source ?? '').startsWith('affinity:list:')).length;
  const everywhere = (await co.listRestrictions({ includeListMarks: true })).filter((x) => (x.source ?? '').startsWith('affinity:list:')).length;
  check(
    'A do-not-contact mark is a do-not-approach restriction and a pass — shown where they come up, not in every overview',
    dnc === 1 && dncPursuit?.status === 'passed' && dncPursuit.passed_by === 'us' && dncPursuit.status_reason === 'do_not_contact' &&
      overview === 0 && everywhere === 1,
    `restrictions on the marked person: ${dnc}; their pursuit ${dncPursuit?.status} (${dncPursuit?.passed_by}, ${dncPursuit?.status_reason}); in overviews ${overview}, on their own page ${everywhere}`,
  );

  await translatedNotesProperties(ctx);

  const counted = async () => [
    await n(`select count(*)::text as n from strategy.pursuit where source = 'affinity'`),
    await n(`select count(*)::text as n from pipeline.exposure where source = 'affinity'`),
    await n(`select count(*)::text as n from research.claim where source like 'affinity:%'`),
    await n(`select count(*)::text as n from coordination.restriction where source like 'affinity:%'`),
    await n(`select count(*)::text as n from identity.source_record where source = 'affinity'`),
  ].join(',');
  const before = await counted();
  await tr.translate(null, { mappingPath: file });
  const after = await counted();
  check('Translating twice adds nothing the second time', before === after, `pursuits, exposures, claims, restrictions, people: ${before} → ${after}`);

  const statusOf = (who: string) => adb.one<{ pursuit_id: string; status: string; status_said: string | null; stage_said: string | null; implied: string[]; status_source: string }>(
    `select p.pursuit_id, p.status::text as status, p.status_said::text as status_said, p.stage_said, p.implied, p.status_source
             from strategy.pursuit p join identity.source_record r
               on r.entity_id = p.entity_id and r.source = 'affinity' and r.source_id = $1`, [who],
  );
  // Omar: "Intro made". (Marcus, "Contacted", is marked do-not-contact, which outranks any word.)
  const was = (await statusOf('person:7002'))?.status;
  await wf(join(process.cwd(), file), (await rf(join(process.cwd(), file), 'utf8')).replace(/("Intro made":\s*)\{[^}]*\}/, '$1{"status":"discussing","implies":["replied"]}'));
  await tr.translate(null, { mappingPath: file });
  const now = (await statusOf('person:7002'))?.status;
  check('A mapping edit takes effect the next time it is translated — no request to Affinity', was === 'connecting' && now === 'discussing', `"Intro made" was ${was}, is ${now}`);

  // Money says yes: an amount on the commitment field makes an entry Committed, whatever the
  // word — here "Diligence", with a committed amount beside it.
  const nadia = await statusOf('person:7001');
  check(
    'An amount on the commitment field makes an entry Committed, and the word is kept beside it',
    nadia?.status === 'committed' && nadia.stage_said === 'Diligence' && nadia.implied.includes('soft') && nadia.implied.includes('diligence'),
    `status ${nadia?.status}; Affinity said "${nadia?.stage_said}", implying ${nadia?.implied.join(', ')}`,
  );

  // Touchpoints (N51): from each entry's interaction dates and from meeting, call and email
  // notes, one per interaction, the calendar's date over the note's.
  const mt = await import('../../modules/meetings');
  const nadiaLog = await mt.touchpointsFor(nadia!.pursuit_id ? (await adb.one<{ entity_id: string }>(`select entity_id from strategy.pursuit where pursuit_id = $1`, [nadia!.pursuit_id]))!.entity_id : '', null);
  const nadiaSum = mt.summarize(nadiaLog, new Date('2026-09-23T00:00:00Z'));
  const touchBefore = await n(`select count(*)::text as n from meetings.meeting where source = 'affinity'`);
  await tr.translate(null, { mappingPath: file });
  const touchAfter = await n(`select count(*)::text as n from meetings.meeting where source = 'affinity'`);
  check(
    'Affinity’s interactions become dated touchpoints, one each, and translating again adds none',
    nadiaSum.meetingDates.map((d) => d.toISOString().slice(0, 10)).join(',') === '2026-06-18,2026-07-09,2026-08-21,2026-09-10' &&
      nadiaSum.nextMeeting?.toISOString().slice(0, 10) === '2026-10-06' &&
      nadiaLog.every((t) => t.vehicleId === null && t.summary === null) && touchBefore > 0 && touchBefore === touchAfter,
    `meetings ${nadiaSum.meetingDates.map((d) => d.toISOString().slice(0, 10)).join(', ')}, next ${nadiaSum.nextMeeting?.toISOString().slice(0, 10)}; ${nadiaLog.length} touchpoints, none tied to a vehicle, no text copied; Affinity touchpoints ${touchBefore} → ${touchAfter}`,
  );

  // Logged here: rules at the door, and nothing reaches the ladder.
  const juanId = (await adb.one<{ id: string }>(`select id from platform.app_user where handle = 'juan'`))!.id;
  const ent = (await adb.one<{ entity_id: string; vehicle_id: string }>(`select entity_id, vehicle_id from strategy.pursuit where pursuit_id = $1`, [nadia!.pursuit_id]))!;
  const ladderT0 = await n(`select count(*)::text as n from strategy.ladder_event`);
  const noCorpus = await attempt(() => mt.logTouchpoint(juanId, { entityId: ent.entity_id, vehicleId: ent.vehicle_id, channel: 'research', on: new Date() }));
  const readAhead = await attempt(() => mt.logTouchpoint(juanId, { entityId: ent.entity_id, vehicleId: ent.vehicle_id, channel: 'meeting', on: new Date(Date.now() + 5 * 86_400_000), read: 'interested' }));
  await mt.logTouchpoint(juanId, { entityId: ent.entity_id, vehicleId: ent.vehicle_id, channel: 'meeting', on: new Date('2026-09-20T12:00:00Z'), direction: 'both', read: 'very_interested', summary: 'Third meeting: the data room walkthrough' });
  await mt.logTouchpoint(juanId, { entityId: ent.entity_id, vehicleId: ent.vehicle_id, channel: 'email', on: new Date('2026-09-21T12:00:00Z'), direction: 'ours', summary: 'Sent the side letter draft' });
  const logged = mt.summarize(await mt.touchpointsFor(ent.entity_id, ent.vehicle_id), new Date('2026-09-23T00:00:00Z'));
  const ladderT1 = await n(`select count(*)::text as n from strategy.ladder_event`);
  check(
    'A logged touchpoint counts, carries their read, and waits on their reply — and touches no rung',
    noCorpus instanceof mt.TouchpointRefused && readAhead instanceof mt.TouchpointRefused &&
      logged.meetingDates.length === 4 && logged.read?.read === 'very_interested' &&
      logged.awaitingSince?.toISOString().slice(0, 10) === '2026-09-21' && ladderT0 === ladderT1,
    `research with no corpus: ${noCorpus ? 'refused' : 'ALLOWED'}; a read before it happened: ${readAhead ? 'refused' : 'ALLOWED'}; meetings ${logged.meetingDates.length}; read ${logged.read?.read}; waiting since ${logged.awaitingSince?.toISOString().slice(0, 10)}; ladder ${ladderT0} → ${ladderT1}`,
  );

  // Readings of the notes (N55): suggestions, never over a person's read, never of health.
  await readingProperties({ ...ctx, n, tr, file, juanId, mt });

  // Reconciliation (N57): the climbs the records on file support, proposed by the system, recorded
  // only when a person approves; and a read superseded by a later record pointing the other way.
  await reconciliationProperties({ ...ctx, n, nadia, juanId, ent, tr, file });

  // A person sets a status; the next translation keeps it, and keeps Affinity's word beside it.
  const st = await import('../../modules/strategy');
  const juan = (await adb.one<{ id: string }>(`select id from platform.app_user where handle = 'juan'`))!.id;
  const ruth = (await statusOf('person:7003'))!;
  const refused = await attempt(() => st.setStatus(juan, ruth.pursuit_id, { status: 'passed' }));
  const ladder0 = await n(`select count(*)::text as n from strategy.ladder_event`);
  await st.setStatus(juan, nadia!.pursuit_id, { status: 'discussing', reason: 'Committed amount is their ask, not a yes', nextStep: 'IC on 14 Oct', nextStepOn: new Date('2026-10-14T00:00:00Z') });
  await tr.translate(null, { mappingPath: file });
  const kept2 = await statusOf('person:7001');
  const ladder1 = await n(`select count(*)::text as n from strategy.ladder_event`);
  check(
    'A status set here survives the next translation; Affinity’s reading stays beside it; the ladder is untouched',
    refused instanceof st.StatusRefused && kept2?.status === 'discussing' && kept2.status_source === 'us' &&
      kept2.status_said === 'committed' && kept2.stage_said === 'Diligence' && ladder0 === ladder1,
    `passed with nobody said to end it: ${refused ? 'refused' : 'ALLOWED'}; after translating again: ${kept2?.status} (set ${kept2?.status_source}), Affinity reads ${kept2?.status_said}; ladder events ${ladder0} → ${ladder1}`,
  );

  // An update (N61, issue 0004): read into suggestions, each resting on its words; saved with
  // what the person ticked, all of it in one write, once per form; never a rung or an amount.
  await updateProperties({ ...ctx, n, st, juan });

  // Enrichment (N64, docs/19): the research set carries identity only; findings map in as
  // unverified claims with their provenance, once; a verified claim survives a re-import; a
  // bad file is refused; a strategy is a proposal a person decides, moving only the next step.
  await enrichmentProperties({ ...ctx, n, st, juan });

  // Connections without the web (docs/19, iteration 3): a denial names a firm and ties to
  // none; a school is not an employer; a shared company record is C and a shared employer D;
  // a one-word name in a sentence is no tie; a strategy older than its LP's finding is stale.
  await connectionProperties(check);

  // A firm's own words close a fund ask (1.17) — but "not directly" is a firm that backs managers.
  await triageProperties(check);

  // Coverage says what ran (rule 7): a finding owed the search pass because it ran too few
  // searches is not said to have run none.
  await searchProperties(check);

  // Capacity rests on evidence (W5 1.5): money, assets, a filing — not a denial, not a
  // company's valuation or round, not a figure the basis calls unknown.
  await enrichmentStrategyProperties(check);

  // The connector plan (W11): a restricted prospect is left out (rule 8), and so is one who has
  // met us; a connector whose money is soft asks after signing; asks stop at the guard's limit.
  await connectorPlanProperties(check);

  await adb.query(`update platform.vehicle set phase = 'historical' where slug = 'neurotech'`);
  await tr.translate(null, { mappingPath: file });
  const open = await n(
    `select count(*)::text as n from pipeline.exposure x join platform.vehicle v on v.id = x.vehicle_id
            where v.slug = 'neurotech' and x.source = 'affinity' and x.closed_at is null`,
  );
  await adb.query(`update platform.vehicle set phase = 'active' where slug = 'neurotech'`);
  await tr.translate(null, { mappingPath: file });
  check('On a historical vehicle, translated money is closed and counts in no current figure', open === 0, `open Affinity exposures on the vehicle while historical: ${open}`);
  await rm(join(process.cwd(), file), { force: true });
}
