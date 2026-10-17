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
 * - A shared column with 36 distinct values or fewer sends its indexes as one base-36 character per row; a run of five or
 *   more equal characters is sent as the character, `~`, the run's length in base 36 and `.` (`0~pg.` is 916 zeros): most
 *   of a list's columns are one value on nearly every row, and those runs were a fifth of Pipeline's and Visualizations'
 *   packed rows (perf pass, 17 Oct 2026).
 * - A column of Dates (and nulls) is sent as epoch milliseconds, shared as above when that is shorter; each row reads
 *   back its own Date. A text column equal on every row to an earlier one with the same text before and after it
 *   (`<entityId>:neurotech`) is sent as that column's name and the two affixes.
 * - A text column that is, on every row, another plain text column (earlier or later) followed by one of a few endings
 *   (a floor item's key, `<entityId>:<vehicle>` across vehicles; 15 Oct 2026) is sent as that column's name and the
 *   endings, shared as above.
 * - A column of ids (every value a lowercase uuid; repeats too, unless sharing them is shorter) is one string of 22
 *   base64url characters per row, instead of 39 characters of quoted text: ids were over half of what Pipeline sent
 *   once text was shared (15 Oct 2026).
 */
export interface PackedRows {
  n: number;
  /** Column → its values in row order, or `[distinct values, index per row]`. */
  c: Record<string, { v: unknown[] } | { d: unknown[]; i: Index } | { l: PackedRows; k: number[] }
    | { a: string; p?: string; s?: string } | { a: string; x: { d: unknown[]; i: Index } } | { h: { d: unknown[]; i: Index }; t: Array<string | 0>; r?: string }
    | { e: { d: unknown[]; i: Index } | { v: unknown[] } } | { u: string }>;
}

/** An index per row; with 36 distinct values or fewer, one base-36 character per row (a lane, a standing). */
type Index = number[] | string;
const SMALL = 36;
/**
 * Base-36 digits by character code, both ways: `parseInt(c, 36)` and `x.toString(36)` once per row were a tenth of
 * packing and unpacking the floor (perf pass, 17 Oct 2026). Same digits, lowercase as toString gives them.
 */
const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
const DIGIT_OF = new Int8Array(128).fill(-1);
for (let d = 0; d < DIGITS.length; d++) { DIGIT_OF[DIGITS.charCodeAt(d)] = d; DIGIT_OF[DIGITS.toUpperCase().charCodeAt(d)] = d; }
const at = (i: Index, r: number) => (typeof i === 'string' ? DIGIT_OF[i.charCodeAt(r)]! : i[r]!);

/** Runs of five or more equal characters as `<char>~<length in base 36>.`; shorter runs as they are (perf pass, 17 Oct 2026). */
const RUN = 5;
function runsOut(digits: string) {
  let out = '';
  for (let from = 0; from < digits.length;) {
    const ch = digits.charCodeAt(from);
    let to = from + 1;
    while (to < digits.length && digits.charCodeAt(to) === ch) to++;
    out += to - from >= RUN ? `${digits[from]}~${(to - from).toString(36)}.` : digits.slice(from, to);
    from = to;
  }
  return out;
}
/** One character per row again; an index without runs is returned as it is. */
function runsIn(i: Index): Index {
  if (typeof i !== 'string' || !i.includes('~')) return i;
  let out = '';
  for (let at = 0; at < i.length;) {
    if (i.charCodeAt(at + 1) === 126) { // ~
      const end = i.indexOf('.', at + 2);
      out += i[at]!.repeat(parseInt(i.slice(at + 2, end), 36));
      at = end + 1;
    } else out += i[at++];
  }
  return out;
}

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
    // Numbers, booleans and null print as JSON would, without calling it (it was a quarter of packing Pipeline).
    const text = typeof v === 'string', map = text ? texts : seen;
    const key = text ? v : v === undefined ? 'u' : v === null ? 'objectnull'
      : typeof v === 'number' || typeof v === 'boolean' ? `${typeof v}${v}` : keyOf(v);
    const length = text ? v.length + 8 : key.length;
    rawLength += length;
    let index = map.get(key);
    if (index === undefined) { index = d.length; map.set(key, index); d.push(v); dictLength += length; }
    i.push(index);
    indexLength += (index < 10 ? 1 : index < 100 ? 2 : index < 1000 ? 3 : index < 10000 ? 4 : String(index).length) + 1;
  }
  const small = d.length <= SMALL;
  let digits = '';
  if (small) { for (const x of i) digits += DIGITS[x]!; digits = runsOut(digits); }
  dictLength += small ? digits.length : indexLength;
  return { d, i: small ? digits : i, rawLength, dictLength };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
