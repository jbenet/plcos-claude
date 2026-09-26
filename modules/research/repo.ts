import { getDb } from '@/lib/db';
import type { Claim, Confidence, DocStrength, Note, SourceDoc } from './types';

type DocRow = {
  doc_id: string; title: string; kind: string; origin: string;
  as_of: Date | string; strength: DocStrength; supports: string; body: string;
};

const toDoc = (r: DocRow): SourceDoc => ({
  docId: r.doc_id, title: r.title, kind: r.kind, origin: r.origin,
  asOf: new Date(r.as_of), strength: r.strength, supports: r.supports, body: r.body,
});

export async function listSourceDocs(ids?: string[]): Promise<SourceDoc[]> {
  const db = await getDb();
  if (ids?.length === 0) return [];
  return (await db.query<DocRow>(`select * from research.source_doc
    ${ids ? 'where doc_id = any($1::text[])' : ''} order by doc_id`, ids ? [ids] : [])).map(toDoc);
}

export async function getSourceDoc(docId: string): Promise<SourceDoc | null> {
  const db = await getDb();
  const row = await db.one<DocRow>('select * from research.source_doc where doc_id = $1', [docId]);
  return row ? toDoc(row) : null;
}

type ClaimRow = {
  claim_id: string; entity_id: string; field: string; value: string;
  source: string; as_of: Date | string; confidence: Confidence;
  verified_by_name: string | null; last_verified_at: Date | string | null;
  superseded_by: string | null;
};

const toClaim = (r: ClaimRow): Claim => ({
  claimId: r.claim_id,
  entityId: r.entity_id,
  field: r.field,
  value: r.value,
  provenance: {
    source: r.source,
    asOf: new Date(r.as_of),
    confidence: r.confidence,
    lastVerifiedBy: r.verified_by_name,
    lastVerifiedAt: r.last_verified_at ? new Date(r.last_verified_at) : null,
  },
  supersededBy: r.superseded_by,
});

const CLAIM_SELECT = `
  select c.claim_id, identity.canonical_entity_id(c.entity_id) as entity_id, c.field, c.value, c.source, c.as_of, c.confidence,
         c.last_verified_at, c.superseded_by, u.name as verified_by_name
    from research.claim c
    left join platform.app_user u on u.id = c.last_verified_by`;

export async function claimsFor(entityId: string): Promise<Claim[]> {
  const db = await getDb();
  const rows = await db.query<ClaimRow>(
    `${CLAIM_SELECT} where identity.canonical_entity_id(c.entity_id) = identity.canonical_entity_id($1::uuid) and c.superseded_by is null order by c.field`,
    [entityId],
  );
  return rows.map(toClaim);
}

export async function claimCounts(entityIds?: string[]): Promise<Map<string, number>> {
  if (entityIds?.length === 0) return new Map();
  const db = await getDb();
  const rows = await db.query<{ entity_id: string; n: string }>(
    entityIds ? `with recursive aliases as (
      select identity.canonical_entity_id(id) as entity_id, identity.canonical_entity_id(id) as canonical_id
        from unnest($1::uuid[]) id
      union
      select e.entity_id, a.canonical_id from identity.entity e join aliases a on e.merged_into = a.entity_id
    )
    select a.canonical_id as entity_id, count(*)::text as n
      from aliases a join research.claim c on c.entity_id = a.entity_id
      where c.superseded_by is null group by a.canonical_id`
      : 'select identity.canonical_entity_id(entity_id) as entity_id, count(*)::text as n from research.claim where superseded_by is null group by identity.canonical_entity_id(entity_id)',
    entityIds ? [[...new Set(entityIds)]] : [],
  );
  return new Map(rows.map((r) => [r.entity_id, Number(r.n)]));
}

export async function activeClaimCount(): Promise<number> {
  const row = await (await getDb()).one<{ n: string }>(
    'select count(*)::text as n from research.claim where superseded_by is null');
  return Number(row?.n ?? 0);
}

/** Claims whose only support is a weak document — the ones a brief must not lean on. */
export async function weaklySupportedCount(): Promise<number> {
  const db = await getDb();
  const row = await db.one<{ n: string }>(
    `select count(*)::text as n from research.claim c
       join research.source_doc d on d.doc_id = c.source
      where d.strength = 'weak' and c.superseded_by is null`,
  );
  return Number(row?.n ?? 0);
}

