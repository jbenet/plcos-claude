/** List SQL whose ORDER BY sorts on a ::text output column (lib/dev/sql-order-shadow.ts). */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { orderByShadows } from '../lib/dev/sql-order-shadow';

export function sourceFiles(roots = ['lib', 'modules', 'app']): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(name)) out.push(path);
    }
  };
  for (const root of roots) walk(root);
  return out.sort();
}

export function scan(roots?: string[]): string[] {
  return sourceFiles(roots).flatMap((file) => orderByShadows(readFileSync(file, 'utf8')).map((h) => `${file}:${h.line} order by ${h.column}`));
}

if (process.argv[1]?.endsWith('sql-shadow-scan.ts')) {
  const hits = scan(process.argv.slice(2).length ? process.argv.slice(2) : undefined);
  for (const h of hits) console.log(h);
  console.log(`${hits.length} hit(s)`);
}
