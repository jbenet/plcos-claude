import { mergeImportDuplicatesInTransaction, type ImportDuplicateReport } from './import-dupes';
import { consolidatePursuitsInTransaction, type PursuitMergeReport } from '@/modules/strategy';
import { correctPipelineEntityTypes, type EntityTypeReport } from './entity-types';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getDb, type Queryable } from '@/lib/db';
import { finishRun, startRun } from '@/modules/sources';
import { addOrganizationLps, type OrganizationLpCounts } from './organization-lps';
import { readWarehouseGraph } from './connect';
import { resolveConnectionPeople } from './connection-people';
import { enrichDir } from './candidates';
import { check, type Finding, type SourceKind } from './schema';
import type { Path } from './connect';
import { readPathRecords, isEntityKey, type ConnectionProblem, type LocatedRecord } from './connection-check';
import { readStrategyFiles } from './strategy-files';
import type { Triage } from './triage';

/**
 * The import (N64, docs/19): the research findings under data/<profile>/enrich/, mapped into the
 * system — run inside the server, and run again whenever the files change or the mapping does.
 *
 *   raw/<key>.json      → research.source_doc (one per page) and research.claim (one per fact),
 *                         each with its provenance tuple (rule 9): source, as of, confidence, and
 *                         last verified by — nobody, until a person does
 *                       → research.note 'public_profile': the researcher's summary, resting on the facts
 *   connections.jsonl   → research.note 'connection_candidates': the paths W3 found, with their tiers.
 *                         Candidates with uncertainty; weaker evidence lowers rank, never gates information.
 *
 * What it replaces on a re-run is only what an earlier import wrote and nobody has touched since:
 * a claim a person verified stays, whatever the file now says.
 */

export interface ImportCounts {
  entityTypes?: EntityTypeReport;
  duplicateIdentities?: ImportDuplicateReport;
  pursuitMerges?: PursuitMergeReport;
  organizationLps?: OrganizationLpCounts;
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
  skippedPaths: number;
  skippedRecords: ConnectionProblem[];
  strategies: number;
  proposed: number;
  withdrawn: number;
  /** LPs given their triage line: the lane and the first step before any outreach (W9). */
  triaged: number;
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

/** Keep file validation keyed to the original filename; resolve identity only for DB writes. */
async function importEntityKeys(tx: Queryable, keys: string[]): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  const uuids = [...new Set(keys.filter(isEntityKey))];
  const entities = await tx.query<{ key: string; id: string }>(
    `select entity_id::text key, identity.canonical_entity_id(entity_id)::text id
       from identity.entity where entity_id = any($1::uuid[])`, [uuids]);
  const canonical = new Map(entities.map(e => [e.key, e.id]));
  // Unknown UUIDs retain the existing not-in-system / no-pursuit handling.
  for (const key of uuids) resolved.set(key, canonical.get(key.toLowerCase()) ?? key.toLowerCase());
  const aliases = await tx.query<{ key: string; id: string }>(
    `select distinct source_id key, identity.canonical_entity_id(entity_id)::text id
       from identity.source_record where source_id = any($1::text[])
         and (source = 'prospect_key' or (source = 'warehouse' and source_id like 'member:%'))`,
    [[...new Set(keys.filter(k => !isEntityKey(k)))]]);
  const candidates = new Map<string, Set<string>>();
  for (const row of aliases) candidates.set(row.key, (candidates.get(row.key) ?? new Set()).add(row.id));
  // Never pick between conflicting namespaces by row order.
  for (const [key, ids] of candidates) if (ids.size === 1) resolved.set(key, [...ids][0]!);
  return resolved;
}
const unmappedKey = (key: string) => `key ${key} is not mapped yet; run Add prospects (or Import portfolio) first`;

