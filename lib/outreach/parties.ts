import { z } from 'zod';
import { can } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { aboutRaise, type AboutVehicle } from '@/lib/connectors/affinity/about';
import { AFFINITY_PERSON_EMAILS, firmsByDomain, NOT_A_PERSON, PL_DOMAINS, PUBLIC_MAIL } from '@/lib/calendar-sync';
import { notLpEntities } from '@/lib/calendar-candidates';
import { teamAddresses } from '@/lib/comms/read';
import type { AppUser } from '@/modules/platform';

/**
 * Check the parties the team emailed (Juan, 14 Oct 2026: a reconcile page "that checks all parties i've emailed, whether
 * they have PLCOS entries, whether vehicle info is correct, whether in affinity, whether the mails are in affinity …
 * the affinity check could go against PLCOS's local affinity copy"; the page lives in JuanMail, which holds all the mail,
 * and PLC OS answers for its records). Read-only: nothing is written and no Affinity request is made.
 *
 * For each address JuanMail sends, with the name its headers gave and when mail went to it (and the subject):
 *   - internal: the team, its own domains, the fundraising domains and Protocol Labs': nothing more is said;
 *   - onFile: who it is here: an email claim (never Dakota's), else a person in our copy of Affinity with that address;
 *   - pursuits: the vehicles they, their current firm, or an LP they are a contact for are in the pipeline of (only
 *     vehicles the caller reads);
 *   - raiseVehicles: the vehicles the mail to them was about (the subject, the vehicles' names and the fundraising domains,
 *     lib/connectors/affinity/about.ts), from mail with them on the To line: someone copied in is never pitched by it;
 *   - affinity: whether our copy of Affinity has a person with that address, and its last email with them (by day),
 *     against the last mail sent: covered when Affinity has one on or after it. The copy is as of copyAsOf;
 *   - issues and suggest: what the reconcile page can do. add_lp {vehicle} goes to outreach_add_lp (lib/outreach/lps.ts);
 *     research: an unknown person with no raise mail, for a person to look at; affinity_add_person / affinity_add_note:
 *     for the Affinity writes Juan approves by batch (outreach_propose_affinity_writes, lib/affinity-writes.ts). Never add_lp for a portfolio company of ours or a
 *     teammate, a vehicle not being raised, or the grants rail.
 */

const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
const email = z.string().max(254).transform((s) => s.trim().toLowerCase()).refine((s) => EMAIL.test(s), 'not an email address');
export const MAX_PARTIES = 200;

export const partiesInput = z.object({
  parties: z.array(z.object({
    address: email,
    name: z.string().trim().min(1).max(200).optional().describe('The display name the mail headers gave the address.'),
    sends: z.array(z.object({
      at: z.string().datetime({ offset: true }),
      subject: z.string().max(998).optional(),
      to: z.boolean().optional().describe('On the To line (default true); false when only copied in.'),
    }).strict()).min(1).max(500).describe('The mail sent to this address: when, and the subject.'),
  }).strict()).min(1).max(MAX_PARTIES),
}).strict();

export type PartyIssue = 'internal' | 'not_on_file' | 'no_pursuit' | 'not_in_affinity' | 'email_not_in_affinity';
export type PartySuggestion =
  | { action: 'add_lp'; vehicle: string; reason: string }
  | { action: 'research'; reason: string }
  | { action: 'affinity_add_person'; reason: string }
  | { action: 'affinity_add_note'; lastSent: string; reason: string };

const day = (d: Date | string) => new Date(d).toISOString().slice(0, 10);
const domainOf = (a: string) => a.slice(a.lastIndexOf('@') + 1);

