/**
 * Capturing what the reporter is looking at, without asking for permission.
 *
 * Two ways, and they are not equivalent:
 *
 *   render  — the DOM re-drawn through an SVG foreignObject, by the browser's own engine.
 *             No permission prompt, and it **can redact**: anything marked `nocapture` is
 *             dropped, which is how the feedback drawer stays out of its own screenshot.
 *   screen  — `getDisplayMedia`. Literally the composited frame, and therefore exact — but
 *             it shows a permission dialog every single time and it cannot redact anything,
 *             because by then the pixels are just pixels.
 *
 * **Render is the default.** Once the clone waits for `document.fonts.ready` the difference
 * is small enough that it is not worth a dialog on every complaint, and the redaction is
 * worth more than the last few per cent of fidelity. The screen path stays available for
 * somebody who explicitly wants exact pixels and will accept the prompt.
 *
 * Nothing is captured when the box opens. A screenshot is taken when somebody asks for one.
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

export interface Region { x: number; y: number; w: number; h: number }

/**
 * The page, redrawn. Optionally cropped to a region the reporter drew.
 *
 * Cropping happens after the render rather than by rendering a sub-tree: a region is a
 * rectangle on the screen and usually cuts across several elements, so the honest thing is
 * to draw the page and cut the rectangle out of it.
 */
export async function captureRender(region?: Region): Promise<string | null> {
  try {
    const { domToPng } = await import('modern-screenshot');
    // Without this the clone renders in fallback metrics and every heading re-wraps.
    await document.fonts.ready;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const scale = Math.min(2, window.devicePixelRatio || 1, MAX_WIDTH / w);
    const full = await domToPng(document.body, {
      width: w,
      height: h,
      scale,
      backgroundColor: getComputedStyle(document.body).backgroundColor,
      style: {
        transform: `translate(${-window.scrollX}px, ${-window.scrollY}px)`,
        transformOrigin: 'top left',
      },
      filter: (node: Node) =>
        !(node instanceof Element && node.classList.contains('nocapture')),
    });
    if (!region) return full;
    return await crop(full, region, scale);
  } catch {
    return null;
  }
}

function crop(dataUrl: string, r: Region, scale: number): Promise<string> {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(r.w * scale));
      c.height = Math.max(1, Math.round(r.h * scale));
      c.getContext('2d')!.drawImage(
        img, r.x * scale, r.y * scale, r.w * scale, r.h * scale,
        0, 0, c.width, c.height,
      );
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/** The default: no dialog, and the feedback drawer is redacted out of its own picture. */
export async function capturePage(region?: Region): Promise<Capture | null> {
  const rendered = await captureRender(region);
  if (!rendered) return null;
  return {
    dataUrl: rendered,
    method: 'render',
    note:
      'Drawn by your browser from the page itself, with no permission prompt. Anything marked '
      + 'as not-for-capture — the feedback panel included — is left out.',
  };
}

/** Exact pixels, and a permission dialog. Only when somebody asks for it by name. */
export async function capturePageExact(): Promise<Capture | null> {
  const screen = await captureScreen();
  if (screen) return { dataUrl: screen, method: 'screen', note: null };
  return capturePage();
}

export const METHOD_LABEL: Record<CaptureMethod, string> = {
  screen: 'Captured from your screen',
  render: 'Drawn from the page',
};
