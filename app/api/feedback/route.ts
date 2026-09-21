import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { fileFeedback } from '@/modules/platform';
import type { IssueAttachment, IssueKind, IssuePriority } from '@/lib/issues';

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      title?: string; body?: string; kind?: IssueKind; priority?: IssuePriority;
      page?: string; context?: Record<string, unknown>; screenshots?: string[];
      images?: Array<{ name?: string; dataUrl?: string }>;
      imageOffset?: number;
    };
    if (!body.title?.trim()) {
      return NextResponse.json({ error: 'A title is required.' }, { status: 400 });
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
      title: body.title,
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