export async function unverifiedCount(): Promise<number> {
  const db = await getDb();
  const row = await db.one<{ n: string }>(
    'select count(*)::text as n from research.claim where last_verified_by is null and superseded_by is null',
  );
  return Number(row?.n ?? 0);
}

type NoteRow = {
  note_id: string; entity_id: string | null; author_name: string | null;
  kind: string; body: string; tags: string[]; data: Record<string, unknown>;
  created_at: Date | string;
};

const toNote = (r: NoteRow): Note => ({
  noteId: r.note_id, entityId: r.entity_id, author: r.author_name, kind: r.kind,
  body: r.body, tags: r.tags ?? [], data: r.data ?? {}, createdAt: new Date(r.created_at),
});

export async function notesFor(entityId: string, kind?: string, limit?: number): Promise<Note[]> {
  const db = await getDb();
  const params: unknown[] = kind ? [entityId, kind] : [entityId];
  if (limit !== undefined) params.push(Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.trunc(limit))) : 100);
  const bounded = limit === undefined ? '' : ` limit $${params.length}`;
  const rows = await db.query<NoteRow>(
    `with recursive aliases as (
      select identity.canonical_entity_id($1::uuid) as entity_id
      union
      select e.entity_id from identity.entity e join aliases a on e.merged_into = a.entity_id
    )
    select n.note_id, identity.canonical_entity_id($1::uuid) as entity_id, n.kind, n.body, n.tags, n.data, n.created_at, u.name as author_name
       from aliases a join research.note n on n.entity_id = a.entity_id
       left join platform.app_user u on u.id = n.author_id
      ${kind ? 'where n.kind = $2' : ''}
      order by n.created_at desc, n.note_id${bounded}`,
    params,
  );
  return rows.map(toNote);
}

/**
 * Context or a correction from the team about an LP (issue 0016, real): kept as research on them,
 * with who wrote it and when. The strategy workflow reads it above the research and the notes'
 * readings, and a strategy written before it is due a re-think (lib/enrich/strategy.ts, isStale).
 */
export async function addTeamContext(entityId: string, authorId: string, body: string, data: Record<string, unknown> = {}): Promise<Note> {
  const text = body.trim();
  if (!text) throw new Error('Nothing to add yet: write the context or the correction first.');
  if (text.length > 4000) throw new Error('That is longer than 4,000 characters; split it in two.');
  const db = await getDb();
  const row = await db.one<{ note_id: string }>(
    `insert into research.note (entity_id, author_id, kind, body, data) values ($1, $2, 'context', $3, $4) returning note_id`,
    [entityId, authorId, text, JSON.stringify(data)],
  );
  const note = (await notesFor(entityId, 'context')).find((n) => n.noteId === row?.note_id);
  if (!note) throw new Error('The context was not saved.');
  return note;
}

export async function noteKindCounts(): Promise<Array<{ kind: string; n: number }>> {
  const db = await getDb();
  const rows = await db.query<{ kind: string; n: string }>(
    'select kind, count(*)::text as n from research.note group by kind order by kind',
  );
  return rows.map((r) => ({ kind: r.kind, n: Number(r.n) }));
}

/**
 * What the corpus actually contains. Every search surface states this so that an empty
 * result reads as "nothing in the material available" rather than "nothing exists".
 */
export async function corpusCoverage() {
  const db = await getDb();
  const row = await db.one<{ n: string; from: Date | string | null; to: Date | string | null }>(
    'select count(*)::text as n, min(as_of) as from, max(as_of) as to from research.source_doc',
  );
  const byStrength = await db.query<{ strength: DocStrength; n: string }>(
    'select strength, count(*)::text as n from research.source_doc group by strength',
  );
  return {
    documents: Number(row?.n ?? 0),
    from: row?.from ? new Date(row.from) : null,
    to: row?.to ? new Date(row.to) : null,
    byStrength: byStrength.map((b) => ({ strength: b.strength, n: Number(b.n) })),
  };
}

export async function snapshotCount(): Promise<number> {
  const db = await getDb();
  const row = await db.one<{ n: string }>('select count(*)::text as n from research.snapshot');
  return Number(row?.n ?? 0);
}
