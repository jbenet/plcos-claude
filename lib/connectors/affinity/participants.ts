import type { Queryable } from '@/lib/db';
import { resolveEntity } from '@/modules/identity/create';

export interface PersonIdentity {
  id?: number;
  type?: string;
  primaryEmailAddress?: string | null;
  emailAddresses?: string[];
  firstName?: string | null;
  lastName?: string | null;
  linkedinUrl?: string | null;
  linkedin_url?: string | null;
  linkedin?: string | null;
  /** Local replica timestamp, supplied by translation; never an API field. */
  replicaAsOf?: string;
  fields?: Array<{ name: string; value: { type: string; data: unknown } | null }>;
}
export interface Participant { emailAddress?: string | null; person?: PersonIdentity | null }
const normalized = (s?: string | null) => s?.trim().toLowerCase() || '';
const emails = (p: PersonIdentity) => [...new Set([p.primaryEmailAddress, ...(p.emailAddresses ?? [])].map(normalized).filter(Boolean))];

/** Explicit replica evidence for the shared creation resolver. */
export function affinityIdentityEvidence(p: PersonIdentity): { domains?: string[]; organizations?: string[]; personalUrls?: string[] } {
  const fields = p.fields ?? [];
  const orgValue = fields.find(f => f.name === 'Current Organization')?.value?.data
    ?? fields.find(f => f.name === 'Organizations')?.value?.data;
  const orgs = (Array.isArray(orgValue) ? orgValue : orgValue ? [orgValue] : []) as Array<{ name?: string }>;
  return {
    domains: emails(p),
    organizations: orgs.map(o => o.name).filter((name): name is string => !!name),
    personalUrls: [p.linkedinUrl, p.linkedin_url, p.linkedin].filter((url): url is string => !!url).concat(
      fields.filter(f => /linkedin|personal.*(?:url|website)/i.test(f.name))
        .flatMap(f => typeof f.value?.data === 'string' ? [f.value.data] : [])),
  };
}
const personName = (p: PersonIdentity) => [p.firstName, p.lastName].filter(Boolean).join(' ') || 'Unnamed Affinity contact';

