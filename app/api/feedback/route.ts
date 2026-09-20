import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { fileFeedback } from '@/modules/platform';
import type { IssueKind, IssuePriority } from '@/lib/issues';

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      title?: string; body?: string; kind?: IssueKind; priority?: IssuePriority;
      page?: string; context?: Record<string, unknown>;
    };
    if (!body.title?.trim()) {
      return NextResponse.json({ error: 'A title is required.' }, { status: 400 });
    }
    const user = await (await auth()).currentUser();
    const issue = await fileFeedback(user, {
      title: body.title,
      body: body.body ?? '',
      kind: body.kind ?? 'bug',
      priority: body.priority ?? 'P2',
      page: body.page ?? '/',
      context: body.context ?? {},
    });
    return NextResponse.json({ id: issue.id, location: issue.location });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
