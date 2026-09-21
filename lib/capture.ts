/**
 * Capturing what the reporter is actually looking at.
 *
 * Two ways, and they are not equivalent:
 *
 *   screen  — `getDisplayMedia` with `preferCurrentTab`. The browser hands back the frames
 *             it composited, so this is *the pixels on the screen*: real font rasterisation,
 *             real scrollbars, real everything. It needs a permission prompt.
 *   render  — the DOM re-drawn through an SVG foreignObject. Close, and not the same. Text
 *             re-wraps at sub-pixel boundaries, form controls draw differently, and anything
 *             the engine does at paint time is approximated.
 *
 * The screen path is tried first because a feedback screenshot that is subtly not what the
 * person saw is worse than useless — they report the thing they saw and the picture
 * disagrees. The renderer is the fallback for a declined prompt or a browser without the
 * API, and the box says which one it got rather than letting them assume.
 */

export type CaptureMethod = 'screen' | 'render';

export interface Capture {
  dataUrl: string;
  method: CaptureMethod;
  /** Why the exact path was not used, when it was not. */
  note: string | null;
}

const MAX_WIDTH = 2000;

function toPng(source: CanvasImageSource, w: number, h: number): string {
  const scale = Math.min(1, MAX_WIDTH / w);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

/**
 * One frame of the current tab. Must be called from the click handler itself — the API
 * needs transient user activation, so anything awaited before it loses the gesture.
 */
async function captureScreen(): Promise<string | null> {
  const md = navigator.mediaDevices;
  if (!md?.getDisplayMedia) return null;

  let stream: MediaStream | null = null;
  try {
    stream = await md.getDisplayMedia({
      audio: false,
      video: { displaySurface: 'browser' },
      // Chrome-only hints: pre-select this tab, and do not offer to switch mid-capture.
      preferCurrentTab: true,
      selfBrowserSurface: 'include',
      surfaceSwitching: 'exclude',
      monitorTypeSurfaces: 'exclude',
    } as DisplayMediaStreamOptions);

    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();
    // Two frames: the first is often blank while the pipeline spins up.
    await new Promise<void>((r) =>
      requestAnimationFrame(() => requestAnimationFrame(() => r())),
    );
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return null;
    return toPng(video, w, h);
  } catch {
    return null;
  } finally {
    stream?.getTracks().forEach((t) => t.stop());
  }
}

async function captureRender(): Promise<string | null> {
  try {
    const { domToPng } = await import('modern-screenshot');
    // Without this the clone renders in fallback metrics and every heading re-wraps.
    await document.fonts.ready;
    const w = window.innerWidth;
    const h = window.innerHeight;
    return await domToPng(document.body, {
      width: w,
      height: h,
      scale: Math.min(2, window.devicePixelRatio || 1, MAX_WIDTH / w),
      backgroundColor: getComputedStyle(document.body).backgroundColor,
      style: {
        transform: `translate(${-window.scrollX}px, ${-window.scrollY}px)`,
        transformOrigin: 'top left',
      },
      filter: (node: Node) =>
        !(node instanceof Element && node.classList.contains('nocapture')),
    });
  } catch {
    return null;
  }
}

export async function capturePage(): Promise<Capture | null> {
  const screen = await captureScreen();
  if (screen) return { dataUrl: screen, method: 'screen', note: null };

  const rendered = await captureRender();
  if (rendered) {
    return {
      dataUrl: rendered,
      method: 'render',
      note:
        'Your browser did not hand over a screen capture, so this is the page redrawn from '
        + 'its own markup. It is close, and small things — text wrapping, form controls, '
        + 'scrollbars — can differ from what you saw.',
    };
  }
  return null;
}

export const METHOD_LABEL: Record<CaptureMethod, string> = {
  screen: 'Captured from your screen',
  render: 'Redrawn from the page',
};