/** 32 hex digits, three at a time (12 bits) as two characters; the last two digits are padded to 12 bits. */
function uuidsOut(values: string[]) {
  let out = '';
  for (const v of values) out += uuidOut(v);
  return out;
}
/**
 * One id's 22 characters, kept: the same ids are packed again on every build of a list (Pipeline's 4,500 rows, five
 * id columns each, after every write; performance pass, 17 Oct 2026). Bounded; cleared whole when full.
 */
const idCodes = new Map<string, string>();
const ID_CODES_KEPT = 100_000; // GUESS: well above the ids a few lists hold.
function uuidOut(v: string) {
  let code = idCodes.get(v);
  if (code === undefined) {
    code = '';
    const hex = v.replaceAll('-', '') + '0';
    for (let at = 0; at < 33; at += 3) { const n = parseInt(hex.slice(at, at + 3), 16); code += B64[n >> 6]! + B64[n & 63]!; }
    if (idCodes.size >= ID_CODES_KEPT) idCodes.clear();
    idCodes.set(v, code);
  }
  return code;
}
/**
 * Each character's six bits by code, and each 12-bit value's three hex digits, made on first use: looking a character
 * up in B64 and printing every three digits was a fifth of unpacking the floor (perf pass, 17 Oct 2026).
 */
let B64_OF: Int8Array | undefined;
let HEX3: string[] | undefined;
function uuidsIn(text: string, n: number) {
  if (!B64_OF || !HEX3) {
    B64_OF = new Int8Array(128).fill(-1);
    for (let d = 0; d < 64; d++) B64_OF[B64.charCodeAt(d)] = d;
    HEX3 = Array.from({ length: 4096 }, (_, x) => x.toString(16).padStart(3, '0'));
  }
  const of = B64_OF, hex3 = HEX3;
  const out = new Array<string>(n);
  for (let r = 0; r < n; r++) {
    let hex = '';
    for (let at = r * 22; at < r * 22 + 22; at += 2) hex += hex3[(of[text.charCodeAt(at)]! << 6) | of[text.charCodeAt(at + 1)]!]!;
    out[r] = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  }
  return out;
}

/** Just after the last `=`, `:` or `/`; 0 when there is none. One scan from the end, not three (perf pass, 17 Oct 2026). */
function cut(v: string) {
  for (let at = v.length - 1; at >= 0; at--) {
    const ch = v.charCodeAt(at);
    if (ch === 61 || ch === 58 || ch === 47) return at + 1; // = : /
  }
  return 0;
}

/**
 * Text split after its last `=`, `:` or `/`, when shared heads and plain tails are at least 5% shorter; else null. A tail equal
 * to the same row's tail of an earlier text column (`earlier`) is sent as 0, naming that column once.
 */
/** An earlier text column; its tails are cut only when a later column is split and compares against them. */
interface TextColumn { k: string; values: string[]; tails?: string[] }
const tailsOf = (col: TextColumn) => (col.tails ??= col.values.map((v) => v.slice(cut(v))));

function split(values: unknown[], rawLength: number, earlier: TextColumn[]) {
  if (!values.length || !values.every((v) => typeof v === 'string')) return null;
  const heads: string[] = [], t: Array<string | 0> = [];
  for (const v of values as string[]) { const at = cut(v); heads.push(v.slice(0, at)); t.push(v.slice(at)); }
  let r: string | undefined, best = 0;
  for (const col of earlier) {
    const k = col.k, tails = tailsOf(col);
    let saved = 0;
    for (let row = 0; row < t.length; row++) if (t[row] && tails[row] === t[row]) saved += (t[row] as string).length;
    if (saved > best) { best = saved; r = k; }
  }
  if (r) { const tails = tailsOf(earlier.find((col) => col.k === r)!); t.forEach((x, row) => { if (x && tails[row] === x) t[row] = 0; }); }
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
  // Every column in one pass over the rows, in the order keys first appear; a row without a key reads `undefined`,
  // which stands for missing (one lookup per row per column was a fifth of packing Pipeline, 15 Oct 2026).
  const byColumn = new Map<string, unknown[]>();
  // Rows mostly share one shape: the previous row's keys and their columns are reused when this row's keys match.
  let shape: string[] = [], lists: unknown[][] = [];
  rows.forEach((row, r) => {
    const keys = Object.keys(row);
    if (keys.length !== shape.length || keys.some((k, i) => k !== shape[i])) {
      shape = keys;
      lists = keys.map((k) => {
        let list = byColumn.get(k);
        if (!list) { list = new Array<unknown>(rows.length).fill(undefined); byColumn.set(k, list); }
        return list;
      });
    }
    for (let i = 0; i < keys.length; i++) lists[i]![r] = (row as Record<string, unknown>)[keys[i]!];
  });
  const c: PackedRows['c'] = {};
  const plainColumns: Array<[string, unknown[]]> = [];
  // Each text column's tails, which a later column may refer to; never a column that itself refers or copies.
  const textTails: TextColumn[] = [];
  for (const [k, values] of byColumn) {
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
    // Ids, even repeated ones, unless sharing them is shorter still: the floor's entityId (an LP once per vehicle,
    // 5,037 distinct of 6,039) was 236 KB shared and is 133 KB as ids (17 Oct 2026).
    const ids = !('r' in col) && values.every((v) => typeof v === 'string' && UUID.test(v)) && (!('d' in col) || values.length * 22 < dictLength);
    c[k] = ids ? { u: uuidsOut(values as string[]) } : col;
    if (!('r' in col) && values.every((v) => typeof v === 'string')) textTails.push({ k, values: values as string[] });
  }
  ending(c, plainColumns);
  return { n: rows.length, c };
}

