import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '@/config/deployment';

/**
 * Records to fix in Affinity (W5 after the search pass), as scripts/enrich-fixes.ts writes them under
 * the data root's reports: what the research found wrong or in doubt in our own records, and the next
 * steps that start by fixing one. A list for a person — Affinity stays read-only.
 */
export interface RecordToFix { key: string; name: string; org: string | null; pursuitId: string | null; kind: string; said: string[]; step: string | null }
export interface RecordsToFix { at: string; kinds: Record<string, number>; rows: RecordToFix[] }

/** The newest list, or null when none has been written. */
export async function latestRecordsToFix(): Promise<RecordsToFix | null> {
  const dir = join(process.cwd(), config.data.root, 'reports');
  const files = (await readdir(dir).catch(() => [])).filter((f) => /^records-to-fix-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  const last = files[files.length - 1];
  if (!last) return null;
  try { return JSON.parse(await readFile(join(dir, last), 'utf8')) as RecordsToFix; } catch { return null; }
}
