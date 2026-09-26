import type { Check } from './harness';
import { join } from 'node:path';

export async function docsProperties(check: Check) {
  {
    // Docs is reachable without sign-in: slugs select catalog entries, never filesystem paths.
    const { docFileForSlug, listSystemDocs, readSystemDoc, docLink } = await import('../../lib/docs');
    const docs = await listSystemDocs();
    const invalid = [
      '../data/real/x', '..%2Fdata%2Freal%2Fx', '%2e%2e%2fdata%2freal%2fx',
      '%252e%252e%252fdata%252freal%252fx', '..\\data\\real\\x', '%2e%2e%5cdata%5creal%5cx',
      '/data/real/x', 'docs/../data/real/x', 'docs-../data/real/x', 'unknown-doc',
      'constructor', '__proto__', 'agents%00', 'agents/../../data/real/x',
    ];
    const rejected = await Promise.all(invalid.map(async (slug) =>
      await docFileForSlug(slug) === null && await readSystemDoc(slug) === null));
    const permitted = docs.every((doc) => /^docs\/(?:19\/|agent-rules\/|workflows\/)?[^/]+\.md$/.test(doc.file)
      || doc.file === 'AGENTS.md' || doc.file === 'issues/README.md');
    const readable = await Promise.all(docs.map(async (doc) =>
      await docFileForSlug(doc.slug) === doc.file && Boolean(await readSystemDoc(doc.slug))));
    check('System docs expose only the catalog: traversal, encoded traversal and unknown slugs find no file',
      permitted && rejected.every(Boolean) && readable.every(Boolean)
        && docs[0]?.file === 'AGENTS.md' && docs[1]?.file === 'docs/13-synthesis-r3.md'
        && docs.filter((doc) => doc.superseded).length === 3,
      `${rejected.filter(Boolean).length}/${invalid.length} invalid slugs refused; ${readable.filter(Boolean).length}/${docs.length} listed docs readable; allowed paths only: ${permitted}; guide and current plan first`);
    check('Document links stay in the reader, preserve anchors, and never link arbitrary local files',
      docLink('docs/09-system-architecture.md', 'AGENTS.md', docs) === '/dev/docs/docs-09-system-architecture'
      && docLink('15-affinity-integration.md#2-decisions', 'docs/13-synthesis-r3.md', docs) === '/dev/docs/docs-15-affinity-integration#2-decisions'
      && docLink('../AGENTS.md', 'docs/COLLAB.md', docs) === '/dev/docs/agents'
      && docLink('docs/19/set.md', 'AGENTS.md', docs) === '/dev/docs/docs-19-set'
      && docLink('../workflows/w1-profile.md', 'docs/19/set.md', docs) === '/dev/docs/docs-workflows-w1-profile'
      && docLink('../data/real/x', 'docs/COLLAB.md', docs) === null
      && docLink('javascript:alert(1)', 'AGENTS.md', docs) === null,
      'repo-root links, sibling docs, nested workflow docs and parent AGENTS resolve; data paths and script URLs do not');

    const fs = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const sandbox = await fs.mkdtemp(join(tmpdir(), 'plcos-docs-props-'));
    const cwd = process.cwd();
    let safeFiles = false;
    let safeDirectories = false;
    try {
      // Fictional sentinel, outside this fixture’s listed locations. Never read real data.
      await fs.mkdir(join(sandbox, 'docs'));
      await fs.mkdir(join(sandbox, 'issues'));
      await fs.mkdir(join(sandbox, 'private'));
      await fs.writeFile(join(sandbox, 'private', 'secret.md'), 'not a system document');
      await fs.writeFile(join(sandbox, 'docs', '01-allowed.md'), '# Allowed');
      await fs.symlink('../private/secret.md', join(sandbox, 'docs', '02-link.md'));
      await fs.symlink('private/secret.md', join(sandbox, 'AGENTS.md'));
      await fs.symlink('../private/secret.md', join(sandbox, 'issues', 'README.md'));
      await fs.symlink('../private', join(sandbox, 'docs', '19'));
      await fs.mkdir(join(sandbox, 'docs', 'workflows'));
      await fs.symlink('../../private/secret.md', join(sandbox, 'docs', 'workflows', 'w1-profile.md'));
      process.chdir(sandbox);
      const listed = await listSystemDocs();
      safeFiles = listed.length === 1 && listed[0]?.file === 'docs/01-allowed.md'
        && await docFileForSlug('docs-02-link') === null && await docFileForSlug('agents') === null
        && await docFileForSlug('issues-readme') === null
        && await docFileForSlug('docs-19-secret') === null
        && await docFileForSlug('docs-workflows-w1-profile') === null;
      await fs.rm(join(sandbox, 'docs'), { recursive: true });
      await fs.rm(join(sandbox, 'issues'), { recursive: true });
      await fs.symlink('private', join(sandbox, 'docs'));
      await fs.symlink('private', join(sandbox, 'issues'));
      safeDirectories = (await listSystemDocs()).length === 0;
    } finally {
      process.chdir(cwd);
      await fs.rm(sandbox, { recursive: true, force: true });
    }
    check('A symlink cannot expand the docs catalog, whether it replaces a listed file or a directory',
      safeFiles && safeDirectories, `symlinked files refused: ${safeFiles}; symlinked directories refused: ${safeDirectories}`);
  }
}