/**
 * Columns that are another column plus a shared ending become references to it. Only a column that nothing refers
 * to may become one, and only a column that is not, and will not become, a reference may be its source.
 */
function ending(c: PackedRows['c'], plainColumns: Array<[string, unknown[]]>) {
  const sources = new Set<string>();
  for (const col of Object.values(c)) { if ('a' in col) sources.add(col.a); if ('h' in col && col.r) sources.add(col.r); }
  const references = new Set<string>();
  const texts = plainColumns.filter(([, v]) => v.length && v.every((x) => typeof x === 'string' && x)) as Array<[string, string[]]>;
  for (const [k, values] of texts) {
    const col = c[k]!;
    if (sources.has(k) || 'a' in col || ('h' in col && col.r)) continue;
    // Measured only once some column could be its source: most never have one (perf pass, 17 Oct 2026).
    let length: number | undefined;
    for (const [o, other] of texts) {
      if (o === k || references.has(o) || ('h' in c[o]! && (c[o] as { r?: string }).r) || !values.every((v, r) => v.length > other[r]!.length && v.startsWith(other[r]!))) continue;
      const { d, i } = share(values.map((v, r) => v.slice(other[r]!.length)));
      const x = { a: o, x: { d, i } };
      length ??= JSON.stringify(col).length;
      if (JSON.stringify(x).length < length * 0.8) { c[k] = x; references.add(k); sources.add(o); break; }
    }
  }
}

export function unpackRows<T>(packed: PackedRows): T[] {
  // Each column's values first (`undefined` is a missing key), then each row in one go: filling rows a column at a
  // time was twice as slow, every row's properties growing across the whole pass (Pipeline, 15 Oct 2026).
  const n = packed.n;
  const values = new Map<string, unknown[]>();
  const column = (f: (r: number) => unknown) => { const out = new Array<unknown>(n); for (let r = 0; r < n; r++) out[r] = f(r); return out; };
  for (const [k, col] of Object.entries(packed.c)) {
    if ('l' in col) {
      const items = unpackRows<unknown>(col.l);
      let from = 0;
      values.set(k, col.k.map((count) => items.slice(from, (from += count))));
    } else if ('e' in col) {
      const e = col.e, ei = 'i' in e ? runsIn(e.i) : [];
      values.set(k, column((r) => { const ms = 'v' in e ? e.v[r] : e.d[at(ei, r)]; return ms === null ? null : new Date(ms as number); }));
    } else if ('u' in col) values.set(k, uuidsIn(col.u, n));
    else if ('v' in col) values.set(k, col.v);
    else if ('h' in col && !col.r) { const hi = runsIn(col.h.i); values.set(k, col.t.map((tail, r) => (col.h.d[at(hi, r)] as string) + tail)); }
    else if ('d' in col) { const i = runsIn(col.i); values.set(k, column((r) => col.d[at(i, r)])); }
  }
  // A copied column reads its source's values; sources are always earlier, plain, and never copies.
  for (const [k, col] of Object.entries(packed.c)) {
    if ('a' in col && 'x' in col) { const x = col.x, xi = runsIn(x.i), source = values.get(col.a)!; values.set(k, column((r) => (source[r] as string) + (x.d[at(xi, r)] as string))); }
    else if ('a' in col) {
      const source = values.get(col.a)!;
      values.set(k, column((r) => { const v = source[r]; return v === undefined || !(col.p || col.s) ? v : `${col.p ?? ''}${v as string}${col.s ?? ''}`; }));
    }
    // A tail sent as 0 is the same row's tail of the column `r` names, which is never itself a reference.
    if ('h' in col && col.r) {
      const source = values.get(col.r)!, hi = runsIn(col.h.i);
      values.set(k, col.t.map((tail, r) => {
        const from = source[r] as string;
        return (col.h.d[at(hi, r)] as string) + (tail === 0 ? from.slice(cut(from)) : tail);
      }));
    }
  }
  const keys = [...values.keys()], lists = [...values.values()];
  const rows = new Array<Record<string, unknown>>(n);
  for (let r = 0; r < n; r++) {
    const row: Record<string, unknown> = {};
    for (let j = 0; j < keys.length; j++) { const v = lists[j]![r]; if (v !== undefined) row[keys[j]!] = v; }
    rows[r] = row;
  }
  return rows as T[];
}
