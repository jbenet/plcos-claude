import { withRoute } from '@/lib/authz/route';

/**
 * A draft's files (docs/25 §Attachment storage). POST adds one — a form with draftId, file and
 * inline — and GET returns one's bytes, to its owner only: the editor's picture, or a download.
 */
export const POST = withRoute('app/api/email/attachment/route.ts#POST', async (request, _context, user) => {
  if (user.access === 'viewer') return Response.json({ error: 'Viewers do not write drafts.' }, { status: 403 });
  const { addAttachment, draftWithChecks, DraftRefused } = await import('@/modules/email');
  const { config } = await import('@/config/deployment');
  // GUESS: a little over the file limit covers the form's own fields.
  if (Number(request.headers.get('content-length') ?? 0) > config.email.maxAttachmentBytes + 64 * 1024) {
    return Response.json({ error: `One file may be at most ${(config.email.maxAttachmentBytes / 1024 / 1024).toFixed(0)} MB.` }, { status: 413 });
  }
  let form: FormData;
  try { form = await request.formData(); } catch { return Response.json({ error: 'Send the file as a form.' }, { status: 400 }); }
  const file = form.get('file');
  const draftId = String(form.get('draftId') ?? '');
  if (!(file instanceof File) || !/^[0-9a-f-]{36}$/i.test(draftId)) return Response.json({ error: 'A draft and a file are needed.' }, { status: 400 });
  try {
    const a = await addAttachment(user, draftId, {
      filename: file.name, contentType: file.type || 'application/octet-stream', bytes: new Uint8Array(await file.arrayBuffer()), inline: form.get('inline') === '1',
    });
    // Adding a file changes the email, so the draft's revision moved: the editor saves on top of it.
    const { draft, warnings, blocks } = await draftWithChecks(user, draftId);
    return Response.json({ attachment: a, revision: draft.revision, warnings, blocks });
  } catch (e) {
    if (e instanceof DraftRefused) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
});

export const GET = withRoute('app/api/email/attachment/route.ts#GET', async (request, _context, user) => {
  const { readAttachment, DraftRefused } = await import('@/modules/email');
  const id = new URL(request.url).searchParams.get('id') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response('Not found', { status: 404 });
  try {
    const { attachment, bytes } = await readAttachment(user, id);
    // Pictures show in the editor; anything else downloads, so a file is never run as a page.
    const picture = /^image\/(png|jpeg|gif|webp)$/.test(attachment.contentType);
    return new Response(new Uint8Array(bytes), {
      headers: {
        'content-type': picture ? attachment.contentType : 'application/octet-stream',
        'content-disposition': `${picture ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
        'x-content-type-options': 'nosniff',
        'cache-control': 'private, no-store',
      },
    });
  } catch (e) {
    if (e instanceof DraftRefused) return new Response('Not found', { status: 404 });
    throw e;
  }
});
