import { lstatSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { signInProviderOn } from './sign-in';

/**
 * Which ports this checkout's servers use (docs/COLLAB.md). `.ports.json` at the repo root is a
 * local dev setup for one machine, tracked so every checkout agrees on it: one row per folder, keyed
 * by the folder's name. Read here and nowhere else — by the launcher (scripts/serve.ts), the
 * screenshot script, and the server, which needs to know whether it is the live app and where the
 * live app is when it is not.
 *
 * A live row serves the real data (`real`) and a demo; it is the one folder whose data/real is the
 * real data. A dev row serves a demo and a preview — a copy of `previewSource` — and never the real
 * data itself. A folder with no row is a dev worktree too: a sub-agent's, started with PORT.
 */

export const PORTS_FILE = '.ports.json';

export type Role = 'live' | 'dev';
export type Serve = 'demo' | 'real' | 'preview';

export interface PortRow {
  role: Role;
  /** Live rows: the real server, the one process that opens the real database. */
  real?: number;
  demo: number;
  /** Dev rows: a copy of the real data (npm run preview). */
  preview?: number;
  /** Dev rows: the folder a preview copies, relative to the checkout or absolute. */
  previewSource?: string;
}

export interface Layout {
  /** The checkout's root, and its folder name: the key into the file. */
  root: string;
  folder: string;
  row: PortRow | null;
  role: Role;
  /** The live row: the row of the checkout that holds .git, which runs master. */
  live: PortRow | null;
}

const isPort = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0 && (v as number) < 65536;

/** The rows, checked. A malformed row is refused by name rather than read as something else. */
export function parseRows(text: string): Record<string, PortRow> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`${PORTS_FILE} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${PORTS_FILE} must be an object of rows, keyed by folder name.`);
  const rows: Record<string, PortRow> = {};
  for (const [folder, v] of Object.entries(raw as Record<string, unknown>)) {
    if (folder.startsWith('//')) continue; // a comment
    const r = v as Partial<PortRow> | null;
    const bad = (why: string) => new Error(`${PORTS_FILE}: the row for ${folder} ${why}.`);
    if (!r || typeof r !== 'object') throw bad('is not an object');
    if (!isPort(r.demo)) throw bad('needs a demo port');
    if (r.role === 'live') {
      if (!isPort(r.real)) throw bad('is live, so it needs a real port');
      if (r.preview !== undefined || r.previewSource !== undefined) throw bad('is live, so it serves the real data, not a preview');
    } else if (r.role === 'dev') {
      if (r.real !== undefined) throw bad('is a dev row, which never serves the real data: give it a preview port instead');
      if (!isPort(r.preview) || typeof r.previewSource !== 'string' || !r.previewSource) throw bad('is a dev row, so it needs a preview port and a previewSource');
    } else {
      throw bad('needs a role, "live" or "dev"');
    }
    rows[folder] = r as PortRow;
  }
  return rows;
}

/**
 * The checkout that holds .git: the live folder, on master. A linked worktree's .git is a file,
 * "gitdir: <main>/.git/worktrees/<name>", so the live folder is found from any worktree of it —
 * the dev ones beside it and a sub-agent's nested anywhere — with no git command and no network.
 */
export function mainCheckout(root: string): string | null {
  const dotGit = join(root, '.git');
  try {
    if (lstatSync(dotGit).isDirectory()) return resolve(root);
    const gitdir = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, 'utf8'))?.[1]?.trim();
    if (!gitdir) return null;
    const worktrees = dirname(resolve(root, gitdir));
    const common = dirname(worktrees);
    return basename(worktrees) === 'worktrees' && basename(common) === '.git' ? dirname(common) : null;
  } catch {
    return null;
  }
}

/** This checkout's row and the live row. Throws, naming the file, when the file is missing or malformed. */
export function readLayout(root: string = process.cwd()): Layout {
  let text: string;
  try {
    text = readFileSync(join(root, PORTS_FILE), 'utf8');
  } catch {
    throw new Error(`No ${PORTS_FILE} in ${root}. It says which ports each checkout's servers use (docs/COLLAB.md).`);
  }
  const rows = parseRows(text);
  const folder = basename(resolve(root));
  const row = rows[folder] ?? null;
  const main = mainCheckout(root);
  const live = main ? rows[basename(main)] : undefined;
  return { root: resolve(root), folder, row, role: row?.role ?? 'dev', live: live?.role === 'live' ? live : null };
}

/**
 * A deployed server with its own sign-in (LabOS, or Google on Railway; config/sign-in.ts) is the live
 * server for its data. Without one, the local checkout's role decides.
 */
export function isLiveServer(root: string = process.cwd(), env: Record<string, string | undefined> = process.env): boolean {
  if (signInProviderOn(env)) return true;
  try { return readLayout(root).role === 'live'; } catch { return false; }
}

/** The live row, or null when the file cannot say. Never throws. */
export function liveRow(root: string = process.cwd()): PortRow | null {
  try {
    return readLayout(root).live;
  } catch {
    return null;
  }
}

/**
 * The port for one of this folder's servers. What a folder may serve comes from its row: the real
 * data only from a live row, a preview only from a dev row. PORT changes the number, never that.
 */
export function portFor(serve: Serve, layout: Layout, env: Record<string, string | undefined> = process.env): number {
  const { row, folder } = layout;
  const noRow = `${folder} has no row in ${PORTS_FILE}`;
  if (serve === 'real' && !row?.real) {
    throw new Error(row ? 'This folder serves a copy: use npm run preview.' : `${noRow}. The real data is served only from the live folder's row; a dev worktree serves a copy with npm run preview.`);
  }
  if (serve === 'preview' && !row?.preview) {
    throw new Error(row ? 'npm run preview runs in a dev worktree. This folder is live: it serves the real data with npm run dev:real.' : `${noRow}, so it has no preview port or previewSource. Add a dev row for it.`);
  }
  const override = env.PORT?.trim();
  if (override) {
    const n = Number(override);
    if (!isPort(n)) throw new Error(`PORT must be a port number, not "${override}".`);
    return n;
  }
  if (!row) throw new Error(`${noRow}, and PORT is not set. Add a row for this folder to ${PORTS_FILE}, or start it with PORT=<port> (docs/COLLAB.md).`);
  return row[serve]!;
}

/**
 * Whether this server files feedback, and where the live app is when it does not. Issue numbers
 * are taken in filing order, so two branches filing would take the same ones: only a live row
 * files (docs/COLLAB.md). Never throws — a page renders whatever the file says, and a file that
 * cannot be read files nothing.
 */
export function feedbackHome(profile: 'demo' | 'real', root: string = process.cwd()): { filesHere: boolean; livePort: number | null } {
  if (signInProviderOn()) return { filesHere: true, livePort: null };
  try {
    const layout = readLayout(root);
    return { filesHere: isLiveServer(root), livePort: (profile === 'real' ? layout.live?.real : layout.live?.demo) ?? null };
  } catch {
    return { filesHere: false, livePort: null };
  }
}
