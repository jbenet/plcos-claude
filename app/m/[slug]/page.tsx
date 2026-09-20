import { notFound } from 'next/navigation';
import { Page } from '@/components/shell/Page';
import { findModule, sectionOf, PLAYBOOK_ONLY } from '@/lib/nav';

export const dynamic = 'force-dynamic';

const TRIM_ORDER: Record<string, string> = {
  L10: 'First to be trimmed if time runs short — fixture-only work that gets redone once connectors exist.',
  L9: 'Second to be trimmed — a spreadsheet does this adequately for one person.',
  L13: 'Third — can drop to a stub.',
};

export default async function ModulePlaceholder({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const mod = findModule(slug);
  if (!mod) notFound();
  const section = sectionOf(slug);

  return (
    <Page
      crumbs={[{ label: section?.title ?? 'Modules' }, { label: mod.title }]}
      inspector={
        <>
          <div className="lbl">Module {mod.num}</div>
          <div className="ihead">{mod.title}</div>
          <div className="imeta">
            {section?.title} · {section?.range}
          </div>
          <div className="kv">
            <span>Lands at</span>
            <span>{mod.stage}</span>
          </div>
          <div className="kv">
            <span>Status</span>
            <span>Not built</span>
          </div>
          <div className="kv">
            <span>Route</span>
            <span className="mono" style={{ fontSize: 11 }}>
              {mod.href}
            </span>
          </div>
          {TRIM_ORDER[mod.stage] && (
            <div className="scope">
              <div className="lbl">If time gets short</div>
              <p>{TRIM_ORDER[mod.stage]}</p>
            </div>
          )}
          <div className="note">
            A module is a capability, not necessarily a screen. Six of the twenty-four start as a
            playbook against the shared workspace and earn a screen only when a workflow
            demonstrably needs one.
          </div>
        </>
      }
    >
      <div className="lbl">
        {section?.title} · module {mod.num}
      </div>
      <h1>{mod.title}</h1>
      <p className="sublede">{mod.mechanic}</p>

      <div className="empty">
        <span className="stat unavailable">
          <i />
          Not built yet
        </span>
        <h3>This screen lands at {mod.stage}.</h3>
        <p>
          Nothing has been stubbed behind it: there is no placeholder data, no half-working table
          and no mock chart. An empty room is easier to reason about than a furnished one where
          none of the furniture takes weight.
        </p>
        <dl>
          <dt>What is known</dt>
          <dd>The mechanic above, and the stage it is scheduled for.</dd>
          <dt>Who can act</dt>
          <dd>Whoever is building. The rail doubles as the build sequence.</dd>
          <dt>Safe next step</dt>
          <dd>File what you expected to see here through the feedback box — it becomes an issue file.</dd>
        </dl>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="chead">
          <h2>Modules that start without a screen</h2>
          <span className="lbl">capability first, screen later</span>
        </div>
        {PLAYBOOK_ONLY.map((p) => (
          <div className="row" key={p.num}>
            <span className="kind k-chore" style={{ width: 34 }}>
              {p.num}
            </span>
            <div className="t">
              <b>{p.title}</b>
              <span>{p.why}</span>
            </div>
          </div>
        ))}
      </div>
    </Page>
  );
}
