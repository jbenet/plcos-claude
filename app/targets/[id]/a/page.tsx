import Link from '@/components/ui/AppLink';
import { coalescePage } from '@/lib/page-render';
import { Page } from '@/components/shell/Page';
import { OutreachContext } from '@/components/outreach/OutreachContext';
import { PublicProfile } from '@/components/entity/PublicProfile';
import { DakotaClaims } from '@/components/entity/DakotaClaims';
import { VehicleInvestments } from '@/components/entity/VehicleInvestments';
import { SpvCard } from '@/components/strategy/SpvCard';
import { OrgPeople } from '@/components/strategy/LpSideCards';
import { LpUnitCard } from '@/components/strategy/LpUnit';
import { loadLp } from '../_lp/lp-data';
import { AcceptNext, Compose, DesignBar, Facts, Feed, Head, Plan, Routes, Strategies } from '../_lp/parts';
import s from '../_lp/lp.module.css';

export const dynamic = 'force-dynamic';

/**
 * Design A, brief and tabs (11 Oct 2026, docs/strategy/lp-pages.md): the four answers on top, and each kind of
 * detail on its own tab, one address each. A trial beside the current page; it reads the same records.
 */
const TABS = ['activity', 'strategy', 'email', 'research', 'routes', 'people'] as const;
type Tab = typeof TABS[number];
const TAB_LABEL: Record<Tab, string> = { activity: 'Activity', strategy: 'Strategy', email: 'Email', research: 'Research', routes: 'Routes', people: 'People' };

async function DesignA({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const tab: Tab = (TABS as readonly string[]).includes((await searchParams).tab ?? '') ? (await searchParams).tab as Tab : 'activity';
  const d = await loadLp(id);
  const p = d.pursuit;
  const base = `/targets/${p.pursuitId}/a`;
  const count: Partial<Record<Tab, number>> = { activity: d.feed.length, strategy: (d.strategy ? 1 : 0) + d.strategyOthers.length, routes: d.routeList.length };
  const isPerson = d.entity?.entityType === 'person';

  return (
    <Page crumbs={[{ label: p.vehicleName, href: '/overview' }, { label: 'Pipeline', href: `/targets?status=${p.status}` }, { label: p.entityName }]}>
      <DesignBar id={p.pursuitId} current="a" />
      <Head d={d} />
      <section className={`card ${s.brief}`}>
        <Plan d={d} />
        <div className={s.acts}>
          <Link className="btn p" href={`${base}?tab=email`}>{d.owes?.by === 'us' ? 'Draft reply' : 'Draft email'}</Link>
          <Link className="btn" href={`/targets/${p.pursuitId}#timeline`}>Log update</Link>
          <AcceptNext d={d} />
        </div>
      </section>

      <nav className={s.tabs} aria-label="LP detail">
        {TABS.map((t) => (
          <Link key={t} href={`${base}?tab=${t}`} aria-current={t === tab ? 'page' : undefined}>
            {TAB_LABEL[t]}{count[t] ? <small>{count[t]}</small> : null}
          </Link>
        ))}
      </nav>

      {tab === 'activity' && (
        <section className="card"><div className={s.pad}>
          <Feed d={d} limit={40} />
          <p className={s.m} style={{ fontSize: 12, margin: '10px 0 0' }}>Faded rows are about another vehicle or none. <Link href={`/targets/${p.pursuitId}#timeline`}>Full timeline with notes</Link></p>
        </div></section>
      )}
      {tab === 'strategy' && <Strategies d={d} />}
      {tab === 'email' && <>
        <OutreachContext entityId={p.entityId} vehicleId={p.vehicleId} pursuitId={p.pursuitId} />
        <Compose d={d} path={`${base}?tab=email`} />
      </>}
      {tab === 'research' && <>
        <section className="card"><div className="chead"><h2>On file</h2></div><div className={s.pad}><Facts d={d} limit={10} /></div></section>
        {d.vehicle && <VehicleInvestments entityId={p.entityId} vehicle={d.vehicle} />}
        <PublicProfile entityId={p.entityId} />
        <DakotaClaims entityId={p.entityId} />
      </>}
      {tab === 'routes' && <section className="card"><div className={s.pad}><Routes d={d} limit={10} /></div></section>}
      {tab === 'people' && <>
        {isPerson
          ? <LpUnitCard pursuitId={p.pursuitId} personId={p.entityId} personName={p.entityName} vehicleId={p.vehicleId} capacity={p.lpCapacity} review={p.lpReview} historical={p.historical} />
          : <OrgPeople orgId={p.entityId} orgName={p.entityName} vehicleId={p.vehicleId} currentPursuitId={p.pursuitId} />}
        <SpvCard entityId={p.entityId} entityName={p.entityName} spvVehicle={d.kind === 'spv'} />
      </>}
    </Page>
  );
}

export default coalescePage('/targets/[id]/a', DesignA);
