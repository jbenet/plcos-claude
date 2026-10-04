'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { renderText, safeHref, textToDoc, type DocNode } from '@/lib/email/doc';
import { EMAIL_EXTENSIONS } from './extensions';
import { discardDraftAction, moveDraftAction, previewDraftAction, removeAttachmentAction, saveDraftAction } from '@/app/email/actions';
import { formatDate } from '@/lib/time';
import s from './email.module.css';

/**
 * One email draft, written here and moved into the person's own Gmail Drafts (docs/25).
 *
 * The editor is TipTap with only what an email needs: paragraphs, line breaks, bold, italic,
 * links, bullet and numbered lists, and pictures that are this draft's attachments. Pasted
 * colours, fonts, headings, tables and outside pictures have nowhere to go in that schema and are
 * dropped; the server normalises again whatever arrives (lib/email/doc.ts). Plain text is one
 * click away and sends a text/plain email with no HTML part at all.
 *
 * Saving waits for the server's receipt, and so does the move: nothing here is optimistic.
 */

export interface AttachmentView { attachmentId: string; filename: string; contentType: string; sizeBytes: number; inline: boolean }
export interface WarningView { level: 'stop' | 'check' | 'note'; rule: string; text: string }
export interface DraftView {
  draftId: string;
  purposeLabel: string;
  revision: number;
  to: string; cc: string; bcc: string;
  subject: string;
  mode: 'rich' | 'plain';
  doc: DocNode | null;
  text: string;
  attachments: AttachmentView[];
  status: 'editing' | 'in_gmail' | 'discarded';
  gmailAccount: string | null;
  movedAt: string | null;
  movedRevision: number | null;
  prefillNote: string | null;
  threaded: boolean;
  warnings: WarningView[];
  blocks: Array<{ field: string; text: string }>;
}
/** The person's mailguard connection, as the box needs it: the mailbox when the token passed its check; why not, otherwise. */
export interface GmailView { mode: 'mailguard' | 'fake' | 'off'; email: string | null; why: string | null }

const PICTURES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const LEVEL: Record<WarningView['level'], string> = { stop: 'Stop', check: 'Check', note: 'Note' };

type Saving = 'saved' | 'dirty' | 'saving' | 'conflict' | 'error';