/** Exact IDs and unambiguous full addresses only. Neither a name nor a domain identifies a person. */
export async function participantIndex(tx: Queryable, persons: PersonIdentity[]) {
  const rows = await tx.query<{ source_id: string; entity_id: string }>(
    `select source_id, identity.canonical_entity_id(entity_id) as entity_id
       from identity.source_record where source = 'affinity'`);
  const byId = new Map(rows.filter(r => r.entity_id).map(r => [r.source_id, r.entity_id]));
  // Build full-address components before linking: order cannot hide a conflicting identity
  // behind an unbound alias, or require several translation passes for an alias chain.
  const parent = new Map<string, string>();
  const root = (value: string): string => {
    if (!parent.has(value)) parent.set(value, value);
    let r = value;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let n = value;
    while (parent.get(n) !== r) { const next = parent.get(n)!; parent.set(n, r); n = next; }
    return r;
  };
  for (const p of persons) {
    if (!p.id || p.type === 'internal') continue;
    const id = `person:${p.id}`;
    if (byId.has(id)) continue;
    for (const email of emails(p)) parent.set(root(`email:${email}`), root(id));
  }
  const components = new Map<string, Set<string>>();
  for (const p of persons) {
    const entity = byId.get(`person:${p.id}`);
    if (!entity) continue;
    for (const email of emails(p)) {
      const r = root(`email:${email}`), ids = components.get(r) ?? new Set<string>();
      ids.add(entity); components.set(r, ids);
    }
  }
  const addresses = new Map<string, Set<string>>();
  for (const key of parent.keys()) if (key.startsWith('email:')) addresses.set(key.slice(6), components.get(root(key)) ?? new Set());
  const denied = await tx.query<{ left_source_id: string; right_source_id: string }>(
    `select left_source_id, right_source_id from identity.match_assertion
      where kind = 'not_same_as' and undone_at is null
        and left_source = 'affinity' and right_source = 'affinity'`);
  const blocked = (key: string, entity: string) => denied.some(r =>
    r.left_source_id === key && byId.get(r.right_source_id) === entity ||
    r.right_source_id === key && byId.get(r.left_source_id) === entity);
  // A rejected alias cannot act as an indirect address bridge for a third person.
  // Quarantine the component's email evidence; explicit source-ID bindings remain intact.
  const quarantined = new Set<string>();
  for (const r of denied) {
    for (const [key, other] of [[r.left_source_id, r.right_source_id], [r.right_source_id, r.left_source_id]]) {
      if (!parent.has(key)) continue;
      const component = root(key), entity = byId.get(other);
      if (entity && components.get(component)?.has(entity)) quarantined.add(component);
    }
  }
  const quarantinedEmails = new Set([...addresses.keys()].filter(email => quarantined.has(root(`email:${email}`))));
  const exactEmail = (values: string[]) => {
    if (values.some(e => quarantinedEmails.has(e))) return undefined;
    const ids = new Set(values.flatMap(e => [...(addresses.get(e) ?? [])]));
    return ids.size === 1 ? [...ids][0] : undefined;
  };
  // New raw persons may arrive after their old interactions. Rebuild this index on every
  // translation and replay all landed interactions; no creation-date cutoff in translation.
  for (const p of persons) {
    if (!p.id || p.type === 'internal') continue;
    const key = `person:${p.id}`;
    if (byId.has(key)) continue; // Never silently merge two already-resolved entities.
    const entity = exactEmail(emails(p));
    if (!entity || blocked(key, entity)) continue;
    const resolved = await resolveEntity(tx, { type: 'person', name: personName(p), source: 'affinity', sourceId: key,
      ...affinityIdentityEvidence(p), resolvedBy: 'rule:affinity-id' });
    byId.set(key, resolved.id);
  }
  // Pursued organizations retain contact-person histories through an explicit affiliation.
  // Do not turn today's employer into a claim that the firm attended a historical meeting.
  const latestPeople = new Map<number, PersonIdentity>();
  for (const p of persons) if (p.id) {
    const prior = latestPeople.get(p.id);
    latestPeople.set(p.id, { ...prior, ...p, fields: p.fields ?? prior?.fields });
  }
  for (const p of latestPeople.values()) {
    if (!p.id || p.type === 'internal') continue;
    const current = p.fields?.find(f => f.name === 'Current Organization')?.value?.data;
    const data = current ?? p.fields?.find(f => f.name === 'Organizations')?.value?.data;
    const orgs = (Array.isArray(data) ? data : data ? [data] : []) as Array<{ id?: number }>;
    const known = orgs.map(o => byId.get(`company:${o.id}`)).filter((id): id is string => !!id);
    if (!known.length) continue;
    const key = `person:${p.id}`;
    let contact = byId.get(key);
    if (!contact) {
      const evidence = affinityIdentityEvidence(p);
      if (!evidence.organizations?.length) {
        evidence.organizations = (await tx.query<{ name: string }>(
          'select display_name name from identity.entity where entity_id=any($1::uuid[])', [known])).map(o => o.name);
      }
      contact = (await resolveEntity(tx, { type: 'person', name: personName(p), source: 'affinity', sourceId: key,
        ...evidence, resolvedBy: 'rule:affinity-id' })).id;
      byId.set(key, contact);
    }
    for (const org of new Set(known)) {
      if (contact === org) continue;
      await tx.query(`insert into identity.affiliation(person_entity,org_entity,kind,role,source,as_of,certainty,note)
        select $1,$2,'contact','not recorded',$3,coalesce($4::date,current_date),'claimed',
          'Affinity replica association; historical employer and decision-making capacity not established.'
        where not exists (select 1 from identity.affiliation where person_entity=$1 and org_entity=$2 and ended_on is null)`,
        [contact, org, `affinity:person:${p.id}`, p.replicaAsOf ?? null]);
    }
    for (const email of emails(p)) {
      const ids = addresses.get(email) ?? new Set<string>(); ids.add(contact); addresses.set(email, ids);
    }
  }
  addresses.clear();
  for (const p of persons) {
    const id = byId.get(`person:${p.id}`);
    if (!id) continue;
    for (const email of emails(p)) {
      const ids = addresses.get(email) ?? new Set<string>(); ids.add(id); addresses.set(email, ids);
    }
  }
  const person = (a: Participant): string | undefined => {
    const key = a.person?.id ? `person:${a.person.id}` : null;
    if (key && byId.has(key)) return byId.get(key);
    const entity = exactEmail([...emails(a.person ?? {}), normalized(a.emailAddress)].filter(Boolean));
    return entity && (!key || !blocked(key, entity)) ? entity : undefined;
  };
  return { byId, person };
}
