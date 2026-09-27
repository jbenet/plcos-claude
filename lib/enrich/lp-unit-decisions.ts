import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from '@/lib/db';
import { decideLpUnitFromFile, repointPursuitsInTransaction, type LpUnitDecisionRow } from '@/modules/strategy/lp-units';

export interface LpUnitFileDecision {
  pursuitId: string; decision: 'personal' | 'firm'; firmEntityId?: string;
  evidence: Array<{ source: string; as_of: string; quote: string }>;
  decided_by: string;
}
export interface LpUnitDecisionInput { line: number; value?: unknown; error?: string }
export interface LpUnitFileReport {
  applied: number; skipped: number;
  refused: Array<{ line: number; pursuitId?: string; reason: string }>;
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const nonempty = (v: unknown): v is string => typeof v === 'string' && !!v.trim();
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const fail = (message: string): never => { throw new Error(message); };

export async function readLpUnitDecisions(dir: string): Promise<LpUnitDecisionInput[]> {
  let text: string;
  try { text = await readFile(join(dir, 'lp-unit-decisions.jsonl'), 'utf8'); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e; }
  return text.split(/\r?\n/).flatMap<LpUnitDecisionInput>((line, i) => {
    if (!line.trim()) return [];
    try { return [{ line: i + 1, value: JSON.parse(line) }]; }
    catch { return [{ line: i + 1, error: 'Invalid JSON' }]; }
  });
}

export function validateLpUnitDecision(value: unknown): LpUnitFileDecision {
  if (!object(value)) fail('Decision must be an object');
  const v = value as Record<string, unknown>;
  if (!uuid(v.pursuitId)) fail('pursuitId must be a pursuit UUID');
  if (v.decision !== 'personal' && v.decision !== 'firm') fail('decision must be personal or firm');
  if (v.decision === 'firm' && !uuid(v.firmEntityId)) fail('firm requires a firmEntityId UUID');
  if (v.decision === 'personal' && v.firmEntityId !== undefined) fail('personal does not take firmEntityId');
  if (!nonempty(v.decided_by)) fail('decided_by is required');
  if (!Array.isArray(v.evidence) || !v.evidence.length || !v.evidence.every(e => object(e)
    && nonempty(e.source) && nonempty(e.quote) && typeof e.as_of === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(e.as_of) && !isNaN(Date.parse(e.as_of))
    && new Date(e.as_of).toISOString().slice(0, 10) === e.as_of))
    fail('At least one evidence item with source, valid as_of (YYYY-MM-DD) and quote is required');
  return { pursuitId: (v.pursuitId as string).toLowerCase(), decision: v.decision as LpUnitFileDecision['decision'],
    ...(v.decision === 'firm' ? { firmEntityId: (v.firmEntityId as string).toLowerCase() } : {}),
    evidence: (v.evidence as LpUnitFileDecision['evidence']).map(e => ({ source: e.source.trim(), as_of: e.as_of, quote: e.quote.trim() })),
    decided_by: (v.decided_by as string).trim() };
}

/** Both human-triggered jobs use this transaction. A bad line cannot partially apply or
 * discard valid neighbours. File answers precede the rule, which respects their journal. */
export async function repointWithLpUnitDecisions(db: Db, actorId: string | null, inputs: LpUnitDecisionInput[]) {
  const result: LpUnitFileReport = { applied: 0, skipped: 0, refused: [] };
  const parsed = inputs.map(input => {
    try {
      if (input.error) fail(input.error);
      const decision = validateLpUnitDecision(input.value);
      return { input, decision, key: createHash('sha256').update(JSON.stringify(decision)).digest('hex') };
    } catch (e) { result.refused.push({ line: input.line, reason: (e as Error).message }); return { input }; }
  });
  const variants = new Map<string, Set<string>>();
  for (const { decision: d, key } of parsed) if (d && key)
    variants.set(d.pursuitId, (variants.get(d.pursuitId) ?? new Set()).add(key));
  return db.transaction(async tx => {
    const appliedRows: LpUnitDecisionRow[] = [];
    for (const { input, decision: d, key } of parsed) {
      if (!d || !key) continue;
      await tx.exec('savepoint lp_unit_decision');
      try {
        if (variants.get(d.pursuitId)!.size > 1) fail('Conflicting decisions for this pursuit; keep one proposal per pursuit');
        const applied = await decideLpUnitFromFile(tx, d, key, actorId);
        if (applied) { result.applied++; appliedRows.push(applied); } else result.skipped++;
        await tx.exec('release savepoint lp_unit_decision');
      } catch (e) {
        await tx.exec('rollback to savepoint lp_unit_decision');
        await tx.exec('release savepoint lp_unit_decision');
        result.refused.push({ line: input.line, pursuitId: d.pursuitId, reason: e instanceof Error ? e.message : 'Decision refused' });
      }
    }
    const report = await repointPursuitsInTransaction(tx, actorId);
    for (const row of appliedRows) { report[row.decision]++; if (row.created) report.created++; }
    report.decisions = [...appliedRows, ...report.decisions];
    return { ...report, fileDecisions: result };
  });
}
