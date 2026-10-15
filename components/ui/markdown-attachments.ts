/**
 * The pictures a markdown field holds, apart from the editor itself: the feedback box is on every page, and the
 * editor (tiptap, about 400 KB of script) loads only when a field is drawn (15 Oct 2026).
 */
export interface DroppedImage {
  /** 1-based, and the same number the body's `attachment:N` refers to. */
  index: number;
  name: string;
  contentType: string;
  /** Data URL, for the preview here and for the POST. */
  dataUrl: string;
  /** Drawn on after it was dropped in (issue 0018). */
  annotated?: boolean;
}

/**
 * Only the pictures still in the text are sent (issue 0020).
 *
 * Deleting an image from the description used to leave it in the upload — so dragging in the
 * wrong picture and deleting it still filed it. This keeps the pictures the text refers to,
 * in the order it refers to them, and renumbers the references to match, because the server
 * resolves `attachment:N` by position.
 */
export function packAttachments(body: string, images: DroppedImage[]): { body: string; images: DroppedImage[] } {
  const order: number[] = [];
  for (const m of body.matchAll(/\(attachment:(\d+)\)/g)) {
    const n = Number(m[1]);
    if (!order.includes(n) && images.some((i) => i.index === n)) order.push(n);
  }
  const renumber = new Map(order.map((n, k) => [n, k + 1]));
  return {
    body: body.replace(/\(attachment:(\d+)\)/g, (whole, n: string) =>
      (renumber.has(Number(n)) ? `(attachment:${renumber.get(Number(n))})` : whole)),
    images: order.map((n, k) => ({ ...images.find((i) => i.index === n)!, index: k + 1 })),
  };
}
