'use client';

import { useEffect, useRef, useState } from 'react';

type Tool = 'pen' | 'arrow' | 'box' | 'text';

interface Stroke { tool: 'pen'; colour: string; width: number; points: Array<[number, number]> }
interface Arrow { tool: 'arrow'; colour: string; width: number; from: [number, number]; to: [number, number] }
interface Box { tool: 'box'; colour: string; width: number; from: [number, number]; to: [number, number] }
interface Label { tool: 'text'; colour: string; size: number; at: [number, number]; text: string }
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
  const [tool, setTool] = useState<Tool>('arrow');
  const [colour, setColour] = useState(COLOURS[0]!.id);
  const [drawing, setDrawing] = useState<Mark | null>(null);
  const [typing, setTyping] = useState<{ at: [number, number]; text: string } | null>(null);
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
        ctx.font = `600 ${m.size}px "IBM Plex Sans", system-ui, sans-serif`;
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
  const fontSize = () => Math.max(16, Math.round((canvasRef.current?.width ?? 1400) / 58));

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
    setMarks((m) => [...m, drawing]);
    setDrawing(null);
  };

  const commitText = () => {
    if (typing && typing.text.trim()) {
      setMarks((m) => [...m, { tool: 'text', colour, size: fontSize(), at: typing.at, text: typing.text.trim() }]);
    }
    setTyping(null);
  };

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
      <div className="setop">
        <div className="lbl">Annotate</div>
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
          <button className="btn" onClick={() => setMarks((m) => m.slice(0, -1))} disabled={marks.length === 0}>
            Undo
          </button>
          <button className="btn" onClick={() => setMarks([])} disabled={marks.length === 0}>
            Clear
          </button>
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn p" onClick={save}>Done</button>
        </div>
      </div>

      <div className="setstage">
        <div className="setwrap">
          <canvas
            ref={canvasRef}
            className={`setcanvas t-${tool}`}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
          />
          {typing && (
            <input
              className="settext"
              autoFocus
              value={typing.text}
              placeholder="Type, then Enter"
              style={{
                left: `${(typing.at[0] / (canvasRef.current?.width ?? 1)) * 100}%`,
                top: `${(typing.at[1] / (canvasRef.current?.height ?? 1)) * 100}%`,
                color: colour,
              }}
              onChange={(e) => setTyping({ ...typing, text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitText();
                if (e.key === 'Escape') setTyping(null);
              }}
              onBlur={commitText}
            />
          )}
        </div>
      </div>

      <p className="setnote">
        {marks.length} mark{marks.length === 1 ? '' : 's'}. The annotated image is what gets
        filed — the original is not kept separately, so circle the thing rather than describing
        where it was.
      </p>
    </div>
  );
}
