import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseIssue, serializeIssue, slugify, type ParsedIssue } from './format';
import type { Issue, IssueDraft, IssueFilter, IssueSink } from './index';

const FILE = /^(\d{4})-([a-z0-9-]+)\.md$/;

/** Attachments sit beside the issues so `git log issues/` still shows the whole thing. */
const ATTACH = 'attachments';

const EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
};

/**
 * Issues are files in the repo. The complaint and its fix travel in one pull request,
 * they survive `npm run db:reset`, and `git log issues/` is free triage history.
 */
export function fileIssueSink(dir: string): IssueSink {
  const root = join(process.cwd(), dir);

  const read = async (): Promise<Array<{ file: string; issue: ParsedIssue }>> => {
    let names: string[];
    try {
      names = await readdir(root);
    } catch {
      return [];
    }
    const out: Array<{ file: string; issue: ParsedIssue }> = [];
    for (const name of names.sort()) {
      const m = FILE.exec(name);
      if (!m) continue;
      const text = await readFile(join(root, name), 'utf8');
      out.push({ file: name, issue: parseIssue(text, m[1]!) });
    }
    return out;
  };

  const toIssue = (file: string, p: ParsedIssue): Issue => ({
    id: p.id, title: p.title, status: p.status, kind: p.kind, priority: p.priority,
    reporter: p.reporter, page: p.page, labels: p.labels, body: p.body,
    context: p.context, created: p.created, location: `${dir}/${file}`,
    screenshot: p.screenshot, attachments: p.attachments,
  });

  const find = async (id: string) => (await read()).find((r) => r.issue.id === id) ?? null;

  return {
    kind: 'file',
    destination: `${dir}/NNNN-slug.md in this repository`,

    async create(draft: IssueDraft): Promise<Issue> {
      const existing = await read();
      const next = String(
        existing.reduce((max, r) => Math.max(max, Number(r.issue.id) || 0), 0) + 1,
      ).padStart(4, '0');
      const file = `${next}-${slugify(draft.title)}.md`;

      /**
       * The sink owns every filename. A caller that could choose one could write anywhere,
       * so the body refers to images as `attachment:N` and those tokens are rewritten here
       * once the files have names.
       */
      const incoming = draft.attachments ?? [];
      const paths: string[] = [];
      let screenshot: string | null = null;
      if (incoming.length > 0) await mkdir(join(root, ATTACH), { recursive: true });
      // Images are numbered among images, so `0008-image-1.png` is the first one somebody
      // dropped rather than its index in an array they never see.
      let imageNo = 0;
      for (const a of incoming) {
        const name = a.kind === 'screenshot'
          ? `${next}-screenshot.${EXT[a.contentType]}`
          : `${next}-image-${(imageNo += 1)}.${EXT[a.contentType]}`;
        await writeFile(join(root, ATTACH, name), Buffer.from(a.base64, 'base64'));
        const rel = `${ATTACH}/${name}`;
        paths.push(rel);
        if (a.kind === 'screenshot' && !screenshot) screenshot = rel;
      }

      const offset = draft.tokenOffset ?? 0;
      const body = draft.body.replace(
        /\(attachment:(\d+)\)/g,
        (whole, n: string) => {
          const hit = paths[Number(n) - 1 + offset];
          return hit ? `(${hit})` : whole;
        },
      );

      const { attachments: _drop, tokenOffset: _offset, ...rest } = draft;
      const parsed: ParsedIssue = {
        ...rest,
        body,
        screenshot,
        attachments: paths,
        id: next,
        status: 'open',
        created: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      };
      await writeFile(join(root, file), serializeIssue(parsed), 'utf8');
      return toIssue(file, parsed);
    },

    async list(filter?: IssueFilter): Promise<Issue[]> {
      const all = (await read()).map((r) => toIssue(r.file, r.issue));
      const keep = (i: Issue) =>
        (!filter?.status || filter.status.includes(i.status)) &&
        (!filter?.kind || filter.kind.includes(i.kind)) &&
        (!filter?.priority || filter.priority.includes(i.priority));
      return all.filter(keep).sort((a, b) => b.id.localeCompare(a.id));
    },

    async get(id: string): Promise<Issue | null> {
      const hit = await find(id);
      return hit ? toIssue(hit.file, hit.issue) : null;
    },

    async update(id, patch): Promise<Issue> {
      const hit = await find(id);
      if (!hit) throw new Error(`No such issue: ${id}`);
      const updated: ParsedIssue = { ...hit.issue, ...patch };
      await writeFile(join(root, hit.file), serializeIssue(updated), 'utf8');
      return toIssue(hit.file, updated);
    },
  };
}
