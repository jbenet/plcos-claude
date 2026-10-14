/**
 * A list's rows, packed for the trip to the browser (performance pass, 12 Oct 2026).
 *
 * Pipeline and Selection send every LP in scope, and each row as an object repeats its ~70 key names
 * and the same few values ("Provisional", the vehicle's name and id, an unknown SPV stance). At 3,000
 * LPs that was 6 MB of HTML, and the browser spent about a second parsing it before the page could be
 * used. Packed, each column is sent once: its values in row order, or, when fewer distinct values make
 * it shorter, each distinct value once and an index per row. Unpacking gives rows equal to the ones
 * packed, with plain values shared between rows that had equal ones; nothing here may mutate a row.
 *
 * A column is shared only when every value in it is plain JSON (strings, finite numbers, booleans,
 * null, arrays and plain objects of those), so equal text always means equal values; any other column
 * (a Date, say) is sent as it is, which the page's own serialiser already handles.
 *
 * A column whose every value is a list of objects (a row's people, its firms) is itself packed: all
 * rows' items as one packed list, and each row's count. Each row reads back its own new array.
 *
 * Two more encodings (performance pass, 14 Oct 2026; a calendar of 56,000 dated rows was 11.6 MB):
 * - A column equal to an earlier one on every row (an org's entityId and orgId, its org and name) is
 *   sent as that column's name.
 * - A text column of mostly unique values with a few shapes (`/meetings?e=<LP>&m=<meeting>`,
 *   `meet:<id>`) is split at its last `=`, `:` or `/`: the heads shared as above, the tails as they are, or `0`
 *   where a tail is the same as an earlier text column's (`r`): a calendar row's link ends in its id's meeting.
 * - A shared column with 36 distinct values or fewer sends its indexes as one base-36 character per row.
 * - A column of Dates (and nulls) is sent as epoch milliseconds, shared as above when that is shorter; each row reads
 *   back its own Date. A text column equal on every row to an earlier one with the same text before and after it
 *   (`<entityId>:neurotech`) is sent as that column's name and the two affixes.
 */
export interface PackedRows {
  n: number;
  /** Column → its values in row order, or `[distinct values, index per row]`. */
  c: Record<string, { v: unknown[] } | { d: unknown[]; i: Index } | { l: PackedRows; k: number[] }
    | { a: string; p?: string; s?: string } | { h: { d: unknown[]; i: Index }; t: Array<string | 0>; r?: string }
    | { e: { d: unknown[]; i: Index } | { v: unknown[] } }>;
}

/** An index per row; with 36 distinct values or fewer, one base-36 character per row (a lane, a standing). */
type Index = number[] | string;
const SMALL = 36;
const at = (i: Index, r: number) => (typeof i === 'string' ? parseInt(i[r]!, 36) : i[r]!);

function plain(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value) && !Object.is(value, -0);
  if (Array.isArray(value)) return value.every(plain);
  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    return (proto === Object.prototype || proto === null) && Object.values(value as object).every(plain);
  }
  return false;
}

/** Keyed by type and text, so a string and a number that print alike stay apart. */
const record = (value: unknown) => typeof value === 'object' && value !== null && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

const keyOf = (value: unknown) => `${Array.isArray(value) ? 'a' : typeof value}${JSON.stringify(value)}`;

/** Each distinct value once and an index per row, and whether that is shorter than the values as they are. */
function share(values: unknown[]) {
  const d: unknown[] = [], seen = new Map<string, number>(), texts = new Map<string, number>(), i: number[] = [];
  let rawLength = 0, dictLength = 0, indexLength = 0;
  for (const v of values) {
    // Text, the common case, is keyed without JSON (a calendar packs 56,000 rows); its length is counted as keyOf's.
    const text = typeof v === 'string', map = text ? texts : seen, key = text ? v : v === undefined ? 'u' : keyOf(v);
    const length = text ? v.length + 8 : key.length;
    rawLength += length;
    let index = map.get(key);
    if (index === undefined) { index = d.length; map.set(key, index); d.push(v); dictLength += length; }
    i.push(index);
    indexLength += (index < 10 ? 1 : index < 100 ? 2 : index < 1000 ? 3 : index < 10000 ? 4 : String(index).length) + 1;
  }
  const small = d.length <= SMALL;
  dictLength += small ? i.length : indexLength;
  return { d, i: small ? i.map((x) => x.toString(36)).join('') : i, rawLength, dictLength };
}

const cut = (v: string) => Math.max(v.lastIndexOf('='), v.lastIndexOf(':'), v.lastIndexOf('/')) + 1;

/**
 * Text split after its last `=`, `:` or `/`, when shared heads and plain tails are at least 5% shorter; else null. A tail equal
 * to the same row's tail of an earlier text column (`earlier`) is sent as 0, naming that column once.
 */
function split(values: unknown[], rawLength: number, earlier: Array<[string, string[]]>) {
  if (!values.length || !values.every((v) => typeof v === 'string')) return null;
  const heads: string[] = [], t: Array<string | 0> = [];
  for (const v of values as string[]) { const at = cut(v); heads.push(v.slice(0, at)); t.push(v.slice(at)); }
  let r: string | undefined, best = 0;
  for (const [k, tails] of earlier) {
    let saved = 0;
    for (let row = 0; row < t.length; row++) if (t[row] && tails[row] === t[row]) saved += (t[row] as string).length;
    if (saved > best) { best = saved; r = k; }
  }
  if (r) { const tails = earlier.find(([k]) => k === r)![1]; t.forEach((x, row) => { if (x && tails[row] === x) t[row] = 0; }); }
  const { d, i, rawLength: headRaw, dictLength } = share(heads);
  const length = Math.min(headRaw, dictLength) + t.reduce<number>((n, x) => n + (x === 0 ? 2 : x.length + 3), 0);
  return length < rawLength * 0.95 ? { h: { d, i }, t, ...(r ? { r } : {}) } : null;
}

