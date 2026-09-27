import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Basis, Reference } from './model';

/**
 * The reference the Coverage panel compares with: config/lp-market-reference.json, read on each
 * request so a research run's edit shows without a rebuild. A missing or malformed file yields null,
 * and the panel says so instead of comparing with nothing. A file with only `region` and `type`
 * shares (the first format) reads as one basis each.
 */
export async function marketReference(): Promise<Reference | null> {
  try {
    const raw = JSON.parse(await readFile(join(process.cwd(), 'config', 'lp-market-reference.json'), 'utf8')) as Record<string, unknown>;
    return readReference(raw);
  } catch {
    return null;
  }
}

const text = (x: unknown) => (typeof x === 'string' ? x : '');
function shares(x: unknown): Record<string, number> {
  return x && typeof x === 'object'
    ? Object.fromEntries(Object.entries(x as Record<string, unknown>).filter((e): e is [string, number] => typeof e[1] === 'number' && e[1] >= 0))
    : {};
}

export function readReference(raw: Record<string, unknown>): Reference | null {
  if (typeof raw.source !== 'string' || typeof raw.asOf !== 'string') return null;
  const groups: Reference['groups'] = {};
  for (const [k, g] of Object.entries((raw.groups ?? {}) as Record<string, { label?: unknown; members?: unknown }>)) {
    if (typeof g?.label === 'string' && Array.isArray(g.members)) groups[k] = { label: g.label, members: g.members.filter((m): m is string => typeof m === 'string') };
  }
  const bases: Basis[] = [];
  for (const b of Array.isArray(raw.bases) ? raw.bases as Array<Record<string, unknown>> : []) {
    if ((b.dimension !== 'region' && b.dimension !== 'type') || typeof b.id !== 'string') continue;
    const s = b.shares === null || b.shares === undefined ? null : shares(b.shares);
    bases.push({
      id: b.id, dimension: b.dimension, label: text(b.label) || b.id, what: text(b.what), source: text(b.source), asOf: text(b.asOf),
      confidence: text(b.confidence), shares: s && Object.keys(s).length ? s : null, ...(typeof b.figure === 'string' ? { figure: b.figure } : {}),
      ...(Array.isArray(b.compare) ? { compare: (b.compare as Array<{ label?: unknown; members?: unknown }>).filter((c) => typeof c.label === 'string' && Array.isArray(c.members))
        .map((c) => ({ label: c.label as string, members: (c.members as unknown[]).filter((m): m is string => typeof m === 'string') })) } : {}),
    });
  }
  const region = shares(raw.region), type = shares(raw.type);
  // The first format: one distribution each, described by the file's own source.
  for (const [dimension, s] of [['region', region], ['type', type]] as const) {
    if (!bases.some((b) => b.dimension === dimension && b.shares) && Object.keys(s).length) {
      bases.push({ id: dimension, dimension, label: text(raw.source), what: text(raw.note), source: text(raw.source), asOf: text(raw.asOf), confidence: '', shares: s });
    }
  }
  return { source: raw.source, asOf: raw.asOf, placeholder: raw.placeholder !== false, note: text(raw.note), region, type, groups, bases };
}
