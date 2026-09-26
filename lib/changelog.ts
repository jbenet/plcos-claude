import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { groupChangelog, parseMarkdown } from './markdown';

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
  return hit ? { id: hit.id, key: hit.key, title: hit.rest } : null;
}
