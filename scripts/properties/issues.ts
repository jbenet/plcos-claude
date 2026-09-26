import type { Check } from './harness';

export async function issueProperties(check: Check) {
  // Triage writes `assignee:` and `branch:` into an issue's frontmatter (docs/COLLAB.md), and the
  // issues page rewrites the whole file when a status changes. The rewrite keeps what it does not
  // manage, and turns the old singular `screenshot:` into `screenshots:` without keeping both.
  {
    const { parseIssue, serializeIssue } = await import('../../lib/issues/format');
    const filed = [
      '---', 'id: "0999"', 'title: A made-up issue', 'status: open          # open | triaged',
      'kind: bug', 'priority: P2', 'reporter: juan', 'page: /today', 'created: 2026-09-25T00:00:00Z',
      'labels: []', 'screenshot: attachments/0999-screenshot.png',
      'assignee: chatgpt', 'branch: codex/0999-made-up', 'fixed_in: N99', '---', '', 'Something broke.', '',
    ].join('\n');
    const once = serializeIssue({ ...parseIssue(filed, '0999'), status: 'agent-ready' });
    const twice = serializeIssue(parseIssue(once, '0999'));
    const keys = once.split('\n').map((l) => /^([a-z_]+):/.exec(l)?.[1]).filter(Boolean);
    const count = (k: string) => keys.filter((x) => x === k).length;
    check(
      'Changing an issue’s status keeps its assignee, branch and other unmanaged fields, once each, and a second rewrite changes nothing',
      count('assignee') === 1 && count('branch') === 1 && count('fixed_in') === 1 && count('screenshot') === 0 &&
        count('screenshots') === 1 && /^status: agent-ready /m.test(once) && twice === once,
      `fields after the rewrite: ${keys.join(', ')}; stable on a second rewrite: ${twice === once}`,
    );
  }
}
