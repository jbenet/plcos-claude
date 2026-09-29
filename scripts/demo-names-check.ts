import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';

/**
 * The demo seed carries no real names (29 Sep 2026: "demo screenshots must avoid real names —
 * generate random names"). Its people and firms were replaced with names from lib/demo-names.ts;
 * this refuses the names it used to carry, should one be pasted back in.
 *
 * Only hashes are kept: a name here would be the very thing the check exists to keep out of the
 * repository. Each is sha256 over SALT and the name folded (accents removed, lower case, words
 * joined by one space), first 16 hex digits. `person` holds full names, `org` firm names, and
 * `token` single family names and firm words distinctive enough to flag alone. A lower-case team
 * handle (fixtures/users.json) is a login, not a name, so a token that is one is let through.
 */
export const SALT = 'plcos-demo-names/';

export const DEMO_REAL_NAME_HASHES = {
  person: [
    '851bb7ce30a868c7', '6cf0e3139cbcb1d9', 'e6f56f4c981e695d', '3a7bb86fb4412325', '8bb4aa9fe6f8a90c',
    'db76698373eadd6d', '7afe7e893b44869e', '382ad584e04bf8cb', '5035c48c6f21823a', 'ee9f6441e09ce9ec',
    '41ac0f9421922cc5', '3e43194fc34e1396', 'fe002ab545ab8563', '7eda3ad024cea498', 'a7b35a07f9bc499e',
    '811cd8bee8d9310c', '777d9ff5861898d6', 'c107546a5e6ec24d', 'ade4a5bb48f6e243', 'd1c44c99f11884db',
    '80325e1c5e0851b8', 'c0794c6c6881109b', '82898425c94eccd0', 'b54d18793bfb8e9f', '1d685372c606d5f2',
    '3f774cd7912d811d', 'dfc86861c5854e35', 'dfca9dddec19bcfa', '66555bd68cbe2bb7', '1c9bf1ca97a0e3e2',
    'dd7fb08601f5f25d', 'a646aea8b9c998da', 'a560e05392870aa7',
  ],
  org: [
    '543248ff2f0f866b', 'bba872fc3a704f1c', '19df1be697e080ac', 'f10efcc62ea86373', '5cf152a5249f4eb1',
    'a50d4776a25a4fc5', 'c02ba5981c618dd8', '0c692621ca52603b', 'c85d6d2d0a7377e3', '8263423c16004444',
    '299140a91a14bcbf', '036afe150bb58021', '3ffc080a72744027', '84210e82fef08ba1', 'da66a8dd832e4185',
    '8ebf6a0906ba6770', '8ad7b5521d6872e2', '0483cd7986056e00', 'a17bdcdd99b6765e', '9f6e0f9de37f4b08',
    '064bdf499660a7fa', '7efcd0e631a86750', 'e2fcfd4e2a8bc77d', '966b7b94f1ff55df', 'a889aff7db9a4cb6',
    '213bca150698afe7', 'f7192c322e1f8624', '357e9cc8b43c3e14', '116fad6f067c1475', '46268ee535619007',
    '1edb7e964c3e00e3', '4e31159e0d6ee8d3', '0a0c01917e379fcc', '7ce84faa4b3b4344', '3c69e497f7254c97',
    'b18b21b15cd13b9d', 'fe18d8a00f3e8d14', 'e9cbaac0e00ac9d0',
  ],
  token: [
    '8017fb9c7ac51d6d', 'ee42a99b031f2221', '0adc9c4ca0e787f0', '8f780be2b5de9e92', '9c3e3cd5da2b58ff',
    'cb283de3723015c7', 'da854fb0d123e52c', '5d5161cce3daf3bc', '18313b04782f5922', '8a345b20496a43a7',
    '970590897732897a', 'bc31c50663fbeab4', '992fd20c932dd74b', '2748cbb8e39e42fc', 'd4d03fe8e43d5ec7',
    '7fb0541d4ff85c6e', '55dd5701abd769d4', '7ed7e8e30e216179', '06b154c03d534e95', '6c3d34d0b246700d',
    '5558cdd0113550d1', 'db70cfd991271257', '9c5e248308ffba48', '0276e70c1cfe52a9', 'f6047746e272e7c6',
    '09ef3bfad9c96367', 'aa209389faca7470', 'dc98ae715ac213f2', '5a7400fa0af533cb', 'c79c8ea93a3038eb',
    '179295cab4ca0abd', '01587ea8892153b6', 'a3eac759e7f2af61', 'ebb220fcd138b4a9', 'f96cc0e670c55665',
  ],
};

