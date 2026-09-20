import Link from 'next/link';
import { Page } from '@/components/shell/Page';
import { PLAYBOOK_ONLY, VEHICLE_MODULES } from '@/lib/nav';
import { MODULES } from '@/modules/manifest';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Modules that exist in the plan but not as a vehicle-scoped screen. */
const CROSS_CUTTING = [
  { num: '01', title: 'Research & enrichment', href: '/research', note: 'The universe and what we can support about it.' },
  { num: '13', title: 'Content calendar', href: '/library', note: 'The coverage-gap backlog, generated from questions actually asked.' },
  { num: '14', title: 'Content studio', href: '/content', note: 'Canonical asset plus audience variants.' },
  { num: '15', title: 'Content performance', href: '/performance', note: 'Honest about what cannot be measured.' },
  { num: '17', title: 'Evidence & answer library', href: '/library', note: 'Approved answers with their own versioning.' },
  { num: '21', title: 'Forecast', href: '/forecast', note: 'Hard-only headline and the conserved capital pool.' },
  { num: '22', title: 'Sprint calendar', href: '/calendar', note: 'Holiday overlay and the December dead zone.' },
];

export default async function Modules() {
  const db = await getDb();
  const counts = await db.query<{ schema: string; tables: string }>(
    `select table_schema as schema, count(*)::text as tables
       from information_schema.tables
      where table_type = 'BASE TABLE'
        and table_schema not in ('pg_catalog','information_schema')
      group by table_schema order by table_schema`,
  );
  const tablesFor = (schema: string) => counts.find((c) => c.schema === schema)?.tables ?? '0';

  return (
    <Page
      crumbs={[{ label: 'Developer' }, { label: 'Modules' }]}
      inspector={
        <>
          <div className="lbl">Module registry</div>
          <div className="ihead">{MODULES.length} schemas</div>
          <div className="imeta">One Postgres schema per module, migrated in this order</div>
          {MODULES.map((m) => (
            <div className="kv" key={m.name}>
              <span className="mono" style={{ fontSize: 11.5 }}>{m.schema}</span>
              <span>{tablesFor(m.schema)} tables</span>
            </div>
          ))}
          <div className="scope">
            <div className="lbl">Not a plugin framework</div>
            <p>
              An ordered list in <code>modules/manifest.ts</code>. Migrations run in this order
              because cross-schema references have to already exist. Adding a module is adding a
              row to the list.
            </p>
          </div>
          <div className="note">
            Cross-module joins are meant to fail rather than be frowned upon.{' '}
            <code>npm run boundaries</code> checks that modules are imported through their
            index.ts.
          </div>
        </>
      }
    >
      <div className="lbl">Developer</div>
      <h1>Modules</h1>
      <p className="sublede">
        Twenty-four in the plan. Thirteen are vehicle-scoped screens, seven read across vehicles,
        four are a capability with no screen — and every one of them says which it is.
      </p>

      <div className="card">
        <div className="chead">
          <h2>Vehicle-scoped</h2>
          <span className="lbl">{VEHICLE_MODULES.length} · shown in the rail under a vehicle</span>
        </div>
        {VEHICLE_MODULES.map((m) => (
          <Link className="row" key={m.slug} href={m.href}>
            <span className="kind k-chore" style={{ width: 34 }}>{m.num}</span>
            <div className="t">
              <b>{m.title}</b>
              <span>{m.mechanic}</span>
            </div>
            <div className="state" style={{ width: 120 }}>
              <b>{m.stage}</b>
              {m.kinds ? m.kinds.join(', ') : 'all vehicles'}
            </div>
          </Link>
        ))}
      </div>

      <div className="card">
        <div className="chead">
          <h2>Cross-cutting</h2>
          <span className="lbl">{CROSS_CUTTING.length} · not scoped to one vehicle</span>
        </div>
        {CROSS_CUTTING.map((m) => (
          <Link className="row" key={m.num + m.title} href={m.href}>
            <span className="kind k-chore" style={{ width: 34 }}>{m.num}</span>
            <div className="t">
              <b>{m.title}</b>
              <span>{m.note}</span>
            </div>
          </Link>
        ))}
      </div>

      <div className="card">
        <div className="chead">
          <h2>Capability without a screen</h2>
          <span className="lbl">{PLAYBOOK_ONLY.length} · by design</span>
        </div>
        {PLAYBOOK_ONLY.map((p) => (
          <Link className="row" key={p.num} href={`/m/${p.slug}`}>
            <span className="kind k-chore" style={{ width: 34 }}>{p.num}</span>
            <div className="t">
              <b>{p.title}</b>
              <span>{p.why}</span>
            </div>
            <div className="state" style={{ width: 110 }}>
              <b>No screen</b>
              by design
            </div>
          </Link>
        ))}
        <p className="cover">
          A module may begin as a playbook plus an output format. Two have since earned screens —
          the coverage-gap backlog and the answer library — because in both cases there was
          something that needed somewhere to live.
        </p>
      </div>
    </Page>
  );
}
