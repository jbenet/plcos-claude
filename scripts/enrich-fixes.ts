/**
 * Records to fix in Affinity (W5 after the search pass): what the research found wrong or doubtful in
 * our own records — a title the pages contradict, a record that merges two people, a misspelled name,
 * a dead or parked domain, a firm renamed or merged away, a role that ended. Seven of fifteen next
 * steps in one batch began with such a fix; one list lets a person clear them in a sitting instead of
 * each owner meeting them one by one. Affinity stays read-only: this is a list for a person, never a
 * write.
 *
 *   DATA_PROFILE=real npx tsx scripts/enrich-fixes.ts
 *
 * Writes <data>/reports/records-to-fix-<date>.md and .json — they name LPs, so they live under the
 * data root and never in the repository; the enrichment page shows the latest — and prints counts only.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config/deployment';
import type { RecordToFix } from '../lib/enrich/fixes';

/** What the research says is wrong with our record. */
const FINDING = /(our record|on our record|record on file|on file|in our records?)[^.]{0,140}\b(wrong|out of date|stale|contradict\w*|misspell\w*|merge\w*|two (?:different )?people|dead|parked|renamed|no longer|ended|moved|left|fix)\b|\bfix (?:the|our) (?:contact|record)\b|contact to fix|merged record|misspell\w*|parked (?:page|domain)/i;
/** A next step that starts with fixing our record. */
const STEP = /\b(fix|correct|update)\b[^.]{0,50}\b(record|contact|title|name|domain|organi[sz]ation)\b|\brecord fix\b|\bbounce check\b|\bsent-mail check\b|\bmerged?\b[^.]{0,30}\brecord\b/i;

const KINDS: Array<[string, RegExp]> = [
  ['a record that merges two people', /merge|two (?:different )?people/i],
  ['a misspelled name', /misspell/i],
  ['a dead or parked domain', /dead|parked|bounce|domain/i],
  ['a firm renamed or merged away', /renamed|merged away|merged into|acquired/i],
  ['a role that ended or moved', /no longer|ended|left|departure|moved/i],
  ['a title the pages contradict', /title|role/i],
];


interface Cand { key: string; name: string; org: string | null; pursuits?: Array<{ pursuitId?: string; id?: string; status?: string; vehicle?: string }> }

async function main() {
  const root = join(process.cwd(), config.data.root);
  const dir = join(root, 'enrich');
  const cands = new Map<string, Cand>();
  for (const l of (await readFile(join(dir, 'candidates.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean)) {
    const c = JSON.parse(l) as Cand;
    cands.set(c.key, c);
  }
  const rows = new Map<string, { said: string[]; step: string | null }>();
  const add = (key: string) => rows.get(key) ?? rows.set(key, { said: [], step: null }).get(key)!;

  for (const f of (await readdir(join(dir, 'raw')).catch(() => [])).filter((x) => x.endsWith('.json'))) {
    const x = JSON.parse(await readFile(join(dir, 'raw', f), 'utf8')) as {
      key: string; profile?: { cautions?: string[] } | null; coverage?: { note?: string; notFound?: string[] } | null;
    };
    const texts = [...(x.profile?.cautions ?? []), x.coverage?.note ?? '', ...(x.coverage?.notFound ?? [])];
    for (const t of texts) if (t && FINDING.test(t)) add(x.key).said.push(t);
  }
  for (const f of (await readdir(join(dir, 'strategy')).catch(() => [])).filter((x) => x.endsWith('.json'))) {
    const s = JSON.parse(await readFile(join(dir, 'strategy', f), 'utf8')) as { key: string; next?: { what?: string; who?: string; when?: string } };
    const what = s.next?.what ?? '';
    if (STEP.test(what)) add(s.key).step = `${what}${s.next?.who ? ` — ${s.next.who}` : ''}${s.next?.when ? `, ${s.next.when}` : ''}`;
  }

  const kinds: Record<string, number> = {};
  const lines: string[] = [];
  const json: RecordToFix[] = [];
  const sorted = [...rows.entries()].sort((a, b) => (cands.get(a[0])?.name ?? '').localeCompare(cands.get(b[0])?.name ?? ''));
  for (const [key, r] of sorted) {
    const c = cands.get(key);
    const all = [...r.said, r.step ?? ''].join(' ');
    const kind = KINDS.find(([, re]) => re.test(all))?.[0] ?? 'something else on the record';
    kinds[kind] = (kinds[kind] ?? 0) + 1;
    const pursuit = c?.pursuits?.[0];
    const pid = pursuit?.pursuitId ?? pursuit?.id;
    lines.push(`### ${c?.name ?? key.slice(0, 8)}${c?.org ? ` · ${c.org}` : ''}`);
    lines.push('');
    const said = [...new Set(r.said)].slice(0, 3).map((t) => (t.length > 360 ? `${t.slice(0, 357)}…` : t));
    lines.push(`- **Kind:** ${kind}${pid ? ` · [their page](http://localhost:3100/all/pipeline/${pid})` : ''} · key \`${key.slice(0, 8)}\``);
    for (const t of said) lines.push(`- **The research:** ${t}`);
    if (r.step) lines.push(`- **The proposed step:** ${r.step}`);
    lines.push('');
    json.push({ key, name: c?.name ?? key.slice(0, 8), org: c?.org ?? null, pursuitId: pid ?? null, kind, said, step: r.step });
  }

  const date = new Date().toISOString().slice(0, 10);
  await mkdir(join(root, 'reports'), { recursive: true });
  const out = join(root, 'reports', `records-to-fix-${date}.md`);
  await writeFile(out, [
    `# Records to fix in Affinity — ${date}`,
    '',
    `Profile: ${config.data.profile}. ${rows.size} LPs whose record the research found wrong or in doubt, or whose proposed next step starts by fixing it. Affinity is read-only here: each fix is for a person to make there, and the research's words say why. A caution is a question, not a verdict — check it against our own mail first.`,
    '',
    '| Kind | LPs |',
    '|---|---|',
    ...Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `| ${k} | ${n} |`),
    '',
    ...lines,
  ].join('\n'));
  await writeFile(out.replace(/\.md$/, '.json'), JSON.stringify({ at: new Date().toISOString(), kinds, rows: json }, null, 1));
  console.log(`records to fix: ${rows.size} LPs · ${JSON.stringify(kinds)} · written under ${config.data.root}/reports/`);
}

main().catch((err: unknown) => { console.error(err); process.exit(1); });
