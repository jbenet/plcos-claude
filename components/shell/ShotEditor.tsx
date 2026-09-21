'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Tool = 'pen' | 'arrow' | 'box' | 'text';

interface Stroke { tool: 'pen'; colour: string; width: number; points: Array<[number, number]> }
interface Arrow { tool: 'arrow'; colour: string; width: number; from: [number, number]; to: [number, number] }
interface Box { tool: 'box'; colour: string; width: number; from: [number, number]; to: [number, number] }
interface Label {
  tool: 'text';
  /** Labels are editable after they are placed, so they need identity (issue 0014). */
  id: string;
  colour: string;
  size: number;
  at: [number, number];
  /** Wrap width in image pixels. Dragging the corner changes this, not the font. */
  width: number;
  /** Newlines are kept. A one-line-only annotation tool makes people write captions. */
  text: string;
  bold: boolean;
}
type Mark = Stroke | Arrow | Box | Label;

const COLOURS = [
  { id: '#BF4A16', name: 'Clay' },
  { id: '#0E7F55', name: 'Green' },
  { id: '#5F4B9E', name: 'Purple' },
  { id: '#1A1917', name: 'Ink' },
  { id: '#FFFFFF', name: 'White' },
];

const TOOLS: Array<{ id: Tool; glyph: string; name: string }> = [
  { id: 'pen', glyph: '✎', name: 'Draw freehand' },
  { id: 'arrow', glyph: '↗', name: 'Point at something' },
  { id: 'box', glyph: '▢', name: 'Box it' },
  { id: 'text', glyph: 'T', name: 'Add a label' },
];

const SIZES: Array<{ label: string; title: string; scale: number }> = [
  { label: 'S', title: 'Small', scale: 0.7 },
  { label: 'M', title: 'Medium', scale: 1 },
  { label: 'L', title: 'Large', scale: 1.5 },
  { label: 'XL', title: 'Extra large', scale: 2.2 },
];