export interface NameHashes { person: readonly string[]; org: readonly string[]; token: readonly string[] }

const fold = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

/** The hash a name is stored under: fold it, keep its words, join them with one space. */
export function nameHash(name: string): string {
  const words = fold(name).match(/\p{L}+/gu) ?? [];
  return createHash('sha256').update(SALT + words.join(' ')).digest('hex').slice(0, 16);
}

/**
 * Every place in `text` where a hashed name appears: one to three words in a row, separated only
 * by spaces, hyphens or "&" ("Given Family", "Given Family-Name", "Word & Word"). JSON's \u escapes are read as the letters they
 * stand for, so an escaped accent cannot hide a name.
 */
export function findHashedNames(text: string, hashes: NameHashes, handles: ReadonlySet<string> = new Set()): Array<{ line: number; text: string }> {
  const decoded = text.replace(/\\u([0-9a-fA-F]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
  const multi = new Set([...hashes.person, ...hashes.org]);
  const single = new Set(hashes.token);
  const words = [...decoded.matchAll(/\p{L}[\p{L}\p{M}]*/gu)].map((m) => ({ raw: m[0], at: m.index, end: m.index + m[0].length }));
  const hits: Array<{ line: number; text: string }> = [];
  const lineOf = (at: number) => decoded.slice(0, at).split('\n').length;
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (single.has(nameHash(w.raw)) && !(w.raw === w.raw.toLowerCase() && handles.has(w.raw))) {
      hits.push({ line: lineOf(w.at), text: w.raw });
    }
    for (let n = 2; n <= 3 && i + n <= words.length; n++) {
      const run = words.slice(i, i + n);
      const joined = run.every((x, k) => k === 0 || /^[ \t&-]+$/.test(decoded.slice(run[k - 1]!.end, x.at)));
      if (!joined) break;
      const phrase = decoded.slice(run[0]!.at, run[n - 1]!.end);
      if (multi.has(nameHash(phrase))) hits.push({ line: lineOf(w.at), text: phrase });
    }
  }
  return hits;
}

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) await walk(p, out);
    else out.push(p);
  }
  return out;
}

/** The demo seed's files: every fixture, the seed modules, and the name generator itself. */
export async function demoSeedFiles(cwd: string): Promise<string[]> {
  const lib = (await readdir(join(cwd, 'lib'))).filter((f) => /^seed.*\.ts$/.test(f) || f === 'demo-names.ts').map((f) => join(cwd, 'lib', f));
  return [...(await walk(join(cwd, 'fixtures'))), ...lib];
}

/** One violation per name found in the demo seed, as "file:line: text". */
export async function demoRealNameViolations(cwd: string, hashes: NameHashes = DEMO_REAL_NAME_HASHES): Promise<string[]> {
  const users = JSON.parse(await readFile(join(cwd, 'fixtures', 'users.json'), 'utf8')) as Array<{ handle: string }>;
  const handles = new Set(users.map((u) => u.handle));
  const out: string[] = [];
  for (const file of await demoSeedFiles(cwd)) {
    const text = await readFile(file, 'utf8');
    for (const hit of findHashedNames(text, hashes, handles)) {
      out.push(`${relative(cwd, file)}:${hit.line}: "${hit.text}" is a name the demo seed must not carry — draw one from lib/demo-names.ts`);
    }
  }
  return out;
}
