import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { fileFeedback } from '@/modules/platform';
import type { IssueAttachment, IssueKind, IssuePriority } from '@/lib/issues';

/**
 * The first real sentence of the body, cleaned of markdown furniture and cut to a length a
 * list can show. Returns an empty string when there is nothing to name — the caller refuses
 * rather than filing "Feedback on /approvals" as if it meant something.
 */
function titleFrom(body: string, page: string): string {
  const line = body
    .split(/\n/)
    .map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)]|>|#{1,6})\s*/, '').trim())
    .find((l) => l.length > 0 && !l.startsWith('```') && !l.startsWith('!['));
  if (!line) return '';
  const plain = line
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .trim();
  if (!plain) return '';
  const cut = plain.length <= 72 ? plain : `${plain.slice(0, 71).replace(/\s+\S*$/, '')}…`;
  return page && cut.length < 18 ? `${cut} (${page})` : cut;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      title?: string; body?: string; kind?: IssueKind; priority?: IssuePriority;
      page?: string; context?: Record<string, unknown>; screenshots?: string[];
      images?: Array<{ name?: string; dataUrl?: string }>;
      imageOffset?: number;
    };
    /**
     * Intake writes the title when the reporter did not (issue 0012).
     *
     * Making somebody name a bug before they can describe it is a tax on the complaint, and
     * the name they invent under that pressure is usually worse than the first line of what
     * they actually wrote. What intake cannot do is invent the *complaint* — a report with
     * neither a title nor a body is still refused.
     */
    const title = body.title?.trim() || titleFrom(body.body ?? '', body.page ?? '/');
    if (!title) {
      return NextResponse.json(
        { error: 'Say what happened. A title or a description — either is enough, neither is not.' },
        { status: 400 },
      );
    }
    /**
     * Everything arrives as a data URL from the reporter's own browser. Only the four
     * image types are accepted, only the base64 body is kept, and the sink names the
     * files — so nothing here can choose a path and nothing here is executed.
     *
     * Order matters: the screenshot is attachment 1 when it is included, and the body's
     * `attachment:N` tokens are numbered against this array.
     */
    const TYPES = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/;
    const MAX_B64 = 12_000_000;
    const attachments: IssueAttachment[] = [];

    for (const shot of body.screenshots ?? []) {
      const m = TYPES.exec(shot);
      if (!m || m[1] !== 'image/png') {
        return NextResponse.json({ error: 'A screenshot was not a PNG.' }, { status: 400 });
      }
      if (m[2]!.length > MAX_B64) {
        return NextResponse.json({ error: 'A screenshot is too large.' }, { status: 413 });
      }
      attachments.push({ kind: 'screenshot', contentType: 'image/png', base64: m[2]! });
    }

    for (const img of body.images ?? []) {
      const m = TYPES.exec(img.dataUrl ?? '');
      if (!m) {
        return NextResponse.json(
          { error: 'An attached file was not a PNG, JPEG, GIF or WebP.' }, { status: 400 },
        );
      }
      if (m[2]!.length > MAX_B64) {
        return NextResponse.json({ error: 'An attached file is too large.' }, { status: 413 });
      }
      attachments.push({
        kind: 'image',
        contentType: m[1] as IssueAttachment['contentType'],
        base64: m[2]!,
        name: img.name,
      });
    }

    const user = await (await auth()).currentUser();
    const issue = await fileFeedback(user, {
      title,
      body: body.body ?? '',
      kind: body.kind ?? 'bug',
      priority: body.priority ?? 'P2',
      page: body.page ?? '/',
      context: body.context ?? {},
      attachments,
      imageOffset: body.imageOffset ?? 0,
    });
    return NextResponse.json({
      id: issue.id, location: issue.location, attachments: issue.attachments,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
