import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Page } from '@/components/shell/Page';
import { findModule, findPlaybook, sectionOf, PLAYBOOK_ONLY } from '@/lib/nav';

export const dynamic = 'force-dynamic';

export default async function ModulePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const mod = findModule(slug);
  const playbook = findPlaybook(slug);
  if (!mod && !playbook) notFound();

  if (playbook) {
    return (
      <Page
        crumbs={[{ label: 'Modules' }, { label: playbook.title }]}
        inspector={
          <>
            <div className="lbl">Module {playbook.num}</div>
            <div className="ihead">A capability, not a screen</div>
            <div className="imeta">And that is the design, not a gap</div>
            <div className="scope">
              <div className="lbl">The rule</div>
              <p>
                A module may begin as a playbook plus an output format. A dedicated screen is a
                later optimization rather than the prerequisite for offering the capability.
                Twenty-four screens is a lot of surface to ship before anything is proven.
              </p>
            </div>
            <div className="note">
              It earns a screen when a workflow demonstrably needs one. Two already have:
              module 13 became the coverage-gap backlog, and module 17 became the answer library,
              because in both cases there was something that needed somewhere to live.
            </div>
          </>
        }
      >
        <div className="lbl">Module {playbook.num}</div>
        <h1>{playbook.title}</h1>
        <p className="sublede">{playbook.why}</p>

        <div className="card">
          <div className="chead">
            <h2>Where the output already appears</h2>
          </div>
          <div className="cbody">
            <p style={{ fontSize: 13.5, lineHeight: 1.6 }}>{playbook.where}</p>
          </div>
        </div>

        <div className="card">
          <div className="chead">
            <h2>The other capabilities without screens</h2>
          </div>
          {PLAYBOOK_ONLY.filter((p) => p.slug !== slug).map((p) => (
            <Link className="row" key={p.num} href={`/m/${p.slug}`}>
              <span className="kind k-chore" style={{ width: 34 }}>
                {p.num}
              </span>
              <div className="t">
                <b>{p.title}</b>
                <span>{p.why}</span>
              </div>
            </Link>
          ))}
        </div>
      </Page>
    );
  }

  const section = sectionOf(slug);
  return (
    <Page
      crumbs={[{ label: section?.title ?? 'Modules' }, { label: mod!.title }]}
      inspector={
        <>
          <div className="lbl">Module {mod!.num}</div>
          <div className="ihead">{mod!.title}</div>
          <div className="imeta">
            {section?.title} · {section?.range}
          </div>
          <div className="kv">
            <span>Lands at</span>
            <span>{mod!.stage}</span>
          </div>
          <div className="kv">
            <span>Status</span>
            <span>Not built</span>
          </div>
        </>
      }
    >
      <div className="lbl">
        {section?.title} · module {mod!.num}
      </div>
      <h1>{mod!.title}</h1>
      <p className="sublede">{mod!.mechanic}</p>

      <div className="empty">
        <span className="stat unavailable">
          <i />
          Not built yet
        </span>
        <h3>This screen lands at {mod!.stage}.</h3>
        <p>
          Nothing has been stubbed behind it: no placeholder data, no half-working table, no mock
          chart. An empty room is easier to reason about than a furnished one where none of the
          furniture takes weight.
        </p>
        <dl>
          <dt>What is known</dt>
          <dd>The mechanic above, and the stage it is scheduled for.</dd>
          <dt>Who can act</dt>
          <dd>Whoever is building.</dd>
          <dt>Safe next step</dt>
          <dd>File what you expected to see here through the feedback box.</dd>
        </dl>
      </div>
    </Page>
  );
}