/** The earlier text column every value is, with the same text before and after it on every row; else null. */
function affix(values: string[], earlier: Array<[string, unknown[]]>) {
  for (const [k, other] of earlier) {
    const first = other[0];
    if (typeof first !== 'string' || !first) continue;
    const at = values[0]!.indexOf(first);
    if (at < 0) continue;
    const p = values[0]!.slice(0, at), s = values[0]!.slice(at + first.length);
    if (!p && !s) continue;
    if (other.every((o, r) => typeof o === 'string' && values[r] === p + o + s)) return { a: k, ...(p ? { p } : {}), ...(s ? { s } : {}) };
  }
  return null;
}

export function packRows<T extends object>(rows: readonly T[]): PackedRows {
  const columns = new Set<string>();
  for (const row of rows) for (const k of Object.keys(row)) columns.add(k);
  const c: PackedRows['c'] = {};
  const plainColumns: Array<[string, unknown[]]> = [];
  // Each text column's tails, which a later column may refer to; never a column that itself refers or copies.
  const textTails: Array<[string, string[]]> = [];
  for (const k of columns) {
    // A row without the key reads back without it: `undefined` stands for missing.
    const values = rows.map((row) => (Object.prototype.hasOwnProperty.call(row, k) ? (row as Record<string, unknown>)[k] : undefined));
    if (values.length && values.every((v) => Array.isArray(v) && v.every(record)) && values.some((v) => (v as unknown[]).length)) {
      const lists = values as object[][];
      c[k] = { l: packRows(lists.flat()), k: lists.map((list) => list.length) };
      continue;
    }
    if (values.some((v) => v instanceof Date) && values.every((v) => v === null || (v instanceof Date && Number.isFinite(v.getTime())))) {
      const ms = values.map((v) => (v === null ? null : (v as Date).getTime()));
      const { d, i, rawLength, dictLength } = share(ms);
      c[k] = { e: dictLength < rawLength ? { d, i } : { v: ms } };
      continue;
    }
    if (!values.every((v) => v === undefined || plain(v))) { c[k] = { v: values }; continue; }
    // Text, numbers, booleans and nulls only: equal values are identical, so a copy reads back equal.
    const same = values.every((v) => v === undefined || v === null || typeof v !== 'object')
      ? plainColumns.find(([, other]) => other.every((v, r) => Object.is(v, values[r]))) : undefined;
    if (same) { c[k] = { a: same[0] }; continue; }
    const affixed = values.length && values.every((v) => typeof v === 'string') ? affix(values as string[], plainColumns) : null;
    if (affixed) { c[k] = affixed; continue; }
    if (values.every((v) => v === undefined || v === null || typeof v !== 'object')) plainColumns.push([k, values]);
    const { d, i, rawLength, dictLength } = share(values);
    const col = dictLength < rawLength ? { d, i } : split(values, rawLength, textTails) ?? { v: values };
    c[k] = col;
    if (!('r' in col) && values.every((v) => typeof v === 'string')) textTails.push([k, (values as string[]).map((v) => v.slice(cut(v)))]);
  }
  return { n: rows.length, c };
}

export function unpackRows<T>(packed: PackedRows): T[] {
  const rows: Record<string, unknown>[] = Array.from({ length: packed.n }, () => ({}));
  for (const [k, col] of Object.entries(packed.c)) {
    if ('l' in col) {
      const items = unpackRows<unknown>(col.l);
      let at = 0;
      col.k.forEach((count, r) => { rows[r]![k] = items.slice(at, at + count); at += count; });
    } else if ('e' in col) {
      const e = col.e;
      for (let r = 0; r < packed.n; r++) { const ms = 'v' in e ? e.v[r] : e.d[at(e.i, r)]; rows[r]![k] = ms === null ? null : new Date(ms as number); }
    } else if ('v' in col) col.v.forEach((v, r) => { if (v !== undefined) rows[r]![k] = v; });
    else if ('h' in col && !col.r) col.t.forEach((tail, r) => { rows[r]![k] = (col.h.d[at(col.h.i, r)] as string) + tail; });
    else if ('d' in col) for (let r = 0; r < packed.n; r++) { const v = col.d[at(col.i, r)]; if (v !== undefined) rows[r]![k] = v; }
  }
  // A copied column reads its source's values; sources are always earlier, plain, and never copies.
  for (const [k, col] of Object.entries(packed.c)) {
    if ('a' in col) rows.forEach((row) => { const v = row[col.a]; if (v !== undefined) row[k] = col.p || col.s ? `${col.p ?? ''}${v as string}${col.s ?? ''}` : v; });
    // A tail sent as 0 is the same row's tail of the column `r` names, which is never itself a reference.
    if ('h' in col && col.r) {
      const from = col.r;
      col.t.forEach((tail, r) => {
        const source = rows[r]![from] as string;
        rows[r]![k] = (col.h.d[at(col.h.i, r)] as string) + (tail === 0 ? source.slice(cut(source)) : tail);
      });
    }
  }
  return rows as T[];
}
