import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';

const ROOT = 'docs/changelog/shots';

/**
 * Serve changelog screenshots to the in-app changelog.
 *
 * They live in docs/ rather than public/ because they belong to the repository's history,
 * not to the app's asset bundle — copying fifty images into public/ to render one page is
 * the wrong trade. The path is normalised and re-rooted so a traversal cannot walk out.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const rel = normalize(path.join('/'));
  // WebP since issue 0021; PNG so a checkout of an older commit still renders its changelog.
  const type = /\.webp$/i.test(rel) ? 'image/webp' : /\.png$/i.test(rel) ? 'image/png' : null;
  if (rel.startsWith('..') || rel.includes('\0') || !type) {
    return new Response('Not found', { status: 404 });
  }
  try {
    const bytes = await readFile(join(process.cwd(), ROOT, rel));
    return new Response(new Uint8Array(bytes), {
      headers: { 'content-type': type, 'cache-control': 'no-store' },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
