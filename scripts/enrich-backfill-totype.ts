/** One-off target typing. Run from the live checkout, with a recorded workflow run.
 * DATA_PROFILE=real node --import tsx /path/to/scripts/enrich-backfill-totype.ts [--apply]
 * Report (including unresolved names) stays under real/workflows/connection-target-type/.
 */
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readLayout } from '../config/ports';
import { realRoot, readRuns } from '../lib/workflows/ledger';
import { backfillTargetTypes, targetName } from '../lib/enrich/connection-target';
import { coinvestorOrganizationsSql, personOrganizationsSql } from '../lib/enrich/warehouse-sql';
import { graphKey } from '../lib/enrich/warehouse-graph';
import type { Finding } from '../lib/enrich/schema';

async function main() {
  const args = process.argv.slice(2);
  if (args.some((a) => a !== '--apply')) throw new Error('Only --apply is supported.');
  const apply = args.includes('--apply');
  if (readLayout().role !== 'live') throw new Error('Run from the live checkout.');
  const root = await realRoot();
  const dir = join(root, 'enrich');
  const reportDir = join(root, 'workflows/connection-target-type');
  await mkdir(reportDir, { recursive: true });
  const evidence: Array<{ file: string; sha256: string }> = [];
  const readInput = async (file: string) => {
    const text = await readFile(join(dir, file), 'utf8');
    evidence.push({ file, sha256: createHash('sha256').update(text).digest('hex') });
    return text;
  };
  const json = async (file: string, fallback?: unknown) => {
    try { return JSON.parse(await readInput(file)); }
    catch (error) { if (fallback !== undefined && (error as NodeJS.ErrnoException).code === 'ENOENT') return fallback; throw new Error(`Cannot read input ${file}`); }
  };
  const lines = async (file: string) => {
    try { return (await readInput(file)).split('\n').filter(Boolean).map((l) => JSON.parse(l)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw new Error(`Cannot read input ${file}`); }
  };
  const organizations = new Set<string>(), people = new Set<string>();
  const add = (set: Set<string>, name: unknown) => { if (typeof name === 'string' && targetName(name)) set.add(targetName(name)); };
  const network = await json('us/network.json');
  for (const o of [...network.orgs, ...network.backers, ...(network.portfolio ?? [])]) for (const n of [o.name, ...(o.aliases ?? [])]) add(organizations, n);
  for (const p of network.backer_people) add(people, p.name);
  const team = await json('us/team.json');
  for (const p of team.team) {
    add(people, p.name);
    for (const role of [...p.roles, ...p.prior, ...p.education]) add(organizations, role.org);
  }
  for (const c of await lines('candidates.jsonl')) { add(c.type === 'org' ? organizations : people, c.name); add(organizations, c.org); }
  for (const p of await lines('warehouse/people.jsonl')) { add(p.nodeType === 'organization' ? organizations : people, p.name); add(organizations, p.org); }
  for (const p of await lines('connections.jsonl')) for (const d of [p.lpPerson, p.other?.person]) if (d?.entityType === 'org') add(organizations, d.name);
  for (const t of (await json('us/pl-network.json', { teams: [] })).teams) add(organizations, t.name);
  for (const e of await lines('us/pl-directory.jsonl')) for (const t of e.firmTeams ?? []) add(organizations, t.name);
  // Read frozen warehouse caches only: no query, credentials or database access.
  for (const [sql, field] of [[coinvestorOrganizationsSql, 'name'], [personOrganizationsSql, 'org']] as const) {
    for (let offset = 0;; offset += 10000) {
      const page = await json(`warehouse/pages/${graphKey(`SELECT * FROM (${sql}) t ORDER BY TO_JSON_STRING(t) LIMIT 10000 OFFSET ${offset}`)}.json`, offset === 0 ? [] : undefined);
      for (const row of page) add(organizations, row[field]);
      if (page.length < 10000) break;
    }
  }
  const files = (await readdir(join(dir, 'raw'))).filter((f) => f.endsWith('.json')).sort();
  const inputs = [];
  for (const file of files) {
    const path = join(dir, 'raw', file);
    if (!(await lstat(path)).isFile() || await realpath(path) !== path) throw new Error('Raw finding must be a regular file.');
    const before = await readFile(path, 'utf8');
    const value = JSON.parse(before) as Finding;
    // Structured organization names are evidence; never infer a person from an old W3 guess.
    add(organizations, value.identity?.canonical?.org);
    for (const f of value.facts ?? []) for (const k of ['company', 'companies', 'org', 'organization', 'firm', 'fund']) {
      const names = f.detail?.[k];
      for (const n of Array.isArray(names) ? names : typeof names === 'string' ? names.split(/\s*;\s*/) : []) add(organizations, n);
    }
    inputs.push({ file, path, before, value });
  }
  const plan = inputs.map((input) => ({ ...input, ...backfillTargetTypes(input.value, organizations, people) }));
  const manifest = inputs.map(({ file, before }) => ({ file, sha256: createHash('sha256').update(before).digest('hex') }));
  const manifestText = JSON.stringify({ findings: manifest, evidence }, null, 2) + '\n';
  if (apply) {
    const ledger = await readRuns();
    const run = ledger.runs.find((r) => r.runId === process.env.WORKFLOW_RUN_ID && r.start && !r.finish);
    if (ledger.issues.length || !run?.start || run.start.operation !== 'backfill-totype'
      || run.start.batch.hash !== createHash('sha256').update(manifestText).digest('hex')) throw new Error('Matching active backfill-totype ledger run and frozen manifest required.');
    // Check every input before the first write; do not silently race a research pass.
    for (const p of plan) if (await readFile(p.path, 'utf8') !== p.before) throw new Error('Finding changed during planning.');
    for (const p of plan.filter((p) => p.changed.length)) {
      if (await readFile(p.path, 'utf8') !== p.before) throw new Error('Finding changed before write.');
      await writeFile(p.path, JSON.stringify(p.value, null, 2) + '\n');
    }
  } else await writeFile(join(reportDir, 'manifest.json'), manifestText);
  const report = { applied: apply, files: files.length, changedFiles: plan.filter((p) => p.changed.length).length,
    changedConnections: plan.reduce((n, p) => n + p.changed.length, 0),
    changes: plan.filter((p) => p.changed.length).map(({ file, changed }) => ({ file, changed })),
    unresolved: plan.flatMap(({ file, unresolved }) => unresolved.map((u) => ({ file, ...u }))) };
  await writeFile(join(reportDir, apply ? 'report.json' : 'dry-run.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`${report.changedConnections} connections in ${report.changedFiles} findings ${apply ? 'updated' : 'planned'}; ${report.unresolved.length} unresolved. Private report: workflows/connection-target-type/`);
}
main().catch(() => { console.error('Target-type backfill failed; inspect inputs and ledger before retrying.'); process.exitCode = 1; });
