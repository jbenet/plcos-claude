import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Page } from '@/components/shell/Page';
import { config } from '@/config/deployment';
import { Markdown } from '@/components/ui/Markdown';
import { SECTION } from '@/lib/nav';
import { changelogEntry } from '@/lib/changelog';
import { issues as issueSink, PRIORITY } from '@/lib/issues';
import { shortDate } from '@/lib/time';

export const dynamic = 'force-dynamic';

export default async function IssueDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sink = await issueSink();
  const issue = await sink.get(id);
  const fixedIn = issue?.fixedIn ? await changelogEntry(issue.fixedIn) : null;
  if (!issue) notFound();

  return (
    <Page
      crumbs={[
        { label: SECTION.developer },
        { label: 'Issues', href: '/issues' },
        { label: `${issue.id} · ${issue.title}` },
      ]}
      inspector={
        <>
          <div className="lbl">Issue {issue.id}</div>
          <div className="ihead">{issue.title}</div>
          <div className="imeta">
            {issue.reporter} · {issue.created ? shortDate(new Date(issue.created)) : 'undated'}
          </div>
          <div className="kv">
            <span>Status</span>
            <span>{issue.status}</span>
          </div>
          <div className="kv">
            <span>Kind</span>
            <span>{issue.kind}</span>
          </div>
          <div className="kv">
            <span>Priority</span>
            <span>{issue.priority}</span>
          </div>
          <div className="kv">
            <span>Page</span>
            <span className="mono" style={{ fontSize: 11 }}>
              {issue.page || '—'}
            </span>
          </div>
          <div className="kv">
            <span>File</span>
            <span className="mono" style={{ fontSize: 11 }}>
              {issue.location}
            </span>
          </div>
          {issue.fixedIn && (
            <div className="scope">
              <div className="lbl">Fixed in {issue.fixedIn}</div>
              <p>
                {fixedIn
                  ? <><b>{fixedIn.title}.</b>{' '}
                      <Link href={`/dev/changelog#${fixedIn.id}`}>Read what changed →</Link></>
                  : <>Recorded against {issue.fixedIn}, which is not in the changelog. One of the
                      two is wrong and the file is the one to trust.</>}
              </p>
            </div>
          )}
          <div className="scope">
            <div className="lbl">Priority · {issue.priority}</div>
            <p>
              <b>{PRIORITY[issue.priority].means}.</b> {PRIORITY[issue.priority].detail} No date
              is promised against it — how fast the queue moves is a fact about the queue.
            </p>
          </div>
          <div className="note" style={{ marginTop: 0 }}>
            Status is edited in the file, not here. A write path lands with the triage view; until
            then the editor and <code>git</code> are the interface, which is the point of keeping
            issues as files.
          </div>
        </>
      }
    >
      <div className="lbl">
        <Link href="/issues">← All issues</Link>
      </div>
      <h1 style={{ marginTop: 8 }}>{issue.title}</h1>
      <p className="sublede">
        <span className={`kind k-${issue.kind}`}>{issue.kind}</span>{' '}
        <span className="flag f-mute">{issue.priority}</span>{' '}
        <span className="flag f-mute">{issue.status}</span>
      </p>

      <div className="card">
        <div className="chead">
          <h2>What happened</h2>
        </div>
        <div className="cbody">
          {/* Rendered with the same component the feedback box previews with, so what the
              reporter saw before filing is what the issue shows afterwards. */}
          <Markdown
            source={issue.body}
            resolveImage={(href) =>
              href.startsWith('attachments/') ? `/issues/shot/${href}` : href}
          />
        </div>
      </div>

      {issue.screenshots.length > 0 && (
        <div className="card">
          <div className="chead">
            <h2>The page as it looked</h2>
            <span className="lbl">
              {issue.screenshots.length} screenshot{issue.screenshots.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="cbody">
            {issue.screenshots.map((shot, i) => (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                key={shot}
                className="issueshot"
                src={`/issues/shot/${shot}`}
                alt={`Screenshot ${i + 1} filed with issue ${issue.id}`}
              />
            ))}
          </div>
          <p className="cover">
            <b>Captured in the reporter&rsquo;s browser when they pressed the button</b>, before
            the feedback drawer covered anything, and annotated by them.{' '}
            {config.data.profile === 'real'
              ? 'It is a PNG beside the issue in data/real/issues/, with the real data it may show, and is never committed.'
              : 'It is a PNG beside the issue in this repository — so the complaint, the picture and the fix all travel in one pull request, and none of it depends on a service being up.'}
          </p>
        </div>
      )}

      {issue.context && (
        <div className="card">
          <div className="chead">
            <h2>Context at the moment it was filed</h2>
            <span className="lbl">captured, not reconstructed</span>
          </div>
          <div className="cbody">
            <pre className="block">{JSON.stringify(issue.context, null, 2)}</pre>
          </div>
        </div>
      )}
    </Page>
  );
}
