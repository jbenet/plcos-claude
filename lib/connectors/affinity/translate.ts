import { config } from '@/config/deployment';
import { getDb, type Queryable } from '@/lib/db';
import { finishRun, latestRaw, latestRun, startRun, type SyncRun } from '@/modules/sources';
import { discovered, initForMatching, type AffinityUser } from './discover';
import { inventory } from './inventory';
import { placeEntry, readMapping, reasonOf, type ListMapping } from './mapping';
import { normName } from './match';
import { sliceTargets } from './slice';
import type { AffinityNote } from './notes';
import type { PursuitStatus } from '@/modules/strategy';

/**
 * Translation (N47, docs/16 §4): the landed copy, read through the mapping, into the tool's
 * own tables. Local only — not one request to Affinity — and re-runnable: a mapping edit takes
 * effect on the next run, and running twice changes nothing the second time.
 *
 * What it writes, and the rule each follows:
 *   people and organizations   identity.entity, joined to Affinity by source_record
 *   pursuits                   our status (N50, docs/17), who and why where it passed, and
 *                              what Affinity itself said and implied — claims beside the
 *                              ladder, never ladder events (rule 2). A status a person set
 *                              here is never overwritten; Affinity's word is kept beside it.
 *   commitments                soft, always; a word implying "signed" marks one ready to
 *                              harden (rule 1), and any amount makes the entry Committed
 *   check size, AUM            research claims with the list as their source (rule 9)
 *   do not contact             a blanket do-not-approach restriction (rule 8)
 *   touchpoints                dated meetings, calls and emails (N51): each list entry's
 *                              interaction dates, and every meeting, call or email note
 *                              attached to someone in the tool — the log, never the ladder
 *
 * Direct SQL across schemas, as the seed does: this is the real profile's seed, read from a
 * source rather than a fixture, and like the seed it runs in one transaction.
 */

interface V { type: string; data: unknown }
interface F { id: string; name: string; type: string; value: V | null }
interface E {
  id: number;
  type: 'person' | 'company' | 'opportunity';
  listId: number;
  createdAt: string;
  entity: { id: number; name?: string; firstName?: string; lastName?: string | null; fields?: F[] };
}

const SOURCE = 'affinity';
const PLACEHOLDER = 'not-on-team';

const nameOf = (p: { firstName?: string | null; lastName?: string | null; name?: string }) =>
  p.name ?? ([p.firstName, p.lastName].filter(Boolean).join(' ') || 'unnamed');
const text = (v: V | null): string | null => {
  if (!v || v.data === null || v.data === undefined) return null;
  const d = v.data as { text?: string } | string;
  if (typeof d === 'string') return d.trim() || null;
  if (Array.isArray(d)) return (d as Array<{ text?: string }>).map((x) => x?.text).filter(Boolean).join(', ') || null;
  return d.text ?? null;
};
const num = (v: V | null): number | null => (v && typeof v.data === 'number' && Number.isFinite(v.data) && v.data > 0 ? v.data : null);
const people = (v: V | null) =>
  (!v || !v.data ? [] : (Array.isArray(v.data) ? v.data : [v.data])) as Array<{ id: number; type?: string; firstName?: string | null; lastName?: string | null }>;
const companies = (v: V | null) =>
  (!v || !v.data ? [] : (Array.isArray(v.data) ? v.data : [v.data])) as Array<{ id: number; name?: string }>;

export interface TranslationCounts {
  people: number;
  organizations: number;
  affiliations: number;
  pursuits: number;
  byVehicle: Record<string, number>;
  byStatus: Record<string, number>;
  /** Pursuits whose status a person set here, so this run kept theirs. */
  keptOurs: number;
  unplaced: number;
  skipped: number;
  exposures: number;
  readyToHarden: number;
  claims: number;
  restrictions: number;
  ownersNotOnTeam: number;
  unreviewedLists: string[];
  /** Touchpoints added this run (N51); one already there is not counted again. */
  touchpoints: number;
}