export async function checkParties(u: AppUser, raw: Record<string, unknown>) {
  const a = raw as z.infer<typeof partiesInput>;
  const db = await getDb();
  // The reads that need only the call's own input start together (performance pass, 17 Oct 2026).
  const vehiclesRead = db.query<{ id: string; slug: string; name: string; aliases: string[]; phase: string; kind: string }>(
    `select id::text, slug, name, coalesce(aliases, '{}') aliases, phase, kind from platform.vehicle`);
  const notLpRead = notLpEntities(db);
  const copyRead = db.one<{ at: Date }>(`select max(finished_at) at from sources.sync_run where source = 'affinity' and kind in ('slice', 'history') and status in ('ok', 'held')`);
  for (const r of [vehiclesRead, notLpRead, copyRead]) r.catch(() => undefined);
  const team = await teamAddresses(db);
  let fundraise: string[] = [], firmNames: string[] = [];
  try {
    const init = (await (await import('@/lib/real/init')).readInit()).init;
    fundraise = init?.fundraiseDomains ?? [];
    firmNames = init?.firmNames ?? [];
  } catch { /* no init file: the vehicles' names still say */ }
  const oursDomains = new Set([...[...team.keys()].map(domainOf).filter((d) => !PUBLIC_MAIL.has(d)), ...fundraise, ...PL_DOMAINS].map((d) => d.toLowerCase()));
  const isOurs = (x: string) => team.has(x) || oursDomains.has(domainOf(x)) || NOT_A_PERSON.test(x);

  const vehicles = (await vehiclesRead).filter((v) => can(u, 'read', { vehicle: v.id }));
  const about: AboutVehicle[] = vehicles.map((v) => ({ slug: v.slug, name: v.name, aliases: v.aliases }));
  const slugOf = new Map(vehicles.map((v) => [v.id, v.slug]));
  const raising = new Set(vehicles.filter((v) => v.phase === 'active' && v.kind !== 'grant_rail').map((v) => v.slug));
  const partial = u.access !== 'admin' && u.vehicles !== null;

  // The same address twice in one call is one party: its sends together, the first name given.
  const merged = new Map<string, { address: string; name: string | null; sends: Array<{ at: string; subject?: string; to?: boolean }> }>();
  for (const p of a.parties) {
    const m = merged.get(p.address);
    if (m) { m.sends.push(...p.sends); m.name ??= p.name ?? null; } else merged.set(p.address, { address: p.address, name: p.name ?? null, sends: [...p.sends] });
  }
  const addresses = [...merged.keys()].filter((x) => !isOurs(x));

  const byClaim = new Map<string, string>();
  const byAffinity = new Map<string, string>();
  const affinityPeople = new Map<string, string | null>();
  // A portfolio company's people are never LPs, as on the calendar's candidates (red-team pass, 14 Oct 2026: a mail to
  // a founder about their own company's SPV suggested adding them to it). Unknown addresses go by their domain's firms.
  const orgsAtRead = firmsByDomain([...new Set(addresses.map((x) => x.slice(x.lastIndexOf('@') + 1)).filter((d) => !PUBLIC_MAIL.has(d)))], null, db);
  orgsAtRead.catch(() => undefined);
  if (addresses.length) {
    const [claims, affinity, held] = await Promise.all([
      db.query<{ a: string; id: string }>(`select distinct on (lower(trim(c.value))) lower(trim(c.value)) a, identity.canonical_entity_id(c.entity_id)::text id
        from research.claim c left join research.source_doc d on d.doc_id = c.source
       where c.superseded_by is null and c.field ~ '(^|\\.)email$' and lower(trim(c.value)) = any($1::text[])
         and c.source !~* '^dakota' and coalesce(d.origin, '') !~* 'dakota' order by lower(trim(c.value)), c.as_of desc nulls last`, [addresses]),
      db.query<{ email: string; id: string }>(`select distinct on (email) email, id from (${AFFINITY_PERSON_EMAILS}) x where email = any($1::text[])`, [addresses]),
      // Affinity holds the person when any person record in our copy has the address, linked to someone of ours or not.
      db.query<{ email: string; name: string | null }>(`select distinct on (lower(trim(e.v))) lower(trim(e.v)) email,
          nullif(trim(concat_ws(' ', r.payload->>'firstName', r.payload->>'lastName')), '') name
        from sources.raw_record r
        cross join lateral (select r.payload->>'primaryEmailAddress' v
                            union select jsonb_array_elements_text(case when jsonb_typeof(r.payload->'emailAddresses') = 'array' then r.payload->'emailAddresses' else '[]'::jsonb end)) e
       where r.source = 'affinity' and r.kind = 'person' and lower(trim(e.v)) = any($1::text[])
       order by lower(trim(e.v)), r.fetched_at desc`, [addresses]),
    ]);
    for (const r of claims) byClaim.set(r.a, r.id);
    for (const r of affinity) byAffinity.set(r.email, r.id);
    for (const r of held) affinityPeople.set(r.email, r.name);
  }
  const entities = [...new Set([...byClaim.values(), ...byAffinity.values()])];
  const names = new Map<string, string>();
  const pursuitsOf = new Map<string, Array<{ vehicle: string; status: string; via: 'self' | 'firm' | 'contact' }>>();
  const lastEmail = new Map<string, string>();
  const firmsOf = new Map<string, string[]>();
  if (entities.length) {
    // Each record through its aliases (identity.alias_ids; the ids here are canonical): an index probe, never
    // identity.canonical_entity_id() on every affiliation, pursuit, contact or meeting (performance pass, 17 Oct 2026).
    const [firms, named, pursuits, emails] = await Promise.all([
      // Never through a licensed (Dakota) employment row: a token is never licensed, and "their firm is in our pipeline"
      // would tell it where they work (red team, 17 Oct 2026).
      db.query<{ id: string; org: string }>(`select distinct identity.canonical_entity_id(a.person_entity)::text id, identity.canonical_entity_id(a.org_entity)::text org
        from identity.affiliation a where a.ended_on is null and coalesce(a.source, '') !~* '^dakota' and a.person_entity = any(identity.alias_ids($1::uuid[]))`, [entities]),
      db.query<{ id: string; name: string }>(`select entity_id::text id, display_name name from identity.entity where entity_id = any($1::uuid[])`, [entities]),
      db.query<{ id: string; vehicle_id: string; status: string; via: 'self' | 'firm' | 'contact' }>(`
        select identity.canonical_entity_id(p.entity_id)::text id, p.vehicle_id::text, p.status::text status, 'self' via from strategy.active_pursuit p
         where p.entity_id = any(identity.alias_ids($1::uuid[]))
        union select identity.canonical_entity_id(a.person_entity)::text, p.vehicle_id::text, p.status::text, 'firm' from identity.affiliation a
          join strategy.active_pursuit p on p.entity_id = any(identity.alias_ids(array[identity.canonical_entity_id(a.org_entity)]))
         where a.ended_on is null and coalesce(a.source, '') !~* '^dakota' and a.person_entity = any(identity.alias_ids($1::uuid[]))
        union select identity.canonical_entity_id(c.person_entity)::text, p.vehicle_id::text, p.status::text, 'contact' from strategy.pursuit_contact c
          join strategy.active_pursuit p on p.pursuit_id = c.pursuit_id where c.person_entity = any(identity.alias_ids($1::uuid[]))`, [entities]),
      db.query<{ id: string; d: string }>(`select identity.canonical_entity_id(entity_id)::text id, max(held_on)::text d from meetings.meeting
        where source = 'affinity' and channel = 'email' and entity_id = any(identity.alias_ids($1::uuid[])) group by 1`, [entities]),
    ]);
    for (const r of firms) firmsOf.set(r.id, [...(firmsOf.get(r.id) ?? []), r.org]);
    for (const r of named) names.set(r.id, r.name);
    for (const r of pursuits) {
      const slug = slugOf.get(r.vehicle_id);
      if (!slug) continue;
      pursuitsOf.set(r.id, [...(pursuitsOf.get(r.id) ?? []), { vehicle: slug, status: r.status, via: r.via }]);
    }
    for (const r of emails) lastEmail.set(r.id, r.d);
  }
  const [notLp, orgsAt, copy] = await Promise.all([notLpRead, orgsAtRead, copyRead]);
  const onlyNotLp = (ids: string[]) => ids.length > 0 && ids.every((id) => notLp.has(id));
  const copyAsOf = copy?.at ? new Date(copy.at).toISOString() : null;

  const parties = [...merged.values()].map((p) => {
    // By instant: a Date header carries the sender's own offset, so the text order is not the time order.
    const sends = [...p.sends].sort((x, y) => Date.parse(x.at) - Date.parse(y.at));
    const lastSent = day(sends.at(-1)!.at);
    if (isOurs(p.address)) return { address: p.address, internal: true, issues: ['internal'] as PartyIssue[], suggest: [] as PartySuggestion[] };
    const raise = new Set<string>();
    for (const s of sends) {
      if (s.to === false) continue;
      const ab = aboutRaise(s.subject ?? '', [p.address], about, fundraise, firmNames);
      if (ab.about === 'raise') for (const v of ab.vehicles) raise.add(v);
    }
    const entityId = byClaim.get(p.address) ?? byAffinity.get(p.address) ?? null;
    const pursuits = entityId ? (pursuitsOf.get(entityId) ?? []).sort((x, y) => x.vehicle.localeCompare(y.vehicle) || x.via.localeCompare(y.via)) : [];
    // Affinity's emails sit on the person its record links to, which can be another (unmerged) person than the claim's.
    const linked = byAffinity.get(p.address);
    const last = [entityId, linked].map((id) => (id ? lastEmail.get(id) : undefined)).filter((d): d is string => Boolean(d)).sort().at(-1) ?? null;
    const person = affinityPeople.has(p.address) || byAffinity.has(p.address);
    const covered = person ? Boolean(last && last >= lastSent) : null;
    const raiseVehicles = [...raise].sort();
    // A reader without every vehicle learns that an address is on file, not whom it names or Affinity's record of
    // them, unless they read a pursuit of theirs (as self, firm or contact) (red team, 17 Oct 2026).
    const withheld = partial && !pursuits.length;
    const issues: PartyIssue[] = [];
    const suggest: PartySuggestion[] = [];
    if (!entityId) issues.push('not_on_file');
    const lpOk = entityId ? !notLp.has(entityId) && !onlyNotLp(firmsOf.get(entityId) ?? [])
      : !onlyNotLp(orgsAt.get(p.address.slice(p.address.lastIndexOf('@') + 1)) ?? []);
    const missing = raiseVehicles.filter((v) => raising.has(v) && !pursuits.some((x) => x.vehicle === v));
    if (lpOk && missing.length) {
      issues.push('no_pursuit');
      for (const v of missing) suggest.push({ action: 'add_lp', vehicle: v, reason: 'Mail to them was about this raise and they are in nobody\'s pipeline for it.' });
    }
    if (!entityId && !raiseVehicles.length) suggest.push({ action: 'research', reason: 'Not on file, and no mail to them was about a raise.' });
    if (!person) {
      issues.push('not_in_affinity');
      suggest.push({ action: 'affinity_add_person', reason: 'No person in Affinity has this address.' });
      suggest.push({ action: 'affinity_add_note', lastSent, reason: 'Affinity has no email with them.' });
    } else if (!covered) {
      issues.push('email_not_in_affinity');
      suggest.push({ action: 'affinity_add_note', lastSent, reason: last && !withheld ? `Affinity's last email with them is ${last}.` : last ? 'Affinity\'s last email with them is older than the last mail sent.' : 'Affinity has no email with them.' });
    }
    return {
      address: p.address, internal: false, name: p.name ?? (withheld ? null : affinityPeople.get(p.address) ?? null),
      sends: sends.length, firstSent: day(sends[0].at), lastSent,
      onFile: entityId ? withheld ? { known: true as const } : { entityId, name: names.get(entityId) ?? null, matchedBy: byClaim.has(p.address) ? 'claim' : 'affinity' } : null,
      pursuits, raiseVehicles,
      affinity: { person, name: withheld ? null : affinityPeople.get(p.address) ?? null, lastEmail: withheld ? null : last, covered },
      issues, suggest,
    };
  });
  const count = (i: PartyIssue) => parties.filter((p) => p.issues.includes(i)).length;
  return { data: {
    parties,
    counts: { parties: parties.length, internal: count('internal'), notOnFile: count('not_on_file'), noPursuit: count('no_pursuit'),
      notInAffinity: count('not_in_affinity'), emailNotInAffinity: count('email_not_in_affinity') },
    affinityCopyAsOf: copyAsOf,
    note: 'Read-only; no Affinity request is made. affinity.* is PLC OS\'s copy of Affinity as of affinityCopyAsOf (refreshed daily). covered compares Affinity\'s last email with them to the last mail sent, by day. pursuits and add_lp cover only the vehicles you can read; add an LP with outreach_add_lp.',
  } };
}
