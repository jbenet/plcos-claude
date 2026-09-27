import { execFile } from 'node:child_process';

/**
 * The repository's own history, read on the server (issue 0101: "treat our dev as part of the
 * system"). A small reader of `git log` in this checkout: no network, no fetch, no write, a fixed
 * argument list with no shell, a timeout and a bounded buffer. Failure is reported, never thrown, so
 * a page that shows history still renders when git is missing.
 */

export interface Commit {
  hash: string;
  short: string;
  parents: string[];
  author: string;
  at: Date;
  subject: string;
  /** Body without trailers such as Co-Authored-By. */
  body: string;
  merge: boolean;
  /** The branch a merge brought in, from its subject: "Merge codex/orgs-0094" → codex/orgs-0094. */
  branch: string | null;
  /** Issue numbers named in the subject, body or merged branch: "(issues 0091–0093)" → 0091, 0092, 0093. */
  issues: string[];
}

export interface GitLog { commits: Commit[]; ref: string | null; error: string | null }

const FS = '\x1f';
const RS = '\x1e';
const FORMAT = ['%H', '%P', '%an', '%aI', '%s', '%b'].join('%x1f') + '%x1e';

function run(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, {
      cwd: process.cwd(), timeout: 5000, maxBuffer: 16 * 1024 * 1024,
      // Read-only and quiet: never take an index lock, never prompt.
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' },
    }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

/** Issue numbers in a text: four digits starting with 0, and ranges with a dash between two. */
export function issuesIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?<![\w.:])(0\d{3})(?:\s*[–-]\s*(0\d{3}))?(?![\w.:])/g)) {
    const from = Number(m[1]), to = m[2] ? Number(m[2]) : from;
    if (to >= from && to - from <= 12) for (let n = from; n <= to; n += 1) out.add(String(n).padStart(4, '0'));
    else out.add(m[1]!);
    if (out.size >= 16) break;
  }
  return [...out];
}

export function parseLog(text: string): Commit[] {
  return text.split(RS).map((r) => r.replace(/^\n/, '')).filter(Boolean).map((record) => {
    const [hash = '', parents = '', author = '', at = '', subject = '', body = ''] = record.split(FS);
    const cleanBody = body.split('\n').filter((l) => !/^[A-Za-z-]+-by:|^Ready-for-review:/i.test(l.trim())).join('\n').trim();
    const ps = parents.split(' ').filter(Boolean);
    // A branch only when the subject says so unambiguously: quoted, or a name with a slash or dash.
    const named = ps.length > 1 ? /^Merge (?:branch |remote-tracking branch )?(?:'([^']+)'|([\w.]+[/-][\w./-]+))/.exec(subject) : null;
    const branch = named ? named[1] ?? named[2] ?? null : null;
    return {
      hash, short: hash.slice(0, 7), parents: ps, author, at: new Date(at), subject, body: cleanBody,
      merge: ps.length > 1, branch, issues: issuesIn(`${subject}\n${cleanBody}\n${branch ?? ''}`),
    };
  }).filter((c) => c.hash && Number.isFinite(c.at.getTime()));
}

/**
 * Master's history, newest first: `firstParent` gives the development cycle as master saw it —
 * each merge once, each direct commit once. Falls back to HEAD where there is no master.
 */
export async function gitLog(opts: { limit: number; firstParent?: boolean; paths?: string[]; before?: Date | null }): Promise<GitLog> {
  const limit = Math.max(1, Math.min(500, Math.floor(opts.limit)));
  const tail = [
    `-n${limit}`, ...(opts.firstParent ? ['--first-parent'] : []),
    ...(opts.before ? [`--before=${opts.before.toISOString()}`] : []),
    `--format=${FORMAT}`, '--no-color', '--',
    ...(opts.paths ?? []).filter((p) => /^[\w./-]+$/.test(p) && !p.includes('..')),
  ];
  let lastError = 'git is not available here';
  for (const ref of ['master', 'HEAD']) {
    try {
      return { commits: parseLog(await run(['log', ref, ...tail])), ref, error: null };
    } catch (e) {
      lastError = e instanceof Error ? e.message.split('\n')[0]! : String(e);
    }
  }
  return { commits: [], ref: null, error: lastError };
}
