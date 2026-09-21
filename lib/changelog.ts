import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { groupChangelog, parseMarkdown } from './markdown';

export interface ChangelogRef {
  /** The anchor on /dev/changelog. */
  id: string;
  /** `N30`. */
  key: string;
  /** The half after the em dash. */
  title: string;
}

/**
 * Find a version's entry in CHANGELOG.md (issue 0011).
 *
 * An issue records the version that closed it; a reader wants the paragraph that says what
 * changed. Looking it up here rather than storing an anchor on the issue keeps one copy of
 * the heading — rename an entry and the link follows it instead of rotting.
 */
export async function changelogEntry(version: string): Promise<ChangelogRef | null> {
  if (!/^[A-Z]\d+$/.test(version)) return null;
  let src: string;
  try {
    src = await readFile(join(process.cwd(), 'CHANGELOG.md'), 'utf8');
  } catch {
    return null;
  }
  const doc = groupChangelog(parseMarkdown(src));
  const hit = doc.entries.find((e) => !e.divider && e.key === version);
  return hit ? { id: hit.id, key: hit.key, title: hit.rest } : null;
}
