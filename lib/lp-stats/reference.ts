import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Reference } from './model';

/**
 * The reference distribution the Coverage panel compares with: config/lp-market-reference.json,
 * read on each request so a research run's edit shows without a rebuild. A file that is missing or
 * malformed yields null, and the panel says so instead of comparing with nothing.
 */
export async function marketReference(): Promise<Reference | null> {
  try {
    const raw = JSON.parse(await readFile(join(process.cwd(), 'config', 'lp-market-reference.json'), 'utf8')) as Partial<Reference>;
    const shares = (x: unknown) => (x && typeof x === 'object'
      ? Object.fromEntries(Object.entries(x as Record<string, unknown>).filter((e): e is [string, number] => typeof e[1] === 'number' && e[1] >= 0))
      : {});
    if (typeof raw.source !== 'string' || typeof raw.asOf !== 'string') return null;
    return {
      source: raw.source, asOf: raw.asOf, placeholder: raw.placeholder !== false, note: typeof raw.note === 'string' ? raw.note : '',
      region: shares(raw.region), type: shares(raw.type),
    };
  } catch {
    return null;
  }
}
