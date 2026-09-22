import sharp from 'sharp';

/**
 * How a changelog screenshot is stored (issue 0021). One place, used by `npm run shots` and
 * by `npm run shots:compress`, so the two cannot drift.
 *
 * Captures are taken at 2× (2880 px wide for the 1440 px board viewport) and kept at 2000
 * px: sharp on a wide screen, and a lightbox never shows more. WebP at quality 80 is
 * indistinguishable from the PNG at reading size, and 4–5× smaller. Screenshots are
 * committed, and git keeps every version of every one forever, so their size is paid on
 * every clone.
 */
export const SHOT = {
  maxWidth: 2000,
  quality: 80,
  ext: '.webp',
  /** `npm run boundaries` fails on anything bigger. A full-page capture lands near 400 KB. */
  maxBytes: 512 * 1024,
} as const;

export async function encodeShot(png: Buffer): Promise<Buffer> {
  return sharp(png)
    .resize({ width: SHOT.maxWidth, withoutEnlargement: true })
    .webp({ quality: SHOT.quality, effort: 6 })
    .toBuffer();
}
