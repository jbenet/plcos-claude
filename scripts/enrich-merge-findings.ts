/**
 * Merge each LP's older findings into its newest one (lib/enrich/merge-findings.ts). An older finding joins only by key
 * or the export's alias map, never by name, and only when it was a confirmed or probable match. Writes the newest file
 * in place with a dated correction; the older files stay as they are.
 *
 *   DATA_PROFILE=real npx tsx scripts/enrich-merge-findings.ts [--dry] [--list <file>] [--redo <raw before the merge>]
 *
 * `--list` writes the merged keys, one per line, for the push and the W5 queue. `--redo` takes the raw folder as it was
 * before a merge and restores each revised file (fact-checked or W1-revised) that merge wrote, with a dated note
 * (7 Oct 2026: a value W1c had cut, then one a W1q revision had dropped, came back through the merge).
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config/deployment';
import { candidateKey } from '../lib/enrich/candidate-key';
import { mergeFindings, revised } from '../lib/enrich/merge-findings';
import { check, type Finding } from '../lib/enrich/schema';

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const listFile = args.includes('--list') ? args[args.indexOf('--list') + 1] : null;
  const redo = args.includes('--redo') ? args[args.indexOf('--redo') + 1] : null;
  const enrich = join(process.cwd(), config.data.root, 'enrich');
  const raw = join(enrich, 'raw');
  const cands = (await readFile(join(enrich, 'candidates.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean).map((l) => JSON.parse(l) as { key: string; name: string });
  const aliases: Record<string, string> = JSON.parse(await readFile(join(enrich, 'entity-keys.json'), 'utf8').catch(() => '{}'));
  const groups = new Map<string, Array<{ file: string; f: Finding }>>();
  let unreadable = 0;
  for (const file of (await readdir(raw)).filter((x) => x.endsWith('.json'))) {
    let f: Finding;
    try { f = JSON.parse(await readFile(join(raw, file), 'utf8')) as Finding; } catch { unreadable++; continue; }
    if (check(f, file.replace(/\.json$/, '')).length) { unreadable++; continue; }
    if (!['confirmed', 'probable'].includes(f.identity?.match ?? '')) continue;
    // By key or alias only: the name fallback is turned off by leaving out the match.
    const key = candidateKey(f, cands, aliases, { ...f, identity: { ...f.identity, match: undefined } } as never);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), { file, f }]);
  }
  const now = new Date().toISOString();
  let lps = 0, facts = 0, connections = 0, refused = 0;
  const merged: string[] = [];
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    group.sort((a, b) => b.f.researched.at.localeCompare(a.f.researched.at));
    const [newest, ...older] = group;
    const by = 'rule (scripts/enrich-merge-findings.ts)';
    let out: ReturnType<typeof mergeFindings>;
    if (redo) {
      // Only a file a merge wrote for an LP with a revised (fact-checked or W1-revised) finding: rebuilt from its copy before the merge, with a dated note either way.
      const mergedBefore = (newest!.f.researched.corrected ?? []).some((c) => /enrich-merge-findings/.test(c.by ?? ''));
      if (!mergedBefore || !group.some((g) => revised(g.f))) continue;
      const before = JSON.parse(await readFile(join(redo, newest!.file), 'utf8').catch(() => 'null')) as Finding | null;
      if (!before) { console.log(`  no copy before the merge for ${newest!.file}`); continue; }
      if (JSON.stringify(before) === JSON.stringify(newest!.f)) continue; // That merge didn't write it.
      const again = mergeFindings(before, older.map((o) => o.f), now, by);
      const merged = again.merged === before ? { ...before, researched: { ...before.researched, corrected: [...(before.researched.corrected ?? [])] } } : again.merged;
      merged.researched.corrected = [...(merged.researched.corrected ?? []), { at: now, by,
        what: 'redone: a finding a fact check or a W1 revision corrected takes no facts by rule; the merge into it is undone' }];
      out = { merged, facts: again.facts, connections: again.connections };
    } else {
      out = mergeFindings(newest!.f, older.map((o) => o.f), now, by);
      if (!out.facts && !out.connections) continue;
    }
    const problems = check(out.merged, newest!.file.replace(/\.json$/, ''));
    if (problems.length) { refused++; console.log(`  refused ${newest!.file}: ${problems.slice(0, 3).join('; ')}`); continue; }
    if (!dry) await writeFile(join(raw, newest!.file), JSON.stringify(out.merged, null, 2));
    lps++; facts += out.facts; connections += out.connections; merged.push(key);
  }
  if (listFile && !dry) await writeFile(listFile, merged.join('\n') + '\n');
  console.log(`merge findings${redo ? ' (redo of revised files)' : ''}: ${lps} LPs ${redo ? 'rewritten' : 'merged'}, ${facts} facts and ${connections} connections added${dry ? ' (dry run, nothing written)' : ''} · ${refused} refused by the validator · ${unreadable} files skipped (unreadable or invalid) · ${[...groups.values()].filter((g) => g.length > 1).length} LPs with more than one finding`);
}

main();
