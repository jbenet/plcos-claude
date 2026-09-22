/**
 * A title from the first thing somebody wrote (issues 0012, 0015–0019).
 *
 * The first version took the first *line* and cut it at 72 characters, so every report
 * written as two sentences on one line came out as the first sentence plus half of the
 * second and an ellipsis — "…are hard to see (in this…". This takes the first **sentence**,
 * drops parenthetical asides before it cuts anything, then prefers a clause boundary to a
 * word boundary, and only then reaches for the ellipsis.
 *
 * It returns an empty string when there is nothing to name: intake can invent a title, and
 * it cannot invent a complaint.
 */
const MAX = 72;

export function titleFrom(body: string): string {
  const line = body
    .split(/\n/)
    .map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)]|>|#{1,6})\s*/, '').trim())
    .find((l) => l.length > 0 && !l.startsWith('```') && !l.startsWith('!['));
  if (!line) return '';

  let t = line
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return '';

  // The first sentence. A full stop after a quote or a bracket still ends one.
  const sentence = /^(.+?[.!?])(?=\s|$)/.exec(t);
  if (sentence && sentence[1]!.length >= 12) t = sentence[1]!;
  // A full stop or a dangling colon or comma is punctuation for the sentence, not the title.
  t = t.replace(/[.,:;\s—-]+$/, '').trim();

  if (t.length > MAX) t = t.replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  if (t.length > MAX) {
    const head = t.slice(0, MAX);
    const clause = Math.max(head.lastIndexOf(', '), head.lastIndexOf('; '), head.lastIndexOf(' — '), head.lastIndexOf(': '));
    t = clause >= 32 ? head.slice(0, clause) : `${head.replace(/\s+\S*$/, '')}…`;
  }
  return t.charAt(0).toUpperCase() + t.slice(1);
}
