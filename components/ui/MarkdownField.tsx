'use client';

import { useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { Markdown } from './Markdown';

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

type Mode = 'write' | 'preview';

const WRAPS: Array<{ label: string; title: string; before: string; after: string }> = [
  { label: 'B', title: 'Bold', before: '**', after: '**' },
  { label: 'i', title: 'Italic', before: '*', after: '*' },
  { label: '‹›', title: 'Code', before: '`', after: '`' },
  { label: '“', title: 'Quote', before: '\n> ', after: '' },
  { label: '•', title: 'List item', before: '\n- ', after: '' },
  { label: '#', title: 'Heading', before: '\n### ', after: '' },
  { label: '🔗', title: 'Link', before: '[', after: '](https://)' },
];

/**
 * A markdown field you can read as well as write.
 *
 * Deliberately not a WYSIWYG surface that hides the source. The body of an issue is a
 * markdown file in the repository, and somebody will open it in an editor — so the thing
 * you type is the thing that is stored, and **Preview** renders it with the same component
 * the issue page uses. A preview that can disagree with the page is a preview nobody
 * checks twice.
 *
 * Images dropped or pasted here are held as `attachment:N` references rather than data
 * URLs: the sink names the files, so the body cannot point at a path a caller chose.
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
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [mode, setMode] = useState<Mode>('write');
  const [over, setOver] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  const insert = (text: string) => {
    const el = ref.current;
    if (!el) { onChange(value + text); return; }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = value.slice(0, start) + text + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + text.length;
    });
  };

  const wrap = (before: string, after: string) => {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const chosen = value.slice(start, end);
    const next = value.slice(0, start) + before + chosen + after + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = start + before.length;
      el.selectionEnd = start + before.length + chosen.length;
    });
  };

  const accept = async (files: File[]) => {
    setRefused(null);
    const usable = files.filter((f) => ACCEPT.has(f.type));
    const tooBig = usable.filter((f) => f.size > MAX_BYTES);
    const wrongKind = files.length - usable.length;
    if (wrongKind > 0 || tooBig.length > 0) {
      setRefused(
        [
          wrongKind > 0 ? `${wrongKind} file${wrongKind === 1 ? '' : 's'} that ${wrongKind === 1 ? 'is' : 'are'} not a PNG, JPEG, GIF or WebP` : null,
          tooBig.length > 0 ? `${tooBig.length} over 8 MB` : null,
        ].filter(Boolean).join(' · '),
      );
    }

    const keep = usable.filter((f) => f.size <= MAX_BYTES);
    if (keep.length === 0) return;

    const read = await Promise.all(
      keep.map(
        (f) =>
          new Promise<DroppedImage | null>((resolve) => {
            const r = new FileReader();
            r.onload = () =>
              resolve({
                index: 0,
                name: f.name || 'image',
                contentType: f.type,
                dataUrl: String(r.result),
              });
            r.onerror = () => resolve(null);
            r.readAsDataURL(f);
          }),
      ),
    );

    const added = read.filter((x): x is DroppedImage => x !== null);
    if (added.length === 0) return;
    const base = images.length;
    const numbered = added.map((x, i) => ({ ...x, index: base + i + 1 }));
    onImages([...images, ...numbered]);
    insert(numbered.map((x) => `\n![${x.name}](attachment:${x.index})\n`).join(''));
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    void accept([...e.dataTransfer.files]);
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...e.clipboardData.files];
    if (files.length === 0) return;
    e.preventDefault();
    void accept(files);
  };

  /** In the preview, `attachment:N` resolves to the image still sitting in this browser. */
  const resolveImage = (href: string): string | null => {
    const m = /^attachment:(\d+)$/.exec(href);
    if (!m) return href;
    return images.find((x) => x.index === Number(m[1]))?.dataUrl ?? null;
  };

  return (
    <div className={`mdfield${over ? ' over' : ''}`}>
      <div className="mdbar">
        <div className="mdtabs" role="group" aria-label="Write or preview">
          <button className={mode === 'write' ? 'on' : ''} onClick={() => setMode('write')} aria-pressed={mode === 'write'}>
            Write
          </button>
          <button className={mode === 'preview' ? 'on' : ''} onClick={() => setMode('preview')} aria-pressed={mode === 'preview'}>
            Preview
          </button>
        </div>
        {mode === 'write' && (
          <div className="mdtools">
            {WRAPS.map((w) => (
              <button key={w.title} title={w.title} aria-label={w.title} onClick={() => wrap(w.before, w.after)}>
                {w.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        {mode === 'write' ? (
          <textarea
            ref={ref}
            rows={rows}
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            onPaste={onPaste}
          />
        ) : (
          <div className="mdpreview">
            {value.trim()
              ? <Markdown source={value} resolveImage={resolveImage} />
              : <p className="muted">Nothing written yet.</p>}
          </div>
        )}
      </div>

      <p className="mdhint">
        Markdown. <b>Drop or paste images</b> anywhere in this box — they are filed beside
        the issue and referenced from the text.
        {images.length > 0 && ` ${images.length} attached.`}
      </p>
      {refused && (
        <p className="mdhint refused">
          Not attached: {refused}. Everything else went in.
        </p>
      )}
    </div>
  );
}
