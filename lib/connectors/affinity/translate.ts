import { config } from '@/config/deployment';
import { getDb, type Queryable } from '@/lib/db';
import { finishRun, latestRaw, latestRun, startRun, type SyncRun } from '@/modules/sources';
import { discovered, initForMatching, type AffinityUser } from './discover';
import { inventory } from './inventory';
import { placeEntry, readMapping, reasonOf, type ListMapping } from './mapping';
import { normName } from './match';
import { sliceTargets } from './slice';

/**
 * Translation (N47, docs/16 §4): the landed copy, read through the mapping, into the tool's
 * own tables. Local only — not one request to Affinity — and re-runnable: a mapping edit takes
 * effect on the next run, and running twice changes nothing the second time.
 *
 * What it writes, and the rule each follows:
 *   people and organizations   identity.entity, joined to Affinity by source_record
 *   pursuits                   our stage, outcome and reason, and what Affinity itself said —
 *                              a claim beside the ladder, never a ladder event (rule 2)
 *   commitments                soft, always; "signed" marks one ready to harden (rule 1)
 *   check size, AUM            research claims with the list as their source (rule 9)
 *   do not contact             a blanket do-not-approach restriction (rule 8)
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
  unplaced: number;
  skipped: number;
  exposures: number;
  readyToHarden: number;
  claims: number;
  restrictions: number;
  ownersNotOnTeam: number;
  unreviewedLists: string[];
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
    people: 0, organizations: 0, affiliations: 0, pursuits: 0, byVehicle: {}, unplaced: 0, skipped: 0,
    exposures: 0, readyToHarden: 0, claims: 0, restrictions: 0, ownersNotOnTeam: 0, unreviewedLists: [],
  };
  try {
    const [inv, init, found, targets, rawEntries] = await Promise.all([
      inventory(), initForMatching(), discovered(), sliceTargets(), latestRaw<E>(SOURCE, 'list_entry'),
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
          if (!map) counts.unplaced++;
          const outcome = map?.outcome ?? 'open';
          const passed = text(field(m.passReason));
          const reason = outcome === 'passed' || outcome === 'lost' ? (passed ? reasonOf(passed) ?? map?.reason ?? 'other' : map?.reason ?? null) : null;
          const ownerRef = people(field(m.owner)).find((p) => p.type === 'internal');
          const owner = ownerRef ? teamByAffinity.get(ownerRef.id) : undefined;
          const ownerSaid = ownerRef ? nameOf(ownerRef) : null;
          if (ownerRef && !owner) counts.ownersNotOnTeam++;
          await tx.query(
            `insert into strategy.pursuit
               (entity_id, vehicle_id, owner_id, headline, stage, outcome, outcome_reason, source, source_ref,
                source_as_of, stage_said, owner_said, closed_at, close_reason)
             values ($1,$2,$3,$4,$5::strategy.pursuit_stage,$6::strategy.pursuit_outcome,$7,'affinity',$8,$9,$10,$11,$12,$13)
             on conflict (entity_id, vehicle_id) do update set
               owner_id = excluded.owner_id, stage = excluded.stage, outcome = excluded.outcome,
               outcome_reason = excluded.outcome_reason, source_ref = excluded.source_ref,
               source_as_of = excluded.source_as_of, stage_said = excluded.stage_said,
               owner_said = excluded.owner_said, closed_at = excluded.closed_at, close_reason = excluded.close_reason
             where strategy.pursuit.source = 'affinity'`,
            [
              entity, vehicle.id, owner ?? users.get(PLACEHOLDER)!, null, map?.stage ?? null, outcome, reason,
              `list:${t.list.id}:entry:${e.id}`, fetchedAt, place.said, owner ? null : ownerSaid,
              historical || outcome === 'passed' || outcome === 'lost' ? fetchedAt : null,
              historical ? 'The vehicle did not close.' : outcome === 'passed' || outcome === 'lost' ? `Affinity: ${place.said}` : null,
            ],
          );
          counts.pursuits++;
          counts.byVehicle[vehicle.slug] = (counts.byVehicle[vehicle.slug] ?? 0) + 1;

          // Money. Soft, always: the source is the team's record of what an LP said.
          const committed = num(field(m.commitment));
          const low = m.softRange ? num(field(m.softRange[0])) : null;
          const high = m.softRange ? num(field(m.softRange[1])) : null;
          const amount = committed ?? low ?? high;
          if (amount) {
            const signed = map?.stage === 'signed';
            if (signed) counts.readyToHarden++;
            const claim = [
              committed ? `${m.commitment}` : `soft circle ${low ?? '?'}–${high ?? '?'} (the lower end counted)`,
              place.said ? `stage said “${place.said}”` : null,
              signed ? 'ready to harden once countersigned' : null,
            ].filter(Boolean).join(' · ');
            await tx.query(
              `insert into pipeline.exposure
                 (entity_id, vehicle_id, instrument, track, amount, owner_id, source, source_ref, source_as_of, claim, closed_at)
               values ($1,$2,$3::pipeline.instrument,'soft',$4,$5,'affinity',$6,$7,$8,$9)
               on conflict (entity_id, vehicle_id, instrument) do update set
                 amount = excluded.amount, owner_id = excluded.owner_id, source_ref = excluded.source_ref,
                 source_as_of = excluded.source_as_of, claim = excluded.claim, closed_at = excluded.closed_at
               where pipeline.exposure.source = 'affinity' and pipeline.exposure.track = 'soft'`,
              [
                entity, vehicle.id, vehicle.kind === 'spv' ? 'spv' : 'lp_commitment', amount, owner ?? users.get(PLACEHOLDER)!,
                `list:${t.list.id}:entry:${e.id}`, fetchedAt, `Affinity: ${claim}`,
                historical || outcome === 'passed' || outcome === 'lost' ? fetchedAt : null,
              ],
            );
            counts.exposures++;
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

      await tx.query(
        `update platform.source_sync set status = 'ok', last_sync_at = now(), detail = $1 where source = 'affinity'`,
        [`Read-only · ${counts.pursuits} pursuits translated across ${Object.keys(counts.byVehicle).length} vehicles${counts.unreviewedLists.length ? ' · mapping not reviewed' : ''}`],
      );
    });

    await finishRun(run, {
      status: 'ok', requests: 0, records: counts.pursuits, newRecords: counts.people + counts.organizations,
      note: `${counts.pursuits} pursuits · ${counts.exposures} soft commitments · ${counts.claims} claims · ${counts.restrictions} do-not-approach${counts.unplaced ? ` · ${counts.unplaced} with no stage` : ''}`,
      detail: { ...counts, profile: config.data.profile },
    });
  } catch (err) {
    await finishRun(run, { status: 'failed', requests: 0, records: counts.pursuits, newRecords: 0, note: err instanceof Error ? err.message : 'unknown error', detail: { ...counts } });
  }
  return latestRun(SOURCE, 'translate');
}
