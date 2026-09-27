import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { groupChangelog, parseMarkdown, type Block } from './markdown';

const ROOT = join('docs', 'changelog');

/** The index is the reading order, including the original preamble and era dividers. */
export async function changelogFiles(): Promise<string[]> {
  const index = await readFile(join(process.cwd(), ROOT, 'index.md'), 'utf8');
  const names = [...index.matchAll(/^- \[.+\]\(entries\/([a-z0-9-]+\.md)\)$/gm)].map((m) => m[1]!);
  if (!names.length || new Set(names).size !== names.length) throw new Error('Invalid changelog index');
  return names.map((name) => join(ROOT, 'entries', name));
}

/** Reassemble the unchanged Markdown before parsing, preserving anchors and ordering. */
export async function readChangelog(): Promise<string> {
  return (await Promise.all((await changelogFiles()).map((file) =>
    readFile(join(process.cwd(), file), 'utf8')))).join('\n');
}

export interface ChangelogRef {
  /** The anchor on /dev/changelog. */
  id: string;
  /** The entry's own page: /dev/changelog/<slug> (issue 0098). */
  slug: string;
  /** `N30`. */
  key: string;
  /** The half after the em dash. */
  title: string;
}

/**
 * Find a version's entry without reading the whole history (issue 0011).
 *
 * An issue records the version that closed it; a reader wants the paragraph that says what
 * changed. Looking it up here rather than storing an anchor on the issue keeps one copy of
 * the heading — rename an entry and the link follows it instead of rotting.
 */
export async function changelogEntry(version: string): Promise<ChangelogRef | null> {
  if (!/^[A-Z]\d+$/.test(version)) return null;
  let src: string;
  try {
    const file = join(ROOT, 'entries', `${version.toLowerCase()}.md`);
    if (!(await changelogFiles()).includes(file)) return null;
    src = await readFile(join(process.cwd(), file), 'utf8');
  } catch {
    return null;
  }
  const doc = groupChangelog(parseMarkdown(src));
  const hit = doc.entries.find((e) => !e.divider && e.key === version);
  return hit ? { id: hit.id, slug: version.toLowerCase(), key: hit.key, title: hit.rest } : null;
}

/*
 * Batches (issue 0098). Every entry is its own file and opens on its own page; the page reads them
 * ten at a time. Batches are cut from the index's order, oldest first, so they never move: batch 1
 * is always the first ten. The latest batch is the one still growing — at its eleventh entry the ten
 * before become a closed batch and the new entry starts the next. Nothing is renamed or moved on
 * disk, so an agent still reads one entry file and the index, never a batch.
 */
export const BATCH_SIZE = 10;

export interface ChangelogItem {
  /** The file's name without `.md`, which is also the address: /dev/changelog/<slug>. */
  slug: string;
  file: string;
  /** The index's link text. */
  label: string;
  /** `N30`, `0096`, `perf3`; empty when the title has no short key before its dash. */
  key: string;
  title: string;
  /** 1-based position in the index, the preamble excluded. */
  n: number;
  batch: number;
}
export interface ChangelogBatch { n: number; items: ChangelogItem[]; latest: boolean; range: string }

const ENTRY = /^- \[(.+)\]\(entries\/([a-z0-9-]+)\.md\)$/gm;

/** "N30 — Title" → N30 and Title; a long or plain first half stays part of the title. */
export function splitLabel(label: string): { key: string; title: string } {
  const at = label.indexOf(' \u2014 ');
  if (at > 0) {
    const key = label.slice(0, at).trim();
    if (key.length <= 28 && (/\d/.test(key) || /^[a-z][a-z-]*$/.test(key))) return { key, title: label.slice(at + 3).trim() };
  }
  return { key: '', title: label };
}

export async function changelogItems(): Promise<ChangelogItem[]> {
  const index = await readFile(join(process.cwd(), ROOT, 'index.md'), 'utf8');
  const out: ChangelogItem[] = [];
  for (const m of index.matchAll(ENTRY)) {
    const slug = m[2]!;
    if (slug === 'preamble') continue;
    const n = out.length + 1;
    out.push({ slug, file: join(ROOT, 'entries', `${slug}.md`), label: m[1]!, ...splitLabel(m[1]!), n, batch: Math.ceil(n / BATCH_SIZE) });
  }
  if (!out.length || new Set(out.map((i) => i.slug)).size !== out.length) throw new Error('Invalid changelog index');
  return out;
}

/** A short name for a range: the key, else the issue numbers in the title, else its first words. */
const short = (i: ChangelogItem) =>
  i.key || /\b0\d{3}(?:[–-]0\d{3})?/.exec(i.title)?.[0] || (i.title.length > 22 ? `${i.title.slice(0, 20).trim()}…` : i.title);

export function changelogBatches(items: ChangelogItem[]): ChangelogBatch[] {
  const last = items.at(-1)?.batch ?? 0;
  return Array.from({ length: last }, (_, k) => {
    const batch = items.filter((i) => i.batch === k + 1);
    return { n: k + 1, items: batch, latest: k + 1 === last, range: batch.length === 1 ? short(batch[0]!) : `${short(batch[0]!)} → ${short(batch.at(-1)!)}` };
  });
}

export interface ChangelogBody { item: ChangelogItem; blocks: Block[]; divider: boolean }

/**
 * One entry's body, without its own heading. An entry may open with `#` or `##` (both are in the
 * files); a heading-only interlude such as "Beyond L13" is an era divider rather than an entry.
 */
export async function changelogBody(item: ChangelogItem): Promise<ChangelogBody> {
  const blocks = parseMarkdown(await readFile(join(process.cwd(), item.file), 'utf8'));
  const first = blocks.findIndex((b) => b.kind === 'heading');
  const level = first >= 0 && blocks[first]!.kind === 'heading' ? blocks[first]!.level : 2;
  const body = blocks.filter((b, i) => i !== first).filter((b, i, all) => !(b.kind === 'rule' && i === all.length - 1));
  return { item, blocks: body, divider: level === 1 && !item.key && body.filter((b) => b.kind !== 'rule').length <= 1 };
}

/** The preamble's text, the first heading dropped. */
export async function changelogPreamble(): Promise<Block[]> {
  const blocks = parseMarkdown(await readFile(join(process.cwd(), ROOT, 'entries', 'preamble.md'), 'utf8'));
  return blocks.filter((b) => !(b.kind === 'heading' && b.level === 1) && b.kind !== 'rule');
}
