import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getDb } from '@/lib/db';
import { finishRun, startRun } from '@/modules/sources';
import { enrichDir } from './candidates';
import { check, type Finding, type SourceKind } from './schema';
import type { Path } from './connect';
import { checkStrategy, type Strategy } from './strategy';

/**
 * The import (N64, docs/19): the research findings under data/<profile>/enrich/, mapped into the
 * system — run inside the server, and run again whenever the files change or the mapping does.
 *
 *   raw/<key>.json      → research.source_doc (one per page) and research.claim (one per fact),
 *                         each with its provenance tuple (rule 9): source, as of, confidence, and
 *                         last verified by — nobody, until a person does
 *                       → research.note 'public_profile': the researcher's summary, resting on the facts
 *   connections.jsonl   → research.note 'connection_candidates': the paths W3 found, with their tiers.
 *                         Candidates to look at; a C or D path never routes without a person (rule 6)
 *
 * What it replaces on a re-run is only what an earlier import wrote and nobody has touched since:
 * a claim a person verified stays, whatever the file now says.
 */

export interface ImportCounts {
  files: number;
  mapped: number;
  rejected: number;
  unresolved: number;
  notInSystem: number;
  claims: number;
  keptVerified: number;
  docs: number;
  profiles: number;
  withPaths: number;
  paths: number;
  strategies: number;
  proposed: number;
  withdrawn: number;
  problems: Array<{ key: string; problems: string[] }>;
}

export const PUBLIC_PREFIX = 'public.';
const docId = (url: string) => `pub:${createHash('sha1').update(url).digest('hex').slice(0, 16)}`;
const STRENGTH: Record<SourceKind, 'strong' | 'moderate' | 'weak'> = {
  filing: 'strong', primary: 'moderate', press: 'moderate', podcast: 'moderate', database: 'weak', social: 'weak', other: 'weak',
};
const day = (s: string | null | undefined, fallback: string) => {
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(s ?? '');
  return m ? `${m[1]}-${m[2] ?? '01'}-${m[3] ?? '01'}` : fallback;
};