export async function importFindings(runBy: string | null, dir = enrichDir()): Promise<ImportCounts> {
  const counts: ImportCounts = { files: 0, mapped: 0, rejected: 0, unresolved: 0, notInSystem: 0, claims: 0, keptVerified: 0, docs: 0, profiles: 0, withPaths: 0, paths: 0, skippedPaths: 0, skippedRecords: [], strategies: 0, proposed: 0, withdrawn: 0, triaged: 0, problems: [] };
  const run = await startRun('enrich', 'import', runBy);
  try {
    const files = (await readdir(join(dir, 'raw')).catch(() => [])).filter((f) => f.endsWith('.json'));
    counts.files = files.length;
    let findings: Finding[] = [];
    const findingRecords: LocatedRecord[] = [];
    for (const f of files) {
      const key = f.replace(/\.json$/, '');
      let x: unknown;
      try { x = JSON.parse(await readFile(join(dir, 'raw', f), 'utf8')); } catch { counts.rejected++; counts.problems.push({ key, problems: ['not JSON'] }); continue; }
      findingRecords.push({ file: `raw/${f}`, index: 0, value: x });
      const problems = check(x, key);
      if (problems.length) { counts.rejected++; counts.problems.push({ key, problems }); continue; }
      findings.push(x as Finding);
    }
    const parsedPaths = readPathRecords(await readFile(join(dir, 'connections.jsonl'), 'utf8').catch(() => ''));
    counts.skippedRecords.push(...parsedPaths.skipped);
    counts.skippedPaths += parsedPaths.skipped.length;
    let paths: Path[] = [];
    const skipPath = (record: LocatedRecord, problems: string[]) => {
      counts.skippedPaths++;
      counts.skippedRecords.push({ file: record.file, index: record.index, problems });
    };
    // W9: the lane and the first step before any outreach (iteration 3), shown on the LP's page.
    const triage: Triage[] = [];
    for (const [index, line] of (await readFile(join(dir, 'triage.jsonl'), 'utf8').catch(() => '')).split('\n').entries()) {
      if (!line.trim()) continue;
      let value: Triage;
      try { value = JSON.parse(line) as Triage; }
      catch { counts.skippedRecords.push({ file: 'triage.jsonl', index, problems: ['not JSON'] }); continue; }
      if (!value || !isEntityKey(value.key) || !['warm now', 'research first', 'long process', 'cold'].includes(value.lane)
        || (value.first != null && typeof value.first !== 'string')) {
        counts.skippedRecords.push({ file: 'triage.jsonl', index, problems: ['invalid triage key, lane or first step'] }); continue;
      }
      triage.push(value);
    }
    // W5: one strategy per canonical LP and vehicle, across both supported layouts.
    const refuseStrategy = (file: string, problems: string[]) => {
      counts.problems.push({ key: file.includes('/') ? `strategy/${file}` : file.replace(/\.json$/, ''), problems: problems.map(p => `strategy: ${p}`) });
    };
    let strategies = await readStrategyFiles(dir, refuseStrategy);
    const db = await getDb();
    await db.transaction(async (tx) => {
      // The same lock used by prospect/portfolio identity writers keeps resolution and writes
      // together when another import or merge is running.
      await tx.exec('lock table identity.entity, identity.source_record in share row exclusive mode');
      const keysByFile = await importEntityKeys(tx, [...findings.map(f => f.key), ...strategies.map(s => s.s.key)]);
      findings = findings.flatMap(f => {
        const id = keysByFile.get(f.key);
        if (id) return [{ ...f, key: id }];
        counts.rejected++;
        counts.problems.push({ key: f.key, problems: [unmappedKey(f.key)] });
        return [];
      });
      strategies = strategies.flatMap(record => {
        const id = keysByFile.get(record.s.key);
        if (id) return [{ ...record, s: { ...record.s, key: id } }];
        refuseStrategy(record.file, [unmappedKey(record.fileKey)]);
        return [];
      });
      counts.entityTypes = await correctPipelineEntityTypes(tx, findings, parsedPaths.records.map(r => r.value as Path), runBy ?? 'system:identity-import');
      counts.duplicateIdentities = await mergeImportDuplicatesInTransaction(tx, runBy ?? 'system:identity-import', findings, parsedPaths.records.map(r => r.value as Path));
      // The duplicate pass can resolve the earlier type pass's multiple-org ambiguity.
      // Report the final outcome, while retaining every recorded correction ID.
      const correctedIds = counts.duplicateIdentities.corrected.map(c => c.entityId);
      const correctedNames = new Map((await tx.query<{ id: string; name: string }>(
        'select entity_id::text id,display_name name from identity.entity where entity_id=any($1::uuid[])', [correctedIds]))
        .map(e => [e.id, e.name]));
      counts.entityTypes.ambiguous = counts.entityTypes.ambiguous.filter(c => !correctedNames.has(c.entityId));
      counts.entityTypes.corrected.push(...counts.duplicateIdentities.corrected.map(c => ({ ...c, name: correctedNames.get(c.entityId)! })));
      // Keys resolved before the identity pass may now be aliases. File validation remains
      // tied to the original keys; every subsequent write uses the resulting canonical ID.
      const canonicalKeys = await importEntityKeys(tx, [...findings.map(f => f.key), ...strategies.map(r => r.s.key), ...triage.map(t => t.key)]);
      findings = findings.map(f => ({ ...f, key: canonicalKeys.get(f.key) ?? f.key }));
      strategies = strategies.map(r => ({ ...r, s: { ...r.s, key: canonicalKeys.get(r.s.key) ?? r.s.key } }));
      const vehicles = await tx.query<{ id: string; slug: string; name: string }>('select id, slug, name from platform.vehicle');
      const scoped = strategies.flatMap(record => {
        if (record.folder && !vehicles.some(v => v.slug === record.folder)) {
          refuseStrategy(record.file, [`unknown vehicle folder "${record.folder}"; use a known vehicle slug`]);
          return [];
        }
        if (record.folder && record.folder !== record.s.ask.vehicle) {
          refuseStrategy(record.file, [`vehicle folder "${record.folder}" must equal ask.vehicle "${record.s.ask.vehicle}"`]);
          return [];
        }
        // Legacy top-level files may still name the vehicle by its display name.
        const named = record.s.ask.vehicle.trim().toLowerCase();
        const matches = vehicles.filter(v => [v.name.toLowerCase(), v.slug.toLowerCase()].includes(named));
        if (matches.length !== 1) {
          refuseStrategy(record.file, ['ask.vehicle must identify exactly one known vehicle']);
          return [];
        }
        return [{ ...record, vehicleId: matches[0]!.id }];
      });
      const byPair = new Map<string, typeof scoped>();
      for (const record of scoped) {
        const pair = `${record.s.key}:${record.vehicleId}`;
        byPair.set(pair, [...(byPair.get(pair) ?? []), record]);
      }
      // Check the whole batch before writing: neither file in a conflict wins, including
      // aliases that became the same canonical entity during this import's identity pass.
      const acceptedStrategies = [...byPair.values()].flatMap(records => {
        if (records.length === 1) return records;
        for (const record of records) refuseStrategy(record.file,
          [`conflict: multiple files for the same canonical entity and vehicle: ${records.map(r => `strategy/${r.file}`).join(', ')}; none imported`]);
        return [];
      });
      counts.strategies = acceptedStrategies.length;
      for (const t of triage) t.key = canonicalKeys.get(t.key) ?? t.key;
      counts.pursuitMerges = await consolidatePursuitsInTransaction(tx, runBy);
      const orgs = await tx.query<{ name: string }>("select display_name as name from identity.entity where entity_type = 'org'");
      const records = parsedPaths.records;
      const origin = new Map<Path, LocatedRecord>();
      paths = await resolveConnectionPeople(tx, records.map((r) => r.value as Path),
        (index, problems) => skipPath(records[index]!, problems),
        { findings: findingRecords, knownOrgs: orgs.map((o) => o.name), records, onResolved: (index, path) => { origin.set(path, records[index]!); } });
      const known = new Set((await tx.query<{ id: string }>(
        `select entity_id::text as id from identity.entity where entity_id = any($1::uuid[])`,
        [[...new Set([...findings.map((f) => f.key), ...paths.map((p) => p.lp), ...triage.map((t) => t.key)])]],
      )).map((r) => r.id));
      const keys = findings.map((f) => f.key).filter((k) => known.has(k));
      counts.notInSystem = findings.length - keys.length;

      // What an earlier import wrote and nobody has verified goes; a verified claim stays.
      counts.keptVerified = Number((await tx.one<{ n: string }>(
        `select count(*)::text as n from research.claim where source like 'pub:%' and entity_id = any($1::uuid[]) and last_verified_by is not null`, [keys],
      ))?.n ?? 0);
      await tx.query(`delete from research.claim where source like 'pub:%' and entity_id = any($1::uuid[]) and last_verified_by is null`, [keys]);
      await tx.query(`delete from research.note where kind in ('public_profile', 'triage') and author_id is null and entity_id = any($1::uuid[])`, [[...known]]);
      // Preserve the previous candidate note for an endpoint whose new paths were all
      // refused. A successful sibling path replaces the note with only valid paths.
      const skippedIndices = new Set(counts.skippedRecords.filter((r) => r.file === 'connections.jsonl').map((r) => r.index));
      const skippedLps = new Set(parsedPaths.allRecords.filter((r) => skippedIndices.has(r.index)).map((r) => (r.value as Partial<Path> | null)?.lp).filter(isEntityKey));
      const importedLps = new Set(paths.map((p) => p.lp));
      await tx.query(`delete from research.note where kind = 'connection_candidates' and author_id is null and entity_id = any($1::uuid[])`,
        [[...known].filter((key) => !skippedLps.has(key) || importedLps.has(key))]);
      for (const t of triage) {
        if (!known.has(t.key)) continue;
        await tx.query(`insert into research.note (entity_id, kind, body, data) values ($1, 'triage', $2, $3)`,
          [t.key, t.first ? `Before any outreach: ${t.first}` : `Triage: ${t.lane}`, JSON.stringify(t)]);
        counts.triaged++;
      }

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
             JSON.stringify({ identity: f.identity, profile: f.profile ?? null, researched: f.researched, coverage: f.coverage ?? null, connections: f.connections ?? [], connectionFeedback: f.connectionFeedback ?? [] })],
          );
          counts.profiles++;
        }
        counts.mapped++;
      }
      counts.docs = docs.size;

      // Strategies become suggestions on the LP's open pursuit: the same file again changes
      // nothing; a new one withdraws the open proposal it replaces; decided ones stay as they are.
      for (const { s: st, hash, file, vehicleId } of acceptedStrategies) {
        const pursuit = await tx.one<{ id: string }>(
          `select p.pursuit_id::text as id from strategy.active_pursuit p
            where identity.canonical_entity_id(p.entity_id) = identity.canonical_entity_id($1::uuid)
              and p.closed_at is null and p.vehicle_id = $2::uuid
            order by (p.entity_id = identity.canonical_entity_id(p.entity_id)) desc, p.opened_at, p.pursuit_id limit 1`,
          [st.key, vehicleId]);
        if (!pursuit) {
          refuseStrategy(file, ['no open pursuit in the named vehicle; not imported; retried on the next import once the pursuit exists']);
          continue;
        }
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
      for (const p of paths) {
        if (known.has(p.lp)) byLp.set(p.lp, [...(byLp.get(p.lp) ?? []), p]);
        else {
          const record = origin.get(p)!;
          skipPath(record, ['LP endpoint is not in the system']);
        }
      }
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

    counts.organizationLps = await addOrganizationLps(db, findings, runBy, await readWarehouseGraph(dir));

    await finishRun(run, {
      status: 'ok', requests: 0, records: counts.files, newRecords: counts.claims,
      note: `${counts.mapped} findings mapped (${counts.claims} claims, ${counts.docs} pages) · ${counts.withPaths} LPs with paths · ${counts.proposed} strategies proposed${counts.rejected ? ` · ${counts.rejected} files refused` : ''}${counts.skippedRecords.length ? ` · ${counts.skippedPaths} paths skipped · ${counts.skippedRecords.length} records skipped` : ''}`,
      detail: { ...counts, problems: counts.problems.slice(0, 50) },
    });
    return counts;
  } catch (err) {
    await finishRun(run, { status: 'failed', requests: 0, records: 0, newRecords: 0, note: err instanceof Error ? err.message : 'unknown error' });
    throw err;
  }
}
