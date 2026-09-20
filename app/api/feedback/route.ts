import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { fileFeedback } from '@/modules/platform';
import type { IssueKind, IssuePriority } from '@/lib/issues';

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      title?: string; body?: string; kind?: IssueKind; priority?: IssuePriority;
      page?: string; context?: Record<string, unknown>; screenshot?: string;
    };
    if (!body.title?.trim()) {
      return NextResponse.json({ error: 'A title is required.' }, { status: 400 });
    }
    /**
     * The screenshot arrives as a data URL from the reporter's own browser. Only a PNG
     * payload is accepted and only the base64 body is kept — the sink names the file, so
     * nothing here can choose a path, and nothing here is executed.
     */
    let attachment = null;
    if (body.screenshot) {
      const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(body.screenshot);
      if (!m) {
        return NextResponse.json({ error: 'The screenshot was not a PNG.' }, { status: 400 });
      }
      if (m[1]!.length > 12_000_000) {
        return NextResponse.json({ error: 'The screenshot is too large.' }, { status: 413 });
      }
      attachment = { kind: 'screenshot' as const, contentType: 'image/png' as const, base64: m[1]! };
    }

    const user = await (await auth()).currentUser();
    const issue = await fileFeedback(user, {
      title: body.title,
      body: body.body ?? '',
      kind: body.kind ?? 'bug',
      priority: body.priority ?? 'P2',
      page: body.page ?? '/',
      context: body.context ?? {},
      attachment,
    });
    return NextResponse.json({
      id: issue.id, location: issue.location, attachment: issue.attachment,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