export async function importFindings(runBy: string | null): Promise<ImportCounts> {
  const dir = enrichDir();
  const counts: ImportCounts = { files: 0, mapped: 0, rejected: 0, unresolved: 0, notInSystem: 0, claims: 0, keptVerified: 0, docs: 0, profiles: 0, withPaths: 0, paths: 0, strategies: 0, proposed: 0, withdrawn: 0, problems: [] };
  const run = await startRun('enrich', 'import', runBy);
  try {
    const files = (await readdir(join(dir, 'raw')).catch(() => [])).filter((f) => f.endsWith('.json'));
    counts.files = files.length;
    const findings: Finding[] = [];
    for (const f of files) {
      const key = f.replace(/\.json$/, '');
      let x: unknown;
      try { x = JSON.parse(await readFile(join(dir, 'raw', f), 'utf8')); } catch { counts.rejected++; counts.problems.push({ key, problems: ['not JSON'] }); continue; }
      const problems = check(x, key);
      if (problems.length) { counts.rejected++; counts.problems.push({ key, problems }); continue; }
      findings.push(x as Finding);
    }
    const paths = (await readFile(join(dir, 'connections.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean).map((l) => JSON.parse(l) as Path);
    // W5: one strategy per LP, checked like the findings.
    const strategies: Array<{ s: Strategy; hash: string }> = [];
    for (const f of (await readdir(join(dir, 'strategy')).catch(() => [])).filter((x) => x.endsWith('.json'))) {
      const key = f.replace(/\.json$/, '');
      const text = await readFile(join(dir, 'strategy', f), 'utf8');
      let x: unknown;
      try { x = JSON.parse(text); } catch { counts.problems.push({ key, problems: ['strategy: not JSON'] }); continue; }
      const problems = checkStrategy(x, key);
      if (problems.length) { counts.problems.push({ key, problems: problems.map((q) => `strategy: ${q}`) }); continue; }
      strategies.push({ s: x as Strategy, hash: createHash('sha1').update(text).digest('hex') });
    }
    counts.strategies = strategies.length;

    const db = await getDb();
    await db.transaction(async (tx) => {
      const known = new Set((await tx.query<{ id: string }>(
        `select entity_id::text as id from identity.entity where entity_id = any($1::uuid[])`,
        [[...new Set([...findings.map((f) => f.key), ...paths.map((p) => p.lp)])]],
      )).map((r) => r.id));
      const keys = findings.map((f) => f.key).filter((k) => known.has(k));
      counts.notInSystem = findings.length - keys.length;

      // What an earlier import wrote and nobody has verified goes; a verified claim stays.
      counts.keptVerified = Number((await tx.one<{ n: string }>(
        `select count(*)::text as n from research.claim where source like 'pub:%' and entity_id = any($1::uuid[]) and last_verified_by is not null`, [keys],
      ))?.n ?? 0);
      await tx.query(`delete from research.claim where source like 'pub:%' and entity_id = any($1::uuid[]) and last_verified_by is null`, [keys]);
      await tx.query(`delete from research.note where kind in ('public_profile', 'connection_candidates') and author_id is null and entity_id = any($1::uuid[])`, [[...known]]);

      const docs = new Set<string>();
      for (const f of findings) {
        if (!known.has(f.key)) continue;
        if (f.identity.match === 'ambiguous' || f.identity.match === 'not_found') {
          counts.unresolved++;
        }
        const researched = f.researched.at.slice(0, 10);
        for (const fact of f.facts) {
          const id = docId(fact.source.url);
          const asOf = day(fact.source.published, researched);
          if (!docs.has(id)) {
            let host = fact.source.url;
            try { host = new URL(fact.source.url).hostname.replace(/^www\./, ''); } catch { /* keep the URL */ }
            await tx.query(
              `insert into research.source_doc (doc_id, title, kind, origin, as_of, strength, supports, body)
               values ($1,$2,$3,$4,$5,$6::research.doc_strength,$7,$8)
               on conflict (doc_id) do update set title = excluded.title, as_of = excluded.as_of, strength = excluded.strength`,
              [id, (fact.source.title || host).slice(0, 200), `public:${fact.source.kind}`, fact.source.url, asOf, STRENGTH[fact.source.kind],
               `A public page (${host}), read by ${f.researched.by} on ${researched}. It supports what it says, and nothing it doesn't; nobody on the team has verified it.`,
               fact.quote ?? ''],
            );
            docs.add(id);
          }
          const same = await tx.one<{ n: string }>(
            `select count(*)::text as n from research.claim where entity_id = $1 and field = $2 and value = $3 and source = $4`,
            [f.key, `${PUBLIC_PREFIX}${fact.field}`, fact.value.slice(0, 600), id],
          );
          if (Number(same?.n ?? 0) > 0) continue; // verified and kept
          await tx.query(
            `insert into research.claim (entity_id, field, value, source, as_of, confidence)
             values ($1,$2,$3,$4,$5,$6::research.confidence)`,
            [f.key, `${PUBLIC_PREFIX}${fact.field}`, fact.value.slice(0, 600), id, asOf, fact.confidence],
          );
          counts.claims++;
        }
        if (f.profile || f.identity) {
          await tx.query(
            `insert into research.note (entity_id, kind, body, tags, data) values ($1, 'public_profile', $2, $3, $4)`,
            [f.key, f.profile?.summary ?? f.identity.basis, f.profile?.interests ?? [],
             JSON.stringify({ identity: f.identity, profile: f.profile ?? null, researched: f.researched, coverage: f.coverage ?? null, connections: f.connections ?? [] })],
          );
          counts.profiles++;
        }
        counts.mapped++;
      }
      counts.docs = docs.size;

      // Strategies become suggestions on the LP's open pursuit: the same file again changes
      // nothing; a new one withdraws the open proposal it replaces; decided ones stay as they are.
      for (const { s: st, hash } of strategies) {
        const pursuit = await tx.one<{ id: string }>(
          `select pursuit_id::text as id from strategy.pursuit where entity_id = $1 and closed_at is null order by opened_at limit 1`, [st.key]);
        if (!pursuit) continue;
        const seen = await tx.one<{ n: string }>(`select count(*)::text as n from strategy.suggestion where pursuit_id = $1 and file_hash = $2`, [pursuit.id, hash]);
        if (Number(seen?.n ?? 0) > 0) continue;
        const w = await tx.query<{ id: string }>(
          `update strategy.suggestion set status = 'withdrawn', decision_note = 'Replaced by a newer proposal.' where pursuit_id = $1 and status = 'proposed' returning suggestion_id::text as id`, [pursuit.id]);
        counts.withdrawn += w.length;
        await tx.query(
          `insert into strategy.suggestion (pursuit_id, body, data, made_by, made_at, file_hash) values ($1, $2, $3, $4, $5, $6)`,
          [pursuit.id, `${st.next.what}${st.next.who ? ` — ${st.next.who}` : ''}${st.next.when ? `, ${st.next.when}` : ''}`.slice(0, 400), JSON.stringify(st),
           `${st.made.by} (${st.made.workflow} v${st.made.version})`, st.made.at, hash],
        );
        counts.proposed++;
      }

      const byLp = new Map<string, Path[]>();
      for (const p of paths) if (known.has(p.lp)) byLp.set(p.lp, [...(byLp.get(p.lp) ?? []), p]);
      const rank = { A: 0, B: 1, C: 2, D: 3 } as const;
      for (const [lp, ps] of byLp) {
        ps.sort((a, b) => rank[a.tier] - rank[b.tier]);
        await tx.query(
          `insert into research.note (entity_id, kind, body, data) values ($1, 'connection_candidates', $2, $3)`,
          [lp, `${ps.length} ${ps.length === 1 ? 'path' : 'paths'} found; the best is tier ${ps[0]!.tier}`, JSON.stringify({ paths: ps })],
        );
        counts.withPaths++;
        counts.paths += ps.length;
      }
    });

    await finishRun(run, {
      status: 'ok', requests: 0, records: counts.files, newRecords: counts.claims,
      note: `${counts.mapped} findings mapped (${counts.claims} claims, ${counts.docs} pages) · ${counts.withPaths} LPs with paths · ${counts.proposed} strategies proposed${counts.rejected ? ` · ${counts.rejected} files refused` : ''}`,
      detail: { ...counts, problems: counts.problems.slice(0, 50) },
    });
    return counts;
  } catch (err) {
    await finishRun(run, { status: 'failed', requests: 0, records: 0, newRecords: 0, note: err instanceof Error ? err.message : 'unknown error' });
    throw err;
  }
}