async function entityFor(tx: Queryable, kind: 'person' | 'org', sourceId: string, name: string, counts: TranslationCounts): Promise<string> {
  const found = await tx.one<{ entity_id: string }>(
    `select entity_id from identity.source_record where source = $1 and source_id = $2`, [SOURCE, sourceId],
  );
  if (found) {
    await tx.query(`update identity.entity set display_name = $2 where entity_id = $1 and display_name <> $2`, [found.entity_id, name]);
    return found.entity_id;
  }
  const row = await tx.one<{ entity_id: string }>(
    `insert into identity.entity (entity_type, display_name) values ($1::identity.entity_type, $2) returning entity_id`, [kind, name],
  );
  await tx.query(
    `insert into identity.source_record (source, source_id, entity_id, confidence, resolved_by) values ($1,$2,$3,1,'rule:affinity-id')`,
    [SOURCE, sourceId, row!.entity_id],
  );
  if (kind === 'person') counts.people++;
  else counts.organizations++;
  return row!.entity_id;
}

/** `mappingPath` is for the property harness, which keeps its own copy; the app never passes it. */
export async function translate(runBy: string | null, opts: { mappingPath?: string } = {}): Promise<SyncRun | null> {
  const run = await startRun(SOURCE, 'translate', runBy);
  const counts: TranslationCounts = {
    people: 0, organizations: 0, affiliations: 0, pursuits: 0, byVehicle: {}, byStatus: {}, keptOurs: 0, unplaced: 0, skipped: 0,
    exposures: 0, readyToHarden: 0, claims: 0, restrictions: 0, ownersNotOnTeam: 0, unreviewedLists: [], touchpoints: 0,
  };
  try {
    const [inv, init, found, targets, rawEntries, rawNotes] = await Promise.all([
      inventory(), initForMatching(), discovered(), sliceTargets(), latestRaw<E>(SOURCE, 'list_entry'),
      latestRaw<AffinityNote>(SOURCE, 'note'),
    ]);
    const mapping = await readMapping(inv, opts.mappingPath);
    if (!init) throw new Error('The init file does not load; translation needs its team and vehicles.');
    if (!mapping.exists) throw new Error('No mapping yet. Write it on Developer → Affinity → Mapping first.');
    if (mapping.problems.length) throw new Error(`The mapping has ${mapping.problems.length} problems; fix them first (Mapping page).`);

    const db = await getDb();
    await db.transaction(async (tx) => {
      // Owners who are not on the team keep their pursuits under a placeholder nobody signs in
      // as, with their own name kept on each pursuit.
      await tx.query(
        `insert into platform.app_user (handle, name, initials, role, email, active)
         values ($1, 'Not on the team', '—', 'Holds pursuits whose owner in the source is not on the team', '', false)
         on conflict (handle) do nothing`,
        [PLACEHOLDER],
      );
      const users = new Map((await tx.query<{ id: string; handle: string }>(`select id, handle from platform.app_user`)).map((u) => [u.handle, u.id]));
      const vehicles = new Map((await tx.query<{ id: string; slug: string; kind: string; phase: string }>(`select id, slug, kind::text as kind, phase from platform.vehicle`)).map((v) => [v.slug, v]));
      const teamByAffinity = new Map<number, string>();
      for (const u of found.users as AffinityUser[]) {
        const email = u.primaryEmailAddress?.toLowerCase();
        const member = init.team.find((t) => email && [t.affinityEmail?.toLowerCase(), t.email?.toLowerCase()].includes(email));
        if (member && users.get(member.handle)) teamByAffinity.set(u.id, users.get(member.handle)!);
      }

      for (const t of targets) {
        if (!t.vehicleSlug) continue;
        const m: ListMapping | undefined = Object.entries(mapping.lists).find(([k]) => normName(k) === normName(t.list.name))?.[1];
        if (!m || m.role !== 'pipeline') continue;
        if (!m.reviewed) counts.unreviewedLists.push(t.list.name);
        const vehicle = vehicles.get(t.vehicleSlug);
        if (!vehicle) continue;
        const historical = vehicle.phase === 'historical';
        const latest = rawEntries.filter((r) => r.payload.listId === t.list.id);
        const asOf = latest.reduce((a, r) => (r.fetchedAt > a ? r.fetchedAt : a), new Date(0));
        const doc = `affinity:list:${t.list.id}`;
        await tx.query(
          `insert into research.source_doc (doc_id, title, kind, origin, as_of, strength, supports, body)
           values ($1,$2,'crm','Affinity',$3,'weak'::research.doc_strength,$4,'')
           on conflict (doc_id) do update set title = excluded.title, as_of = excluded.as_of`,
          [doc, `Affinity list: ${t.list.name}`, asOf.toISOString().slice(0, 10),
            'What the team recorded on this Affinity list. The team’s own claims — never independent evidence, and never a signature.'],
        );

        for (const { payload: e, fetchedAt } of latest) {
          const field = (name: string | null) => (name ? (e.entity.fields ?? []).find((f) => f.name === name)?.value ?? null : null);
          const place = placeEntry(m, (name) => text(field(name)));
          if (place.map?.skip) { counts.skipped++; continue; }
          if (e.type === 'opportunity') { counts.skipped++; continue; }

          const kind = e.type === 'person' ? 'person' : 'org';
          const entity = await entityFor(tx, kind, `${e.type}:${e.entity.id}`, nameOf(e.entity), counts);

          // Where they work, from the list's own organization field — a contact, capacity not
          // established (identity.affil_kind), because a CRM row does not say who decides.
          if (e.type === 'person') {
            const current = companies(field('Current Organization'))[0] ?? companies(field('Organizations'))[0];
            if (current?.id) {
              const org = await entityFor(tx, 'org', `company:${current.id}`, current.name ?? 'unnamed organization', counts);
              const has = await tx.one<{ n: string }>(
                `select count(*)::text as n from identity.affiliation where person_entity = $1 and org_entity = $2 and ended_on is null`, [entity, org],
              );
              if (Number(has?.n ?? 0) === 0) {
                await tx.query(
                  `insert into identity.affiliation (person_entity, org_entity, kind, role, is_primary, source, as_of, certainty, note)
                   values ($1,$2,'contact'::identity.affil_kind,$3,true,$4,$5,'claimed','From the Affinity list; capacity not established.')`,
                  [entity, org, text(field('Current Job Title')) ?? 'not recorded', doc, fetchedAt.toISOString().slice(0, 10)],
                );
                counts.affiliations++;
              }
            }
          }

          const map = place.map;
          // Money first: an amount on the commitment field is a yes, unless the entry passed.
          const committed = num(field(m.commitment));
          const low = m.softRange ? num(field(m.softRange[0])) : null;
          const high = m.softRange ? num(field(m.softRange[1])) : null;
          const amount = committed ?? low ?? high;
          let status: PursuitStatus | null = map?.status ?? null;
          if (amount && status !== 'passed') status = 'committed';
          if (!status) counts.unplaced++;
          const passed = status === 'passed';
          const passReason = text(field(m.passReason));
          const reason = passed ? (passReason ? reasonOf(passReason) ?? map?.reason ?? 'other' : map?.reason ?? 'other') : null;
          const implied = [...new Set([...(map?.implies ?? []), ...(amount ? ['soft'] : [])])];
          const ownerRef = people(field(m.owner)).find((p) => p.type === 'internal');
          const owner = ownerRef ? teamByAffinity.get(ownerRef.id) : undefined;
          const ownerSaid = ownerRef ? nameOf(ownerRef) : null;
          if (ownerRef && !owner) counts.ownersNotOnTeam++;
          const ended = historical || passed;
          const saved = await tx.one<{ ours: boolean; closed: boolean }>(
            `insert into strategy.pursuit
               (entity_id, vehicle_id, owner_id, headline, status, passed_by, status_reason, status_source, implied,
                next_step, source, source_ref, source_as_of, stage_said, owner_said, closed_at, close_reason, status_said)
             values ($1,$2,$3,$4,coalesce($5, 'new')::strategy.pursuit_status,$6,$7,'affinity',$8::text[],$9,
                     'affinity',$10,$11,$12,$13,$14,$15,$5::strategy.pursuit_status)
             on conflict (entity_id, vehicle_id) do update set
               owner_id = excluded.owner_id, source_ref = excluded.source_ref, source_as_of = excluded.source_as_of,
               stage_said = excluded.stage_said, owner_said = excluded.owner_said, implied = excluded.implied,
               status_said = excluded.status_said,
               -- A status a person set here is theirs: Affinity's word is kept beside it, not over it.
               status = case when strategy.pursuit.status_source = 'affinity' and $5::text is not null then excluded.status else strategy.pursuit.status end,
               passed_by = case when strategy.pursuit.status_source = 'affinity' then excluded.passed_by else strategy.pursuit.passed_by end,
               status_reason = case when strategy.pursuit.status_source = 'affinity' then excluded.status_reason else strategy.pursuit.status_reason end,
               next_step = case when strategy.pursuit.status_source = 'affinity' then excluded.next_step else strategy.pursuit.next_step end,
               closed_at = case when strategy.pursuit.status_source = 'affinity' or $16 then excluded.closed_at else strategy.pursuit.closed_at end,
               close_reason = case when strategy.pursuit.status_source = 'affinity' or $16 then excluded.close_reason else strategy.pursuit.close_reason end
             where strategy.pursuit.source = 'affinity'
             returning (status_source = 'us') as ours, closed_at is not null as closed`,
            [
              entity, vehicle.id, owner ?? users.get(PLACEHOLDER)!, null, status, passed ? map?.passedBy ?? 'them' : null, reason,
              implied, map?.next ? `${map.next} (Affinity)` : null,
              `list:${t.list.id}:entry:${e.id}`, fetchedAt, place.said, owner ? null : ownerSaid,
              ended ? fetchedAt : null,
              historical ? 'The vehicle did not close.' : passed ? `Affinity: ${place.said}` : null,
              historical,
            ],
          );
          if (saved?.ours) counts.keptOurs++;
          counts.byStatus[status ?? 'unplaced'] = (counts.byStatus[status ?? 'unplaced'] ?? 0) + 1;
          counts.pursuits++;
          counts.byVehicle[vehicle.slug] = (counts.byVehicle[vehicle.slug] ?? 0) + 1;

          // Money. Soft, always: the source is the team's record of what an LP said.
          if (amount) {
            const signed = implied.includes('signed');
            if (signed) counts.readyToHarden++;
            const claim = [
              committed ? `${m.commitment}` : `soft circle ${low ?? '?'}–${high ?? '?'} (the lower end counted)`,
              place.said ? `Affinity says “${place.said}”` : null,
              signed ? 'ready to harden once countersigned' : null,
            ].filter(Boolean).join(' · ');
            const xrow = await tx.one<{ exposure_id: string }>(
              `insert into pipeline.exposure
                 (entity_id, vehicle_id, instrument, track, amount, owner_id, source, source_ref, source_as_of, claim, closed_at)
               values ($1,$2,$3::pipeline.instrument,'soft',$4,$5,'affinity',$6,$7,$8,$9)
               on conflict (entity_id, vehicle_id, instrument) do update set
                 amount = excluded.amount, owner_id = excluded.owner_id, source_ref = excluded.source_ref,
                 source_as_of = excluded.source_as_of, claim = excluded.claim, closed_at = excluded.closed_at
               where pipeline.exposure.source = 'affinity' and pipeline.exposure.track = 'soft'
               returning exposure_id`,
              [
                entity, vehicle.id, vehicle.kind === 'spv' ? 'spv' : 'lp_commitment', amount, owner ?? users.get(PLACEHOLDER)!,
                `list:${t.list.id}:entry:${e.id}`, fetchedAt, `Affinity: ${claim}`,
                // Closed with the pursuit: on history, or passed — by Affinity's word or ours.
                (saved ? saved.closed : ended) ? fetchedAt : null,
              ],
            );
            counts.exposures++;
            // The close track (N52): what the word says happened to the money, as Affinity's
            // undated claim — kept while Affinity still says it, and moving nothing.
            if (xrow) {
              const claimed = (['signed', 'wired'] as const).filter((step) => implied.includes(step));
              await tx.query(
                `delete from pipeline.commitment_event where exposure_id = $1 and source = 'affinity' and not (step::text = any($2::text[]))`,
                [xrow.exposure_id, claimed],
              );
              for (const step of claimed) {
                await tx.query(
                  `insert into pipeline.commitment_event (exposure_id, step, occurred_on, document, source, source_ref)
                   values ($1, $2::pipeline.commitment_step, null, $3, 'affinity', $4)
                   on conflict (source, source_ref) where source_ref is not null do nothing`,
                  [xrow.exposure_id, step, `Affinity: “${place.said}”`, `list:${t.list.id}:entry:${e.id}:${step}`],
                );
              }
            }
          }

          // Claims about them, with the list as the source: kept once, superseded on change.
          for (const [fieldName, key, confidence] of [[m.checkSize, 'typical_check_usd', 'low'], [m.aum, 'aum_usd', 'low']] as const) {
            const value = num(field(fieldName));
            if (!value) continue;
            const current = await tx.one<{ claim_id: string; value: string }>(
              `select claim_id, value from research.claim where entity_id = $1 and field = $2 and source = $3 and superseded_by is null`,
              [entity, key, doc],
            );
            if (current?.value === String(value)) continue;
            const row = await tx.one<{ claim_id: string }>(
              `insert into research.claim (entity_id, field, value, source, as_of, confidence)
               values ($1,$2,$3,$4,$5,$6::research.confidence) returning claim_id`,
              [entity, key, String(value), doc, fetchedAt.toISOString().slice(0, 10), confidence],
            );
            if (current) await tx.query(`update research.claim set superseded_by = $2 where claim_id = $1`, [current.claim_id, row!.claim_id]);
            counts.claims++;
          }

          // Do not contact: an instruction about the target, checked on every route (rule 8).
          if (/^(yes|true|y)$/i.test(text(field(m.doNotContact)) ?? '')) {
            const has = await tx.one<{ n: string }>(
              `select count(*)::text as n from coordination.restriction where entity_id = $1 and scope = 'blanket' and source = $2`, [entity, doc],
            );
            if (Number(has?.n ?? 0) === 0) {
              await tx.query(
                `insert into coordination.restriction (entity_id, scope, instruction, source)
                 values ($1,'blanket'::coordination.restriction_scope,$2,$3)`,
                [entity, `Marked “${m.doNotContact}”: yes, on the Affinity list “${t.list.name}”. Do not approach, by any route.`, doc],
              );
              counts.restrictions++;
            }
          }
        }
      }

      counts.touchpoints = await touchpoints(tx, rawEntries.map((r) => r.payload), rawNotes.map((r) => r.payload), init.team, users, users.get(PLACEHOLDER)!);

      await tx.query(
        `update platform.source_sync set status = 'ok', last_sync_at = now(), detail = $1 where source = 'affinity'`,
        [`Read-only · ${counts.pursuits} pursuits translated across ${Object.keys(counts.byVehicle).length} vehicles${counts.unreviewedLists.length ? ' · mapping not reviewed' : ''}`],
      );
    });

    await finishRun(run, {
      status: 'ok', requests: 0, records: counts.pursuits, newRecords: counts.people + counts.organizations,
      note: `${counts.pursuits} pursuits · ${counts.exposures} soft commitments · ${counts.claims} claims · ${counts.restrictions} do-not-approach · ${counts.touchpoints} new touchpoints${counts.unplaced ? ` · ${counts.unplaced} with no status` : ''}`,
      detail: { ...counts, profile: config.data.profile },
    });
  } catch (err) {
    await finishRun(run, { status: 'failed', requests: 0, records: counts.pursuits, newRecords: 0, note: err instanceof Error ? err.message : 'unknown error', detail: { ...counts } });
  }
  return latestRun(SOURCE, 'translate');
}

