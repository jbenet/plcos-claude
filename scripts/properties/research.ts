import type { SeedContext } from './harness';

export async function researchProperties({ check, db }: SeedContext) {
  // ---------------------------------------------------------------- properties

  const orphanClaims = await db.query<{ n: string }>(
    `select count(*)::text as n from research.claim c
      left join research.source_doc d on d.doc_id = c.source
      where d.doc_id is null or c.as_of is null or c.confidence is null`,
  );
  check(
    'Every claim carries a complete provenance tuple',
    Number(orphanClaims[0]!.n) === 0,
    `${orphanClaims[0]!.n} claims missing a source, an as-of or a confidence`,
  );

}