export function EmailDraftBox({ draft, gmail, path }: { draft: DraftView; gmail: GmailView; path: string }) {
  const router = useRouter();
  const [to, setTo] = useState(draft.to);
  const [cc, setCc] = useState(draft.cc);
  const [bcc, setBcc] = useState(draft.bcc);
  const [showCc, setShowCc] = useState(Boolean(draft.cc || draft.bcc));
  const [subject, setSubject] = useState(draft.subject);
  const [mode, setMode] = useState(draft.mode);
  const [text, setText] = useState(draft.mode === 'plain' ? draft.text : '');
  const [attachments, setAttachments] = useState(draft.attachments);
  const [warnings, setWarnings] = useState(draft.warnings);
  const [blocks, setBlocks] = useState(draft.blocks);
  const [status, setStatus] = useState(draft.status);
  const [moved, setMoved] = useState<{ at: string | null; revision: number | null; account: string | null }>({ at: draft.movedAt, revision: draft.movedRevision, account: draft.gmailAccount });
  const [saving, setSaving] = useState<Saving>('saved');
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [preview, setPreview] = useState<{ outline: Array<{ depth: number; type: string; detail: string }>; raw: string; bytes: number } | null>(null);
  const [busy, setBusy] = useState<'move' | 'preview' | 'upload' | null>(null);
  const [stripped, setStripped] = useState<string[]>([]);
  const revision = useRef(draft.revision);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const fields = useRef({ to, cc, bcc, subject, mode, text });
  fields.current = { to, cc, bcc, subject, mode, text };

  /** One request at a time, in order: an upload and a save never race for the revision. */
  const enqueue = useCallback(<T,>(work: () => Promise<T>): Promise<T> => {
    const next = queue.current.catch(() => undefined).then(work);
    queue.current = next;
    return next;
  }, []);

  const save = useCallback(() => enqueue(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const f = fields.current;
    setSaving('saving');
    const r = await saveDraftAction({
      draftId: draft.draftId, revision: revision.current, to: f.to, cc: f.cc, bcc: f.bcc, subject: f.subject, mode: f.mode,
      doc: f.mode === 'rich' ? editorRef.current?.getJSON() : undefined, text: f.mode === 'plain' ? f.text : undefined,
    });
    if (!r.ok) {
      setSaving(/changed since you opened it/.test(r.error) ? 'conflict' : 'error');
      setMessage({ tone: 'bad', text: r.error });
      return false;
    }
    revision.current = r.value.revision;
    setWarnings(r.value.warnings);
    setBlocks(r.value.blocks);
    setStripped(r.value.stripped);
    setStatus(r.value.status);
    if (r.value.bad.length) setMessage({ tone: 'bad', text: `Not an address, so left out: ${r.value.bad.join(', ')}` });
    setSaving('saved');
    return true;
  }), [draft.draftId, enqueue]);

  const changed = useCallback(() => {
    setSaving('dirty');
    if (timer.current) clearTimeout(timer.current);
    // GUESS: a pause of two seconds is the end of a thought, not of a word.
    timer.current = setTimeout(() => { void save(); }, 2000);
  }, [save]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const upload = useCallback((files: File[], inline: boolean, at?: number) => enqueue(async () => {
    setBusy('upload');
    setMessage(null);
    try {
      for (const file of files) {
        const form = new FormData();
        form.set('draftId', draft.draftId);
        form.set('file', file);
        form.set('inline', inline && PICTURES.has(file.type) ? '1' : '0');
        const res = await fetch('/api/email/attachment', { method: 'POST', body: form });
        const j = (await res.json().catch(() => ({}))) as { attachment?: AttachmentView; revision?: number; warnings?: WarningView[]; blocks?: DraftView['blocks']; error?: string };
        if (!res.ok || !j.attachment) { setMessage({ tone: 'bad', text: j.error ?? `${file.name} could not be added (${res.status}).` }); continue; }
        setAttachments((a) => [...a, j.attachment!]);
        if (typeof j.revision === 'number') revision.current = j.revision;
        if (j.warnings) setWarnings(j.warnings);
        if (j.blocks) setBlocks(j.blocks);
        if (j.attachment.inline && editorRef.current && fields.current.mode === 'rich') {
          const node = { type: 'emailImage', attrs: { attachmentId: j.attachment.attachmentId, alt: file.name } };
          if (typeof at === 'number') editorRef.current.chain().insertContentAt(at, node).run();
          else editorRef.current.chain().focus().insertContent(node).run();
        }
      }
    } finally {
      setBusy(null);
    }
  }), [draft.draftId, enqueue]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: EMAIL_EXTENSIONS,
    content: draft.mode === 'rich' ? (draft.doc ?? textToDoc(draft.text)) : textToDoc(''),
    editorProps: {
      attributes: { class: `mdrich ${s.rich}`, 'aria-label': 'Email body', role: 'textbox', 'aria-multiline': 'true' },
      handleDrop: (view, event) => {
        const files = [...(event.dataTransfer?.files ?? [])];
        if (!files.length) return false;
        event.preventDefault();
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        void upload(files, true, pos);
        return true;
      },
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files ?? [])].filter((f) => PICTURES.has(f.type));
        if (!files.length) return false;
        event.preventDefault();
        void upload(files, true);
        return true;
      },
    },
    onUpdate: () => changed(),
  }, []);
  editorRef.current = editor;

  const switchMode = (next: 'rich' | 'plain') => {
    if (next === mode) return;
    if (next === 'plain') {
      const doc = editor?.getJSON() as DocNode | undefined;
      setText(doc ? renderText(doc, (id) => attachments.find((a) => a.attachmentId === id)?.filename ?? null) : '');
    } else {
      editor?.commands.setContent(textToDoc(text), { emitUpdate: false });
    }
    setMode(next);
    fields.current.mode = next;
    changed();
  };

  const link = () => {
    if (!editor) return;
    const current = editor.getAttributes('link').href as string | undefined;
    const href = window.prompt('Link to (https://… or mailto:…). Leave empty to remove the link.', current ?? 'https://');
    if (href === null) return;
    if (!href.trim() || href.trim() === 'https://') { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return; }
    const safe = safeHref(href.trim());
    if (!safe) { setMessage({ tone: 'bad', text: 'Only https, http and mailto links go in an email.' }); return; }
    editor.chain().focus().extendMarkRange('link').setLink({ href: safe }).run();
  };

  const remove = (a: AttachmentView) => enqueue(async () => {
    const r = await removeAttachmentAction({ draftId: draft.draftId, attachmentId: a.attachmentId });
    if (!r.ok) { setMessage({ tone: 'bad', text: r.error }); return; }
    revision.current = r.value.revision;
    setAttachments(r.value.attachments);
    setWarnings(r.value.warnings);
    setBlocks(r.value.blocks);
    // The picture leaves the text too; the next save records that.
    if (a.inline && editor) {
      const { state } = editor;
      const tr = state.tr;
      state.doc.descendants((node, pos) => { if (node.type.name === 'emailImage' && node.attrs.attachmentId === a.attachmentId) tr.delete(tr.mapping.map(pos), tr.mapping.map(pos + node.nodeSize)); });
      if (tr.docChanged) editor.view.dispatch(tr);
    }
  });

  const showPreview = async () => {
    if (preview) { setPreview(null); return; }
    setBusy('preview');
    try {
      if (saving !== 'saved' && !(await save())) return;
      const r = await enqueue(() => previewDraftAction({ draftId: draft.draftId }));
      if (!r.ok) { setMessage({ tone: 'bad', text: r.error }); return; }
      setPreview(r.value);
      setWarnings(r.value.warnings);
      setBlocks(r.value.blocks);
    } finally {
      setBusy(null);
    }
  };

  const move = async () => {
    setBusy('move');
    setMessage(null);
    try {
      if (saving !== 'saved' && !(await save())) return;
      const r = await enqueue(() => moveDraftAction({ draftId: draft.draftId }));
      if (!r.ok) {
        setMessage({ tone: 'bad', text: r.error });
        if (r.blocks) setBlocks(r.blocks);
        return;
      }
      setStatus('in_gmail');
      setMoved({ at: new Date().toISOString(), revision: revision.current, account: r.value.account });
      setMessage({
        tone: 'ok',
        text: `${r.value.replaced ? 'Replaced the draft' : 'Made a draft'} in ${gmail.mode === 'fake' ? 'the demo’s fake Gmail' : 'your Gmail'} (${r.value.account})`
          + `${r.value.newMessageId ? ', as a new email: the earlier copy was sent or deleted there' : ''}`
          + `${r.value.threadSource === 'thread' ? ', in its thread' : r.value.threadSource === 'unthreaded' ? ', as a new thread (the earlier email was not sent yet, or the token cannot read thread headers)' : ''}. Review it and send it from Gmail.`,
      });
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const discard = async () => {
    if (!window.confirm(status === 'in_gmail' ? 'Discard this draft here? The copy in your Gmail stays there.' : 'Discard this draft?')) return;
    const r = await enqueue(() => discardDraftAction({ draftId: draft.draftId, path }));
    if (r.ok) router.refresh();
    else setMessage({ tone: 'bad', text: r.error });
  };

  const editedSinceMove = status === 'in_gmail' && moved.revision !== null && revision.current > moved.revision;
  const stops = warnings.filter((w) => w.level === 'stop').length;
  const canMove = gmail.mode !== 'off' && !!gmail.email && busy === null && status !== 'discarded';

  return (
    <div className={s.box} data-draft={draft.draftId}>
      <div className={s.head}>
        <span className="lbl">{draft.purposeLabel}{draft.threaded ? ' · in a thread' : ''}</span>
        <span className={s.state} data-state={status === 'in_gmail' ? (editedSinceMove ? 'stale' : 'moved') : 'editing'}>
          {status === 'in_gmail'
            ? editedSinceMove ? 'Edited since it went to Gmail' : `In Gmail${moved.at ? ` · ${formatDate(moved.at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}`
            : 'Not in Gmail yet'}
        </span>
        <span className={s.saving} aria-live="polite">
          {saving === 'saving' ? 'Saving…' : saving === 'dirty' ? 'Unsaved' : saving === 'conflict' ? 'Changed elsewhere' : saving === 'error' ? 'Not saved' : 'Saved'}
        </span>
      </div>
      {draft.prefillNote && <p className={s.prefill}>{draft.prefillNote}</p>}

      <div className={s.fields}>
        <label><span>To</span><input value={to} onChange={(e) => { setTo(e.target.value); changed(); }} placeholder="name@example.org, …" aria-label="To" autoComplete="off" /></label>
        {showCc ? (
          <>
            <label><span>Cc</span><input value={cc} onChange={(e) => { setCc(e.target.value); changed(); }} aria-label="Cc" autoComplete="off" /></label>
            <label><span>Bcc</span><input value={bcc} onChange={(e) => { setBcc(e.target.value); changed(); }} aria-label="Bcc" autoComplete="off" /></label>
          </>
        ) : <button type="button" className={s.linkish} onClick={() => setShowCc(true)}>Cc / Bcc</button>}
        <label><span>Subject</span><input value={subject} onChange={(e) => { setSubject(e.target.value); changed(); }} aria-label="Subject" /></label>
      </div>

      <div className={`mdfield ${s.field}`}>
        <div className="mdbar">
          <div className="mdtabs" role="tablist" aria-label="Rich text or plain text">
            <button type="button" role="tab" aria-selected={mode === 'rich'} className={mode === 'rich' ? 'on' : ''} onClick={() => switchMode('rich')}>Rich</button>
            <button type="button" role="tab" aria-selected={mode === 'plain'} className={mode === 'plain' ? 'on' : ''} onClick={() => switchMode('plain')}>Plain text</button>
          </div>
          {mode === 'rich' && editor && (
            <div className="mdtools">
              <button type="button" title="Bold" aria-label="Bold" aria-pressed={editor.isActive('bold')} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></button>
              <button type="button" title="Italic" aria-label="Italic" aria-pressed={editor.isActive('italic')} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().toggleItalic().run()}><i>I</i></button>
              <button type="button" title="Link" aria-label="Link" aria-pressed={editor.isActive('link')} onMouseDown={(e) => e.preventDefault()} onClick={link}>↗</button>
              <button type="button" title="Bulleted list" aria-label="Bulleted list" aria-pressed={editor.isActive('bulletList')} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().toggleBulletList().run()}>•</button>
              <button type="button" title="Numbered list" aria-label="Numbered list" aria-pressed={editor.isActive('orderedList')} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1.</button>
            </div>
          )}
        </div>
        <div hidden={mode !== 'rich'}><EditorContent editor={editor} /></div>
        {mode === 'plain' && (
          <textarea value={text} rows={12} aria-label="Email body, plain text" className={s.plain}
            onChange={(e) => { setText(e.target.value); changed(); }} />
        )}
        <p className="mdhint">
          {mode === 'rich'
            ? 'Bold, italic, links and lists. Pasted colours, fonts and headings are dropped. Drop a picture in to show it in the text.'
            : 'Sent as plain text, with no HTML part. Pictures travel as attached files.'}
          {stripped.length > 0 && <> Removed on save: {stripped.join(', ')}.</>}
        </p>
      </div>

      <div className={s.files}>
        {attachments.map((a) => (
          <span key={a.attachmentId} className={s.file}>
            <a href={`/api/email/attachment?id=${a.attachmentId}`} target="_blank" rel="noreferrer">{a.filename}</a>
            <small>{kb(a.sizeBytes)}{a.inline ? ' · in the text' : ''}</small>
            <button type="button" aria-label={`Remove ${a.filename}`} onClick={() => void remove(a)}>×</button>
          </span>
        ))}
        <button type="button" className="btn" onClick={() => fileInput.current?.click()} disabled={busy !== null}>{busy === 'upload' ? 'Adding…' : 'Attach files'}</button>
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; if (f.length) void upload(f, false); }} />
      </div>

      {warnings.length > 0 && (
        <ul className={s.warnings} aria-label="Checks on this draft">
          {warnings.map((w, i) => <li key={i} data-level={w.level}><b>{LEVEL[w.level]}</b> {w.text}</li>)}
        </ul>
      )}

      {message && <p className={s.message} data-tone={message.tone} role="status">{message.text}</p>}

      <div className={s.actions}>
        <button type="button" className="btn p" onClick={() => void move()} disabled={!canMove}
          title={gmail.why ?? (!gmail.email ? 'Connect a drafts-only mailguard token in Preferences → Email first' : '')}>
          {busy === 'move' ? 'Moving…' : status === 'in_gmail' ? 'Update the Gmail draft' : 'Move to Gmail drafts'}
        </button>
        <button type="button" className="btn" onClick={() => void save()} disabled={saving === 'saved' || busy !== null}>Save</button>
        <button type="button" className="btn" onClick={() => void showPreview()} disabled={busy !== null && busy !== 'preview'} aria-expanded={!!preview}>
          {preview ? 'Hide the message' : busy === 'preview' ? 'Building…' : 'Preview the message'}
        </button>
        <button type="button" className={`btn ${s.discard}`} onClick={() => void discard()}>Discard</button>
        <span className={s.where}>
          {gmail.mode === 'off' ? <>Gmail is off here. {gmail.why}</>
            : gmail.email ? <>Goes to the Drafts of {gmail.email}{gmail.mode === 'fake' ? ' (the demo’s fake Gmail)' : ''}. Nothing is sent from here.</>
              : <>Connect your Gmail in <a href="/settings#email">Preferences</a> to move drafts there. Nothing is sent from here.</>}
          {stops > 0 && <> · {stops} {stops === 1 ? 'check says' : 'checks say'} stop: read {stops === 1 ? 'it' : 'them'} before sending.</>}
        </span>
      </div>
      {blocks.length > 0 && <p className={s.blocks}>Before it can go to Gmail: {blocks.map((b) => b.text).join(' ')}</p>}

      {preview && (
        <div className={s.preview}>
          <div className="lbl">The message as it goes to Gmail · {kb(preview.bytes)}</div>
          <ol className={s.outline}>
            {preview.outline.map((r, i) => <li key={i} style={{ paddingLeft: r.depth * 16 }}><code>{r.type}</code> <small>{r.detail}</small></li>)}
          </ol>
          <pre className={s.raw}>{preview.raw}</pre>
          <p className="muted" style={{ fontSize: 11 }}>Long file contents are cut short here. The Date and the part boundaries are made afresh at the move; a follow-up&rsquo;s thread headers are read from Gmail then.</p>
        </div>
      )}
    </div>
  );
}
