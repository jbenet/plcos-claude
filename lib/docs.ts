import { lstat, readdir, readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { parseInline, parseMarkdown } from './markdown';

export interface SystemDoc {
  slug: string;
  file: string;
  title: string;
  superseded: boolean;
}

/** No symlinks, including the parent directories. Never scan data/ or recurse. */
async function regular(path: string, directory = false): Promise<boolean> {
  try {
    const stat = await lstat(join(process.cwd(), path));
    return directory ? stat.isDirectory() : stat.isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function docFiles(): Promise<Array<{ slug: string; file: string }>> {
  const files: Array<{ slug: string; file: string }> = [];
  if (await regular('AGENTS.md')) files.push({ slug: 'agents', file: 'AGENTS.md' });
  if (await regular('docs', true)) {
    const entries = await readdir(join(process.cwd(), 'docs'), { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        // The prefix keeps these distinct from the two specially named files.
        files.push({ slug: `docs-${entry.name.slice(0, -3)}`, file: `docs/${entry.name}` });
      }
    }
  }
  if (await regular('issues', true) && await regular('issues/README.md')) {
    files.push({ slug: 'issues-readme', file: 'issues/README.md' });
  }
  const order = (file: string): number => file === 'AGENTS.md' ? -2
    : file === 'docs/13-synthesis-r3.md' ? -1
    : /^docs\/\d+-/.test(file) ? Number(file.slice(5).split('-')[0])
    : file.startsWith('docs/') ? 100 : 101;
  return files.sort((a, b) => order(a.file) - order(b.file) || a.file.localeCompare(b.file));
}

/**
 * The only URL-slug → file lookup. Exact membership, no decoding or URL-derived path joins.
 * Encoded traversal, separators, absolute paths and unknown slugs all fail closed.
 */
export async function docFileForSlug(slug: string): Promise<string | null> {
  return (await docFiles()).find((doc) => doc.slug === slug)?.file ?? null;
}

export const docHref = (slug: string) => `/dev/docs/${encodeURIComponent(slug)}`;

export async function listSystemDocs(): Promise<SystemDoc[]> {
  return Promise.all((await docFiles()).map(async (doc) => {
    const source = await readFile(join(process.cwd(), doc.file), 'utf8');
    const firstHeading = parseMarkdown(source, { document: true }).find((block) => block.kind === 'heading');
    const title = firstHeading?.kind === 'heading'
      ? parseInline(firstHeading.text).map((span) => span.text).join('') : doc.file;
    return { ...doc, title, superseded: /^docs\/(10|11|12)-/.test(doc.file) };
  }));
}

export async function readSystemDoc(slug: string): Promise<string | null> {
  const file = await docFileForSlug(slug);
  return file ? readFile(join(process.cwd(), file), 'utf8') : null;
}

/** Resolve references against the same catalog; this function never reads a file. */
export function docLink(href: string, fromFile: string, docs: readonly SystemDoc[]): string | null {
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith('#')) return href;
  const cut = href.search(/[?#]/);
  const path = cut < 0 ? href : href.slice(0, cut);
  const suffix = cut < 0 ? '' : href.slice(cut);
  // Some repo references start at the root (docs/…), others at the current document.
  const file = path.startsWith('docs/') || path === 'AGENTS.md' || path === 'issues/README.md'
    ? path : posix.normalize(posix.join(posix.dirname(fromFile), path));
  if (file === 'CHANGELOG.md') return `/dev/changelog${suffix}`;
  const doc = docs.find((item) => item.file === file);
  return doc ? `${docHref(doc.slug)}${suffix}` : null;
}
