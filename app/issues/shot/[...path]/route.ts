import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { config } from '@/config/deployment';

/**
 * Serve an issue's attachment.
 *
 * Attachments live beside the issues in the repository rather than in public/, so the
 * complaint, its screenshot and its fix all travel in one pull request. The path is
 * normalised and re-rooted, and only a PNG is served — a traversal cannot walk out and
 * nothing here is executed.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const rel = normalize(path.join('/'));
  if (rel.startsWith('..') || rel.includes('\0') || !/\.png$/i.test(rel)) {
    return new Response('Not found', { status: 404 });
  }
  try {
    const bytes = await readFile(join(process.cwd(), config.issues.dir, rel));
    return new Response(new Uint8Array(bytes), {
      headers: { 'content-type': 'image/png', 'cache-control': 'no-store' },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
