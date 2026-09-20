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

export async function listSourceDocs(): Promise<SourceDoc[]> {
  const db = await getDb();
  return (await db.query<DocRow>('select * from research.source_doc order by doc_id')).map(toDoc);
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
  select c.claim_id, c.entity_id, c.field, c.value, c.source, c.as_of, c.confidence,
         c.last_verified_at, c.superseded_by, u.name as verified_by_name
    from research.claim c
    left join platform.app_user u on u.id = c.last_verified_by`;

export async function claimsFor(entityId: string): Promise<Claim[]> {
  const db = await getDb();
  const rows = await db.query<ClaimRow>(
    `${CLAIM_SELECT} where c.entity_id = $1 and c.superseded_by is null order by c.field`,
    [entityId],
  );
  return rows.map(toClaim);
}

export async function claimCounts(): Promise<Map<string, number>> {
  const db = await getDb();
  const rows = await db.query<{ entity_id: string; n: string }>(
    'select entity_id, count(*)::text as n from research.claim where superseded_by is null group by entity_id',
  );
  return new Map(rows.map((r) => [r.entity_id, Number(r.n)]));
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

export async function notesFor(entityId: string, kind?: string): Promise<Note[]> {
  const db = await getDb();
  const rows = await db.query<NoteRow>(
    `select n.note_id, n.entity_id, n.kind, n.body, n.tags, n.data, n.created_at, u.name as author_name
       from research.note n left join platform.app_user u on u.id = n.author_id
      where n.entity_id = $1 ${kind ? 'and n.kind = $2' : ''}
      order by n.created_at desc`,
    kind ? [entityId, kind] : [entityId],
  );
  return rows.map(toNote);
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
