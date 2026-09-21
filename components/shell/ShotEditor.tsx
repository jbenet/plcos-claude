'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Tool = 'pen' | 'arrow' | 'box' | 'text';

interface Stroke { tool: 'pen'; colour: string; width: number; points: Array<[number, number]> }
interface Arrow { tool: 'arrow'; colour: string; width: number; from: [number, number]; to: [number, number] }
interface Box { tool: 'box'; colour: string; width: number; from: [number, number]; to: [number, number] }
interface Label {
  tool: 'text'; colour: string; size: number; at: [number, number]; text: string;
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
  const [typing, setTyping] = useState<{ at: [number, number]; text: string } | null>(null);
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

  const paint = (target: HTMLCanvasElement, all: Mark[]) => {
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
      } else {
        ctx.font = `${m.bold ? 600 : 400} ${m.size}px "IBM Plex Sans", system-ui, sans-serif`;
        ctx.textBaseline = 'top';
        const w = ctx.measureText(m.text).width;
        ctx.fillStyle = 'rgba(255,255,255,.92)';
        ctx.fillRect(m.at[0] - 5, m.at[1] - 4, w + 10, m.size + 8);
        ctx.fillStyle = m.colour;
        ctx.fillText(m.text, m.at[0], m.at[1]);
      }
    }
  };

  useEffect(() => {
    const c = canvasRef.current;
    if (c && ready) paint(c, drawing ? [...marks, drawing] : marks);
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
    const p = at(e);
    if (tool === 'text') {
      setTyping({ at: p, text: '' });
      return;
    }
    (e.target as Element).setPointerCapture(e.pointerId);
    if (tool === 'pen') setDrawing({ tool: 'pen', colour, width: width(), points: [p] });
    else setDrawing({ tool, colour, width: width(), from: p, to: p });
  };

  const move = (e: React.PointerEvent) => {
    if (!drawing) return;
    const p = at(e);
    if (drawing.tool === 'pen') setDrawing({ ...drawing, points: [...drawing.points, p] });
    else if (drawing.tool === 'arrow' || drawing.tool === 'box') setDrawing({ ...drawing, to: p });
  };

  const up = () => {
    if (!drawing) return;
    addMark(drawing);
    setDrawing(null);
  };

  const commitText = () => {
    if (typing && typing.text.trim()) {
      addMark({
        tool: 'text', colour, size: fontSize(), at: typing.at,
        text: typing.text.trim(), bold,
      });
    }
    setTyping(null);
  };

  /**
   * The shortcuts people already have in their fingers. Suppressed while a label is being
   * typed, where the browser's own undo belongs to the input.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inText = e.target instanceof HTMLInputElement;
      if (e.key === 'Escape') {
        // Escape inside the text field cancels the label; outside it closes the editor.
        if (!inText) onCancel();
        return;
      }
      if (inText) return;
      if (isUndo(e)) { e.preventDefault(); undo(); }
      else if (isRedo(e)) { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, onCancel]);

  const save = () => {
    const out = document.createElement('canvas');
    const c = canvasRef.current!;
    out.width = c.width;
    out.height = c.height;
    paint(out, marksRef.current);
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
                  onClick={() => { commitText(); setTool(t.id); }}
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
          {typing && (
            <div
              className="settextbox"
              style={{
                left: `${(typing.at[0] / (canvasRef.current?.width ?? 1)) * 100}%`,
                top: `${(typing.at[1] / (canvasRef.current?.height ?? 1)) * 100}%`,
              }}
            >
              {/* The field looks like the label it is about to become: same colour, same
                  weight, same size on screen. A text tool you have to imagine is a text
                  tool people place twice. */}
              <input
                className="settext"
                autoFocus
                value={typing.text}
                placeholder="Type, then Enter"
                style={{ color: colour, fontWeight: bold ? 600 : 400, fontSize: screenFontSize() }}
                onChange={(e) => setTyping({ ...typing, text: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitText();
                  if (e.key === 'Escape') setTyping(null);
                }}
              />
              <div
                className="settextbar"
                // Keeps the field focused while the controls are pressed.
                onMouseDown={(e) => e.preventDefault()}
              >
                {SIZES.map((sz) => (
                  <button
                    key={sz.label}
                    className={textScale === sz.scale ? 'on' : ''}
                    onClick={() => setTextScale(sz.scale)}
                    aria-pressed={textScale === sz.scale}
                    title={`${sz.title} text`}
                  >
                    {sz.label}
                  </button>
                ))}
                <button
                  className={bold ? 'on' : ''}
                  onClick={() => setBold(!bold)}
                  aria-pressed={bold}
                  title="Bold"
                  style={{ fontWeight: 700 }}
                >
                  B
                </button>
                <span className="sep" />
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
                <span className="sep" />
                <button onClick={commitText} aria-label="Place the label" title="Place it">
                  Place
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <p className="setnote">
        {marks.length} mark{marks.length === 1 ? '' : 's'} · <b>⌘Z</b> undo · <b>⌘⇧Z</b> redo ·{' '}
        <b>Esc</b> cancel. The annotated image is what gets filed — the original is not kept
        separately, so circle the thing rather than describing where it was.
      </p>
    </div>
  );
}
