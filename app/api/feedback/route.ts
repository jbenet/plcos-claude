import type { Queryable } from '@/lib/db';
import { NextResponse } from 'next/server';
import { config } from '@/config/deployment';
import { feedbackHome } from '@/config/ports';
import { auth } from '@/lib/auth';
import { fileFeedback } from '@/modules/platform';
import type { IssueAttachment, IssueKind, IssuePriority } from '@/lib/issues';
import { titleFrom } from '@/lib/issues/title';
import { isClientId } from '@/lib/feedback-journal';
import { cookies } from 'next/headers';
import { USER_COOKIE } from '@/lib/auth/local';

export async function POST(req: Request) {
  // Only the live app files (docs/COLLAB.md): a branch filing would take numbers the live app
  // gives out too. The box on a dev worktree says so; this refuses anything that asks anyway.
  if (!feedbackHome(config.data.profile).filesHere) {
    return NextResponse.json(
      { error: 'This server runs a branch in development. Feedback is filed from the live app, so issue numbers never collide (docs/COLLAB.md).' },
      { status: 403 },
    );
  }
  try {
    const body = (await req.json()) as {
      title?: string; body?: string; kind?: IssueKind; priority?: IssuePriority;
      page?: string; context?: Record<string, unknown>; screenshots?: string[];
      images?: Array<{ name?: string; dataUrl?: string }>;
      imageOffset?: number;
      /** The browser journal's id for this report (lib/feedback-journal.ts). */
      clientId?: unknown;
    };
    // A resend after a timeout that did reach this server must not file twice: the sink answers a
    // client id it has seen with the issue it already made. Anything else is refused, not ignored.
    if (body.clientId !== undefined && !isClientId(body.clientId)) {
      return NextResponse.json({ error: 'The report\'s client id is malformed.' }, { status: 400 });
    }
    const clientId = body.clientId as string | undefined;
    /**
     * Intake writes the title when the reporter did not (issue 0012).
     *
     * Making somebody name a bug before they can describe it is a tax on the complaint, and
     * the name they invent under that pressure is usually worse than the first line of what
     * they actually wrote. What intake cannot do is invent the *complaint* — a report with
     * neither a title nor a body is still refused.
     */
    const title = body.title?.trim() || titleFrom(body.body ?? '');
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

    // Reading the local cookie needs no DB. Do not make filing depend on auth's lookup.
    const user = {
      handle: (await cookies()).get(USER_COOKIE)?.value || 'unknown reporter',
      resolveUser: async (q: Queryable) => (await auth()).currentUser(q),
    };
    const issue = await fileFeedback(user, {
      title,
      body: body.body ?? '',
      kind: body.kind ?? 'bug',
      priority: body.priority ?? 'P2',
      page: body.page ?? '/',
      context: body.context ?? {},
      attachments,
      imageOffset: body.imageOffset ?? 0,
      ...(clientId ? { clientId } : {}),
    });
    return NextResponse.json({
      id: issue.id, title: issue.title, location: issue.location, attachments: issue.attachments,
      ...(clientId ? { clientId, repeat: Boolean(issue.repeat) } : {}),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
