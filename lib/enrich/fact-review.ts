/**
 * One row of a W1c fact review (docs/workflows/w1c-fact-check.md): the finding's identity verdict and a
 * grade for each of its facts, in order, with counts that add up. Checked against the finding it
 * reviews, as it stood when reviewed. Used by the API workflow (lib/workflows/api.ts) and the cloud
 * push (lib/sync/push.ts). Empty means the row may be kept.
 */
export const FACT_GRADES = ['supported', 'partly', 'not supported', 'someone else', 'unavailable'] as const;
const COUNT_KEYS = ['supported', 'partly', 'notSupported', 'someoneElse', 'unavailable'] as const;

export function factReviewProblems(row: unknown, original: { facts?: unknown[] } | null | undefined): string[] {
  const r = row as { key?: unknown; identity?: unknown; identityNote?: unknown; facts?: unknown; counts?: Record<string, unknown> } | null;
  if (!r || typeof r !== 'object' || Array.isArray(r)) return ['not an object'];
  const p: string[] = [];
  if (typeof r.key !== 'string' || !/^[\w:-]+$/.test(r.key)) p.push('no key');
  if (!['holds', 'doubt', 'wrong'].includes(r.identity as string)) p.push('identity must be holds, doubt or wrong');
  if (typeof r.identityNote !== 'string') p.push('identityNote must be text');
  if (!original || !Array.isArray(original.facts)) { p.push('no finding to review'); return p; }
  if (!Array.isArray(r.facts)) { p.push('facts is not a list'); return p; }
  const facts = r.facts as Array<{ i?: unknown; grade?: unknown; note?: unknown }>;
  if (facts.length !== original.facts.length) p.push(`grades ${facts.length} facts; the finding has ${original.facts.length}`);
  facts.forEach((f, i) => {
    if (!f || f.i !== i || !(FACT_GRADES as readonly unknown[]).includes(f.grade) || typeof f.note !== 'string') p.push(`fact ${i}: needs i, a known grade and a note`);
  });
  if (COUNT_KEYS.some((k, i) => r.counts?.[k] !== facts.filter((f) => f?.grade === FACT_GRADES[i]).length)) p.push('counts do not match the grades');
  return p;
}