// ---------------------------------------------------------------- touchpoints (N51)

interface InteractionPerson { type?: string; firstName?: string | null; lastName?: string | null; primaryEmailAddress?: string | null }
interface Interaction {
  type: 'email' | 'meeting' | 'call' | 'chat-message';
  id: number;
  sentAt?: string;
  startTime?: string;
  from?: { emailAddress?: string; person?: InteractionPerson } | null;
  attendees?: Array<{ emailAddress?: string; person?: InteractionPerson }>;
}

const CHANNEL_OF: Record<Interaction['type'], string> = { email: 'email', meeting: 'meeting', call: 'call', 'chat-message': 'message' };

/**
 * The log, from what Affinity already knows (N51, docs/17): each list entry's interaction dates
 * (last email, last and next meeting…), and each meeting, call or email note attached to
 * someone in the tool. Keyed by the interaction, so a meeting that has both a calendar entry and
 * a note is one touchpoint; the calendar's date wins over the note's.
 *
 * Nothing is copied that the notes page already holds: no subject line, no note text, no
 * outside attendee's name. A touchpoint read from Affinity is tied to no vehicle, because
 * Affinity's interactions are not; it counts for every open pursuit of that LP, and says so.
 */
async function touchpoints(
  tx: Queryable, entries: E[], notes: AffinityNote[], team: Array<{ handle: string; email?: string | null; affinityEmail?: string | null }>,
  users: Map<string, string>, placeholder: string,
): Promise<number> {
  const ours = new Map((await tx.query<{ source_id: string; entity_id: string }>(
    `select source_id, entity_id from identity.source_record where source = $1`, [SOURCE],
  )).map((r) => [r.source_id, r.entity_id]));
  const byEmail = new Map<string, string>();
  for (const t of team) {
    const id = users.get(t.handle);
    if (!id) continue;
    for (const e of [t.email, t.affinityEmail]) if (e) byEmail.set(e.toLowerCase(), id);
  }
  const who = (p?: InteractionPerson | null, email?: string) => {
    const e = (p?.primaryEmailAddress ?? email ?? '').toLowerCase();
    return e ? byEmail.get(e) : undefined;
  };
  const now = Date.now();
  let added = 0;
  const put = async (row: {
    entity: string; ref: string; channel: string; at: string; direction: string | null; owner: string;
    attendees: string[]; exact: boolean;
  }) => {
    const future = new Date(row.at).getTime() > now;
    const r = await tx.query<{ meeting_id: string }>(
      `insert into meetings.meeting
         (entity_id, vehicle_id, channel, direction, held_on, scheduled_for, owner_id, attendees, source, source_ref)
       values ($1, null, $2::meetings.channel, $3, $4, $5, $6, $7, 'affinity', $8)
       on conflict (source, source_ref) where source_ref is not null do ${row.exact
         ? 'update set held_on = excluded.held_on, scheduled_for = excluded.scheduled_for, attendees = excluded.attendees'
         : 'nothing'}
       returning (xmax = 0) as fresh`,
      [row.entity, row.channel, row.direction, future ? null : row.at.slice(0, 10), future ? row.at : null,
       row.owner, row.attendees, row.ref],
    );
    if ((r[0] as unknown as { fresh?: boolean } | undefined)?.fresh) added++;
  };

  // A list entry's interaction dates: exact, from Affinity's calendar and mail sync.
  for (const e of entries) {
    const key = `${e.type}:${e.entity.id}`;
    const entity = ours.get(key);
    if (!entity) continue;
    for (const f of e.entity.fields ?? []) {
      if (f.value?.type !== 'interaction' || !f.value.data) continue;
      const d = f.value.data as Interaction;
      const at = d.sentAt ?? d.startTime;
      if (!at || !CHANNEL_OF[d.type]) continue;
      const internal = (d.attendees ?? []).map((a) => a.person).filter((p): p is InteractionPerson => p?.type === 'internal');
      await put({
        entity, ref: `interaction:${d.type}:${d.id}:${key}`, channel: CHANNEL_OF[d.type], at, exact: true,
        direction: d.type === 'email' || d.type === 'chat-message'
          ? d.from?.person?.type === 'internal' ? 'ours' : d.from?.person?.type === 'external' ? 'theirs' : null
          : 'both',
        owner: who(d.from?.person, d.from?.emailAddress) ?? internal.map((p) => who(p)).find(Boolean) ?? placeholder,
        attendees: internal.map((p) => [p.firstName, p.lastName].filter(Boolean).join(' ')).filter(Boolean),
      });
    }
  }

  // Notes on an interaction: the note's date stands in for the interaction's, until the
  // calendar says otherwise. Every attached person and firm that is in the tool gets one.
  for (const n of notes) {
    const i = n.type === 'ai-notetaker' ? { type: 'meeting' as const, id: n.interaction?.id } : n.type === 'interaction' ? n.interaction : undefined;
    if (!i?.id || !CHANNEL_OF[i.type]) continue;
    const attached = [
      ...(n.personsPreview?.data ?? []).map((p) => `person:${p.id}`),
      ...(n.companiesPreview?.data ?? []).map((c) => `company:${c.id}`),
    ];
    for (const key of attached) {
      const entity = ours.get(key);
      if (!entity) continue;
      await put({
        entity, ref: `interaction:${i.type}:${i.id}:${key}`, channel: CHANNEL_OF[i.type], at: n.createdAt, exact: false,
        direction: i.type === 'meeting' || i.type === 'call' ? 'both' : null,
        owner: who(n.creator) ?? placeholder, attendees: [],
      });
    }
  }
  return added;
}

