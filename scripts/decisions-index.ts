/** List the curated repository decision log; never harvest data or write an index. */
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const folder = new URL('../docs/decisions/', import.meta.url);
type Decision = {
  date: string; who: string; decision: string; quote: string; source: string;
  scope: string[]; supersedes: string[];
};
const keys = ['date', 'who', 'decision', 'quote', 'source', 'scope', 'supersedes'];
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string' && x.trim());
const sourceAllowed = /^(?:AGENTS\.md|docs\/[^/]+\.md|docs\/agent-rules\/[^/]+\.md|docs\/changelog\/(?:entries\/)?[^/]+\.md)$/;

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--json')) throw new Error('Usage: decisions-index.ts [--json]');
  const files = (await readdir(folder, { withFileTypes: true }))
    .filter(f => f.isFile() && f.name !== 'README.md' && f.name.endsWith('.md'))
    .map(f => f.name).sort();
  const rows = [];
  for (const file of files) {
    if (!/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.md$/.test(file)) throw new Error(`Invalid decision filename: ${file}`);
    const text = await readFile(new URL(file, folder), 'utf8');
    const front = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text)?.[1];
    if (!front) throw new Error(`Missing frontmatter: ${file}`);
    const fields: Record<string, unknown> = {};
    for (const line of front.split('\n')) {
      const match = /^(\w+): (.+)$/.exec(line);
      if (!match || !keys.includes(match[1]!) || match[1]! in fields) throw new Error(`Invalid field: ${file}`);
      fields[match[1]!] = JSON.parse(match[2]!);
    }
    for (const key of keys.slice(0, 5)) {
      if (typeof fields[key] !== 'string' || !(fields[key] as string).trim()) throw new Error(`Missing ${key}: ${file}`);
    }
    if (!strings(fields.scope) || !fields.scope.length || !strings(fields.supersedes)) throw new Error(`Invalid scope/supersedes: ${file}`);
    const row = fields as Decision;
    if (file.slice(0, 10) !== row.date || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)
      || new Date(row.date).toISOString().slice(0, 10) !== row.date) throw new Error(`Invalid date: ${file}`);
    if (!sourceAllowed.test(row.source) || row.source.split('/').includes('..')) throw new Error(`Source outside seed corpus: ${file}`);
    for (const prior of row.supersedes) {
      if (!files.includes(prior) || prior === file || prior.slice(0, 10) > row.date) throw new Error(`Invalid supersedes link: ${file}`);
    }
    rows.push({ file: `docs/decisions/${file}`, ...row });
  }
  if (args.includes('--json')) console.log(JSON.stringify(rows, null, 2));
  else {
    const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ');
    console.log('| Date | Who | Decision | Scope | Supersedes |');
    console.log('| --- | --- | --- | --- | --- |');
    for (const row of rows) console.log(`| ${row.date} | ${cell(row.who)} | [${cell(row.decision)}](${row.file}) | ${cell(row.scope.join(', '))} | ${cell(row.supersedes.join(', ') || '—')} |`);
    console.log(`\n${rows.length} decisions. Source: ${fileURLToPath(folder)}`);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
