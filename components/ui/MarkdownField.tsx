'use client';

import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import { Markdown } from 'tiptap-markdown';

export interface DroppedImage {
  /** 1-based, and the same number the body's `attachment:N` refers to. */
  index: number;
  name: string;
  contentType: string;
  /** Data URL, for the preview here and for the POST. */
  dataUrl: string;
}

const ACCEPT = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_BYTES = 8 * 1024 * 1024;

type Mode = 'rich' | 'source';

/** `tiptap-markdown` adds this to the editor's storage; its types do not declare it. */
const serialise = (e: Editor): string =>
  (e.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown();

/**
 * A markdown field you write in rather than at.
 *
 * Rich is the default, because most feedback is prose and asking somebody to remember
 * asterisks in order to file a bug is a tax on the complaint. **Source is one click away
 * and it is the real thing** — the body of an issue is a markdown file in this repository
 * and somebody will read it in a diff, so the source view is the document rather than an
 * export of it.
 *
 * Images are held as `attachment:N` references and never as data URLs in the text: the
 * sink owns the filenames, so the body cannot point at a path a caller chose. The rich
 * view swaps those tokens for the picture while you are typing and swaps them back when it
 * serialises.
 */
export function MarkdownField({
  value, onChange, images, onImages, placeholder, rows = 7,
}: {
  value: string;
  onChange: (next: string) => void;
  images: DroppedImage[];
  onImages: (next: DroppedImage[]) => void;
  placeholder?: string;
  rows?: number;
}) {
  const [mode, setMode] = useState<Mode>('rich');
  const [over, setOver] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement | null>(null);
  /** Guards the loop: our own serialisation must not be fed back in as a new value. */
  const ours = useRef(false);
  const imagesRef = useRef(images);
  imagesRef.current = images;

  /** `attachment:2` → the data URL sitting in this browser, and back again. */
  const toDisplay = (md: string) =>
    md.replace(/\(attachment:(\d+)\)/g, (whole, n: string) => {
      const hit = imagesRef.current.find((x) => x.index === Number(n));
      return hit ? `(${hit.dataUrl})` : whole;
    });
  const toStored = (md: string) => {
    let out = md;
    for (const img of imagesRef.current) {
      out = out.split(`(${img.dataUrl})`).join(`(attachment:${img.index})`);
    }
    return out;
  };

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [3, 4] } }),
      Image.configure({ inline: false }),
      Link.configure({ openOnClick: false }),
      Markdown.configure({ html: false, transformPastedText: true, breaks: true }),
    ],
    content: toDisplay(value),
    editorProps: {
      attributes: {
        class: 'mdrich',
        'aria-label': placeholder ?? 'What happened',
        style: `min-height:${rows * 22}px`,
      },
    },
    onUpdate: ({ editor: e }) => {
      ours.current = true;
      onChange(toStored(serialise(e)));
    },
  }, []);

  // A change from outside (the Source tab, a reset after filing) goes back into the editor.
  useEffect(() => {
    if (!editor) return;
    if (ours.current) { ours.current = false; return; }
    const current = toStored(serialise(editor));
    if (current !== value) editor.commands.setContent(toDisplay(value));
  }, [value, editor]);

  const accept = async (files: File[]) => {
    setRefused(null);
    const usable = files.filter((f) => ACCEPT.has(f.type));
    const tooBig = usable.filter((f) => f.size > MAX_BYTES);
    const wrongKind = files.length - usable.length;
    if (wrongKind > 0 || tooBig.length > 0) {
      setRefused([
        wrongKind > 0 ? `${wrongKind} file${wrongKind === 1 ? '' : 's'} that ${wrongKind === 1 ? 'is' : 'are'} not a PNG, JPEG, GIF or WebP` : null,
        tooBig.length > 0 ? `${tooBig.length} over 8 MB` : null,
      ].filter(Boolean).join(' · '));
    }

    const keep = usable.filter((f) => f.size <= MAX_BYTES);
    if (keep.length === 0) return;

    const read = await Promise.all(keep.map((f) =>
      new Promise<DroppedImage | null>((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve({
          index: 0, name: f.name || 'image', contentType: f.type, dataUrl: String(r.result),
        });
        r.onerror = () => resolve(null);
        r.readAsDataURL(f);
      })));

    const added = read.filter((x): x is DroppedImage => x !== null);
    if (added.length === 0) return;
    const base = imagesRef.current.length;
    const numbered = added.map((x, i) => ({ ...x, index: base + i + 1 }));
    imagesRef.current = [...imagesRef.current, ...numbered];
    onImages(imagesRef.current);

    if (mode === 'rich' && editor) {
      for (const img of numbered) {
        editor.chain().focus().setImage({ src: img.dataUrl, alt: img.name }).run();
      }
    } else {
      const el = area.current;
      const snippet = numbered.map((x) => `\n![${x.name}](attachment:${x.index})\n`).join('');
      if (!el) { onChange(value + snippet); return; }
      const at = el.selectionStart;
      onChange(value.slice(0, at) + snippet + value.slice(el.selectionEnd));
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    void accept([...e.dataTransfer.files]);
  };

  const onPaste = (e: ClipboardEvent<HTMLElement>) => {
    const files = [...e.clipboardData.files];
    if (files.length === 0) return;
    e.preventDefault();
    void accept(files);
  };

  return (
    <div className={`mdfield${over ? ' over' : ''}`}>
      <div className="mdbar">
        <div className="mdtabs" role="group" aria-label="Rich text or markdown source">
          <button className={mode === 'rich' ? 'on' : ''} onClick={() => setMode('rich')} aria-pressed={mode === 'rich'}>
            Rich
          </button>
          <button className={mode === 'source' ? 'on' : ''} onClick={() => setMode('source')} aria-pressed={mode === 'source'}>
            Markdown
          </button>
        </div>
        {mode === 'rich' && editor && <RichTools editor={editor} />}
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        onPaste={onPaste}
      >
        {mode === 'rich' ? (
          <EditorContent editor={editor} />
        ) : (
          <textarea
            ref={area}
            rows={rows}
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
      </div>

      <p className="mdhint">
        {mode === 'rich'
          ? <>Rich text, stored as markdown. <b>Markdown</b> shows the file it becomes.</>
          : <>The markdown that gets written to <code>issues/</code>. <b>Rich</b> renders it.</>}
        {' '}<b>Drop or paste images</b> anywhere in this box.
        {images.length > 0 && ` ${images.length} attached.`}
      </p>
      {refused && <p className="mdhint refused">Not attached: {refused}. Everything else went in.</p>}
    </div>
  );
}

const MARKS: Array<{ label: string; title: string; run: (e: Editor) => void; on: (e: Editor) => boolean }> = [
  { label: 'B', title: 'Bold', run: (e) => e.chain().focus().toggleBold().run(), on: (e) => e.isActive('bold') },
  { label: 'i', title: 'Italic', run: (e) => e.chain().focus().toggleItalic().run(), on: (e) => e.isActive('italic') },
  { label: '‹›', title: 'Code', run: (e) => e.chain().focus().toggleCode().run(), on: (e) => e.isActive('code') },
  { label: '#', title: 'Heading', run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(), on: (e) => e.isActive('heading', { level: 3 }) },
  { label: '•', title: 'Bullet list', run: (e) => e.chain().focus().toggleBulletList().run(), on: (e) => e.isActive('bulletList') },
  { label: '1.', title: 'Numbered list', run: (e) => e.chain().focus().toggleOrderedList().run(), on: (e) => e.isActive('orderedList') },
  { label: '“', title: 'Quote', run: (e) => e.chain().focus().toggleBlockquote().run(), on: (e) => e.isActive('blockquote') },
];

function RichTools({ editor }: { editor: Editor }) {
  const [, bump] = useState(0);
  useEffect(() => {
    const on = () => bump((n) => n + 1);
    editor.on('selectionUpdate', on);
    editor.on('transaction', on);
    return () => { editor.off('selectionUpdate', on); editor.off('transaction', on); };
  }, [editor]);

  return (
    <div className="mdtools">
      {MARKS.map((m) => (
        <button
          key={m.title}
          title={m.title}
          aria-label={m.title}
          aria-pressed={m.on(editor)}
          className={m.on(editor) ? 'on' : ''}
          onClick={() => m.run(editor)}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
