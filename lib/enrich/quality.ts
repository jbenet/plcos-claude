import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * The loop's own measurements (N70, docs/19): the critic's rounds (W5c) and the fact check (W1c),
 * read from the files they wrote. A grade is an agent's reading against the written criteria — a way
 * to see whether each amendment made the next round better, never a verdict on an LP and never the
 * team's verification of a fact.
 */
export type Grade = 'A' | 'B' | 'C' | 'D';
export type FactGrade = 'supported' | 'partly' | 'not supported' | 'someone else' | 'unavailable';
export type IdentityVerdict = 'holds' | 'doubt' | 'wrong';

export interface CriticRound { round: number; graded: number; grades: Record<Grade, number>; byCriterion: Record<string, number> }
export interface FactCheck { round: number; findings: number; facts: Record<FactGrade, number>; identities: Record<IdentityVerdict, number> }

/** `strategy-review.jsonl` is round one, `strategy-review-2.jsonl` round two; `-3a` and `-3b` are two halves of round three. */
export function roundOf(file: string): number | null {
  const m = file.match(/^strategy-review(?:-(\d+)[a-z]?)?\.jsonl$/);
  return m ? Number(m[1] ?? 1) : null;
}

/** `fact-review-01a.jsonl` and `fact-review-01b.jsonl` are round one of the fact check; `fact-review-02c.jsonl` is part of round two. */
export function factRoundOf(file: string): number | null {
  const m = file.match(/^fact-review-(\d+)[a-z]?\.jsonl$/);
  return m ? Number(m[1]) : null;
}

export async function readQuality(dir: string): Promise<{ rounds: CriticRound[]; facts: FactCheck[] }> {
  const files = (await readdir(dir).catch(() => [] as string[])).sort();
  const lines = async (f: string): Promise<Array<Record<string, unknown>>> =>
    (await readFile(join(dir, f), 'utf8').catch(() => '')).split('\n').filter(Boolean)
      .flatMap((l) => { try { return [JSON.parse(l) as Record<string, unknown>]; } catch { return []; } });

  const rounds = new Map<number, CriticRound>();
  for (const f of files) {
    const r = roundOf(f);
    if (r === null) continue;
    const cur = rounds.get(r) ?? { round: r, graded: 0, grades: { A: 0, B: 0, C: 0, D: 0 }, byCriterion: {} };
    for (const x of await lines(f)) {
      const g = x.grade as Grade;
      if (!(g in cur.grades)) continue;
      cur.graded++;
      cur.grades[g]++;
      for (const i of (x.issues as Array<{ criterion: unknown }> | undefined) ?? []) cur.byCriterion[String(i.criterion)] = (cur.byCriterion[String(i.criterion)] ?? 0) + 1;
    }
    rounds.set(r, cur);
  }

  const facts = new Map<number, FactCheck>();
  for (const f of files) {
    const r = factRoundOf(f);
    if (r === null) continue;
    const fc = facts.get(r) ?? { round: r, findings: 0, facts: { supported: 0, partly: 0, 'not supported': 0, 'someone else': 0, unavailable: 0 }, identities: { holds: 0, doubt: 0, wrong: 0 } };
    for (const x of await lines(f)) {
      fc.findings++;
      const id = x.identity as IdentityVerdict;
      if (id in fc.identities) fc.identities[id]++;
      for (const g of (x.facts as Array<{ grade: unknown }> | undefined) ?? []) {
        const k = g.grade as FactGrade;
        if (k in fc.facts) fc.facts[k]++;
      }
    }
    facts.set(r, fc);
  }
  const byRound = <T extends { round: number }>(m: Map<number, T>) => [...m.values()].sort((a, b) => a.round - b.round);
  return { rounds: byRound(rounds), facts: byRound(facts) };
}