const isUndo = (e: KeyboardEvent) =>
  (e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z';
const isRedo = (e: KeyboardEvent) =>
  (e.metaKey || e.ctrlKey) && (
    (e.shiftKey && e.key.toLowerCase() === 'z') || (!e.shiftKey && e.key.toLowerCase() === 'y')
  );

/**
 * Annotating a screenshot.
 *
 * Everything is kept as a list of marks rather than painted straight onto the canvas, so
 * undo is a pop rather than a history of bitmaps — and so the base image is never
 * destroyed. The export composites once, at the end.
 */
export function ShotEditor({
  src, onCancel, onSave,
}: {
  src: string;
  onCancel: () => void;
  onSave: (dataUrl: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  /**
   * Marks live in a ref as well as in state.
   *
   * Clicking Done blurs the text input, which commits the label — and a click handler in
   * the same tick still sees the pre-blur state. The first label anybody typed went
   * missing from the saved image for exactly that reason.
   */
  const marksRef = useRef<Mark[]>([]);
  const [marks, setMarksState] = useState<Mark[]>([]);
  const setMarks = (next: Mark[] | ((prev: Mark[]) => Mark[])) => {
    marksRef.current = typeof next === 'function' ? next(marksRef.current) : next;
    setMarksState(marksRef.current);
  };

  /** A new mark ends the redo branch, the way every editor behaves. */
  const addMark = (m: Mark) => {
    redoRef.current = [];
    setRedoDepth(0);
    setMarks((prev) => [...prev, m]);
  };

  const undo = useCallback(() => {
    const last = marksRef.current.at(-1);
    if (!last) return;
    redoRef.current = [...redoRef.current, last];
    setRedoDepth(redoRef.current.length);
    setMarks((prev) => prev.slice(0, -1));
  }, []);

  const redo = useCallback(() => {
    const next = redoRef.current.at(-1);
    if (!next) return;
    redoRef.current = redoRef.current.slice(0, -1);
    setRedoDepth(redoRef.current.length);
    setMarks((prev) => [...prev, next]);
  }, []);

  const clearAll = () => {
    redoRef.current = [...redoRef.current, ...marksRef.current];
    setRedoDepth(redoRef.current.length);
    setMarks([]);
  };
  // Freehand first: it is what people reach for, and every other tool is a refinement of
  // "point at the thing".
  const [tool, setTool] = useState<Tool>('pen');
  const redoRef = useRef<Mark[]>([]);
  const [redoDepth, setRedoDepth] = useState(0);
  const [colour, setColour] = useState(COLOURS[0]!.id);
  const [drawing, setDrawing] = useState<Mark | null>(null);
  /** The label currently being typed or selected, by id (issue 0014). */
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const dragRef = useRef<{ id: string; mode: 'move' | 'size'; ox: number; oy: number } | null>(null);
  /** Read inside the key handler, which must not be rebuilt on every selection change. */
  const activeIdRef = useRef<string | null>(null);
  /**
   * Focus is put on the field explicitly rather than with `autoFocus`: the label list
   * re-renders on every keystroke, and a field that loses focus mid-sentence is worse than
   * no text tool at all.
   */
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  /** Text settings live outside the draft so they survive between labels. */
  const [textScale, setTextScale] = useState(1);
  const [bold, setBold] = useState(true);
  const [ready, setReady] = useState(false);

  // Load the base image once; every redraw paints it first.
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      const c = canvasRef.current;
      if (c) {
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
      }
      setReady(true);
    };
    img.src = src;
  }, [src]);

  /**
   * Wrap a label the way the export will draw it: explicit newlines first, then greedy
   * wrapping inside each paragraph at the label's own width.
   */
  const wrapLines = (ctx: CanvasRenderingContext2D, text: string, width: number): string[] => {
    const out: string[] = [];
    for (const para of text.split('\n')) {
      if (para === '') { out.push(''); continue; }
      let line = '';
      for (const word of para.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (ctx.measureText(next).width > width && line) {
          out.push(line);
          line = word;
        } else {
          line = next;
        }
      }
      out.push(line);
    }
    return out;
  };

  /**
   * `withText` is false while editing: placed labels are real DOM elements in the editor so
   * they can be moved, resized and retyped, and they are composited onto the canvas once, at
   * export. Painting them in both places would double them.
   */
  const paint = (target: HTMLCanvasElement, all: Mark[], withText = false) => {
    const img = imgRef.current;
    const ctx = target.getContext('2d');
    if (!ctx || !img) return;
    ctx.clearRect(0, 0, target.width, target.height);
    ctx.drawImage(img, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const m of all) {
      ctx.strokeStyle = m.colour;
      ctx.fillStyle = m.colour;
      if (m.tool === 'pen') {
        ctx.lineWidth = m.width;
        ctx.beginPath();
        m.points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
        ctx.stroke();
      } else if (m.tool === 'box') {
        ctx.lineWidth = m.width;
        ctx.strokeRect(m.from[0], m.from[1], m.to[0] - m.from[0], m.to[1] - m.from[1]);
      } else if (m.tool === 'arrow') {
        ctx.lineWidth = m.width;
        const [x1, y1] = m.from;
        const [x2, y2] = m.to;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        const a = Math.atan2(y2 - y1, x2 - x1);
        const head = Math.max(12, m.width * 4);
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - head * Math.cos(a - Math.PI / 7), y2 - head * Math.sin(a - Math.PI / 7));
        ctx.lineTo(x2 - head * Math.cos(a + Math.PI / 7), y2 - head * Math.sin(a + Math.PI / 7));
        ctx.closePath();
        ctx.fill();
      } else if (withText) {
        ctx.font = `${m.bold ? 600 : 400} ${m.size}px "IBM Plex Sans", system-ui, sans-serif`;
        ctx.textBaseline = 'top';
        const lines = wrapLines(ctx, m.text, m.width);
        const lh = Math.round(m.size * 1.3);
        ctx.fillStyle = m.colour;
        lines.forEach((line, i) => ctx.fillText(line, m.at[0], m.at[1] + i * lh));
      }
    }
  };

  useEffect(() => {
    const c = canvasRef.current;
    if (c && ready) paint(c, drawing ? [...marks, drawing] : marks, false);
  }, [marks, drawing, ready]);

  /** Pointer position in image pixels, whatever size the canvas is displayed at. */
  const at = (e: React.PointerEvent | React.MouseEvent): [number, number] => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return [
      ((e.clientX - r.left) / r.width) * c.width,
      ((e.clientY - r.top) / r.height) * c.height,
    ];
  };

  const width = () => Math.max(3, Math.round((canvasRef.current?.width ?? 1400) / 420));
  /** Base size scales with the image so a label reads the same on any capture. */
  const baseSize = () => Math.max(14, Math.round((canvasRef.current?.width ?? 1400) / 58));
  const fontSize = () => Math.round(baseSize() * textScale);
  /** The same size in screen pixels, so the floating field matches what will be drawn. */
  const screenFontSize = () => {
    const c = canvasRef.current;
    if (!c) return 15;
    const shown = c.getBoundingClientRect().width || c.width;
    return Math.max(11, Math.round(fontSize() * (shown / c.width)));
  };

  const down = (e: React.PointerEvent) => {
    if (!ready) return;
    if (editingId) stopEditing();
    setActiveId(null);
    const p = at(e);
    if (tool === 'text') {
      // Stops the browser moving focus out of the field we are about to create.
      e.preventDefault();
      const id = `l${Date.now()}`;
      addMark({
        tool: 'text', id, colour, size: fontSize(), at: p,
        width: Math.round((canvasRef.current?.width ?? 1400) * 0.34),
        text: '', bold,
      });
      setActiveId(id);
      setEditingId(id);
      return;
    }
    (e.target as Element).setPointerCapture(e.pointerId);
    if (tool === 'pen') setDrawing({ tool: 'pen', colour, width: width(), points: [p] });
    else setDrawing({ tool, colour, width: width(), from: p, to: p });
  };

  const move = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (d) {
      const p = at(e);
      if (d.mode === 'move') patch(d.id, { at: [p[0] - d.ox, p[1] - d.oy] });
      else patch(d.id, { width: Math.max(40, p[0] - d.ox) });
      return;
    }
    if (!drawing) return;
    const p = at(e);
    if (drawing.tool === 'pen') setDrawing({ ...drawing, points: [...drawing.points, p] });
    else if (drawing.tool === 'arrow' || drawing.tool === 'box') setDrawing({ ...drawing, to: p });
  };

  const up = () => {
    if (dragRef.current) { dragRef.current = null; return; }
    if (!drawing) return;
    addMark(drawing);
    setDrawing(null);
  };

  activeIdRef.current = activeId;

  /**
   * Focus the field the moment it attaches, not in an effect — the label list re-renders on
   * every keystroke and an effect keyed on the id fires before anything useful exists.
   */
  const focusedField = useRef<HTMLTextAreaElement | null>(null);
  const attachField = (el: HTMLTextAreaElement | null) => {
    fieldRef.current = el;
    if (el && focusedField.current !== el) {
      focusedField.current = el;
      /**
       * Deferred by a frame. Focusing inside the click that created the field loses the
       * focus again when the browser finishes handling that same click on the canvas
       * underneath — which is why the text tool looked like it did nothing at all.
       */
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      });
    }
    if (!el) focusedField.current = null;
  };

  const labels = () => marksRef.current.filter((m): m is Label => m.tool === 'text');
  const labelOf = (id: string | null) => (id ? labels().find((l) => l.id === id) ?? null : null);

  const patch = (id: string, next: Partial<Label>) => {
    setMarks((prev) => prev.map((m) => (m.tool === 'text' && m.id === id ? { ...m, ...next } : m)));
  };

  const dropLabel = (id: string) => {
    setMarks((prev) => prev.filter((m) => !(m.tool === 'text' && m.id === id)));
    if (activeId === id) setActiveId(null);
    if (editingId === id) setEditingId(null);
  };

  /**
   * Leaving the text field keeps what was typed (issue 0014).
   *
   * Escape used to throw the label away, and because Escape is also how people leave a text
   * field by reflex, it threw away work they thought they were saving. An empty label is the
   * only one that disappears, and it disappears because it is empty.
   */
  const stopEditing = () => {
    const l = labelOf(editingId);
    if (l && !l.text.trim()) dropLabel(l.id);
    setEditingId(null);
  };

  /**
   * The shortcuts people already have in their fingers. Suppressed while a label is being
   * typed, where the browser's own undo belongs to the input.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inText = e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement;
      if (e.key === 'Escape') {
        /**
         * One level at a time (issue 0014). In a label: keep the text and leave the field.
         * With a label selected: deselect. Otherwise: close the editor. Escape used to jump
         * straight out and take the label with it.
         */
        if (inText || editingId) { stopEditing(); return; }
        if (activeIdRef.current) { setActiveId(null); return; }
        onCancel();
        return;
      }
      if (inText) return;
      if (isUndo(e)) { e.preventDefault(); undo(); }
      else if (isRedo(e)) { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, onCancel, editingId]);

  const save = () => {
    const out = document.createElement('canvas');
    const c = canvasRef.current!;
    out.width = c.width;
    out.height = c.height;
    paint(out, marksRef.current, true);
    onSave(out.toDataURL('image/png'));
  };

  return (
    <div className="shotedit" role="dialog" aria-label="Annotate the screenshot">
      <div className="setstage">
        <div className="setwrap">
          {/* Directly above the image: a toolbar at the top of a dark overlay, with the
              picture centred below it, is a toolbar nobody finds. */}
          <div className="setop">
            <div className="settools" role="group" aria-label="Tool">
              {TOOLS.map((t) => (
                <button
                  key={t.id}
                  className={t.id === tool ? 'on' : ''}
                  onClick={() => { stopEditing(); setTool(t.id); }}
                  aria-pressed={t.id === tool}
                  title={t.name}
                  aria-label={t.name}
                >
                  <span aria-hidden>{t.glyph}</span>
                </button>
              ))}
            </div>
            <div className="setcols" role="group" aria-label="Colour">
              {COLOURS.map((c) => (
                <button
                  key={c.id}
                  className={`swatch${c.id === colour ? ' on' : ''}`}
                  style={{ background: c.id }}
                  onClick={() => setColour(c.id)}
                  aria-pressed={c.id === colour}
                  title={c.name}
                  aria-label={c.name}
                />
              ))}
            </div>
            <div className="setacts">
              <button className="btn" onClick={undo} disabled={marks.length === 0} title="⌘Z">
                Undo
              </button>
              <button className="btn" onClick={redo} disabled={redoDepth === 0} title="⌘⇧Z">
                Redo
              </button>
              <button className="btn" onClick={clearAll} disabled={marks.length === 0}>
                Clear
              </button>
              <button className="btn" onClick={onCancel} title="Esc">Cancel</button>
              <button className="btn p" onClick={save}>Done</button>
            </div>
          </div>

          <canvas
            ref={canvasRef}
            className={`setcanvas t-${tool}`}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
          />
          {/* Placed labels are DOM objects: move them, resize them, type in them again.
              They are composited onto the image at export. */}
          {marks.filter((m): m is Label => m.tool === 'text').map((l) => {
            const c = canvasRef.current;
            const shown = c ? (c.getBoundingClientRect().width || c.width) : 1;
            const scale = c ? shown / c.width : 1;
            const editing = editingId === l.id;
            return (
              <div
                key={l.id}
                className={`setlabel${activeId === l.id ? ' on' : ''}${editing ? ' editing' : ''}`}
                style={{
                  left: `${(l.at[0] / (c?.width ?? 1)) * 100}%`,
                  top: `${(l.at[1] / (c?.height ?? 1)) * 100}%`,
                  width: `${(l.width / (c?.width ?? 1)) * 100}%`,
                  color: l.colour,
                  fontWeight: l.bold ? 600 : 400,
                  fontSize: Math.max(9, Math.round(l.size * scale)),
                  lineHeight: 1.3,
                }}
                onPointerDown={(e) => {
                  if (editing) return;
                  e.stopPropagation();
                  setActiveId(l.id);
                  const p = at(e);
                  dragRef.current = { id: l.id, mode: 'move', ox: p[0] - l.at[0], oy: p[1] - l.at[1] };
                  (e.target as Element).setPointerCapture(e.pointerId);
                }}
                /* The label captures the pointer when a drag starts, so the moves arrive
                   here rather than on the canvas underneath. */
                onPointerMove={move}
                onPointerUp={up}
                onDoubleClick={(e) => { e.stopPropagation(); setActiveId(l.id); setEditingId(l.id); }}
              >
                {editing ? (
                  <textarea
                    ref={attachField}
                    className="settext"
                    value={l.text}
                    placeholder="Type. Return makes a new line."
                    style={{ color: l.colour, fontWeight: l.bold ? 600 : 400, fontSize: 'inherit' }}
                    onChange={(e) => patch(l.id, { text: e.target.value })}
                    onKeyDown={(e) => {
                      // Return is a line break. Escape leaves the field and keeps the text.
                      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); stopEditing(); }
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); stopEditing(); }
                    }}
                  />
                ) : (
                  <div className="settextview">{l.text || 'Empty label'}</div>
                )}
                {activeId === l.id && (
                  <span
                    className="setgrip"
                    title="Drag to set the wrapping width"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      const p = at(e);
                      dragRef.current = { id: l.id, mode: 'size', ox: p[0] - l.width, oy: 0 };
                      (e.target as Element).setPointerCapture(e.pointerId);
                    }}
                  />
                )}
              </div>
            );
          })}

          {labelOf(activeId) && (
            <div
              className="settextbar floating"
              style={{
                left: `${((labelOf(activeId)!.at[0]) / (canvasRef.current?.width ?? 1)) * 100}%`,
                top: `${((labelOf(activeId)!.at[1]) / (canvasRef.current?.height ?? 1)) * 100}%`,
              }}
              onMouseDown={(e) => e.preventDefault()}
            >
              {SIZES.map((sz) => (
                <button
                  key={sz.label}
                  className={Math.abs(labelOf(activeId)!.size - Math.round(baseSize() * sz.scale)) < 2 ? 'on' : ''}
                  onClick={() => { setTextScale(sz.scale); patch(activeId!, { size: Math.round(baseSize() * sz.scale) }); }}
                  title={`${sz.title} text`}
                >
                  {sz.label}
                </button>
              ))}
              <button
                className={labelOf(activeId)!.bold ? 'on' : ''}
                onClick={() => { const b = !labelOf(activeId)!.bold; setBold(b); patch(activeId!, { bold: b }); }}
                title="Bold"
                style={{ fontWeight: 700 }}
              >
                B
              </button>
              <span className="sep" />
              {COLOURS.map((c) => (
                <button
                  key={c.id}
                  className={`swatch${c.id === labelOf(activeId)!.colour ? ' on' : ''}`}
                  style={{ background: c.id }}
                  onClick={() => { setColour(c.id); patch(activeId!, { colour: c.id }); }}
                  title={c.name}
                  aria-label={c.name}
                />
              ))}
              <span className="sep" />
              {editingId === activeId ? (
                <button onClick={stopEditing} title="Keep it and stop typing">Done</button>
              ) : (
                <button onClick={() => setEditingId(activeId)} title="Type in it again">Edit</button>
              )}
              <button onClick={() => dropLabel(activeId!)} title="Delete this label">×</button>
            </div>
          )}
        </div>
      </div>

      <p className="setnote">
        {marks.length} mark{marks.length === 1 ? '' : 's'} · <b>⌘Z</b> undo · <b>⌘⇧Z</b> redo ·{' '}
        <b>Esc</b> leaves the text field, then the selection, then the editor. A label can be
        dragged, retyped and resized by its corner after it is placed; <b>Return</b> inside one
        is a line break. The annotated image is what gets filed — the original is not kept
        separately, so circle the thing rather than describing where it was.
      </p>
    </div>
  );
}
