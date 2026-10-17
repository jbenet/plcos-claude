import Link from '@/components/ui/AppLink';
import { pipelineData } from '@/lib/authz/read/pipeline';
import { LpUnitChoice } from './LpUnitChoice';
import { LpUnitPicker } from './LpUnitPicker';
import u from './lp-units.module.css';

/**
 * A person's LP page (issues 0111, 0112; docs/23): this pursuit is them as an individual LP. Their
 * firms are context, each linked to its own LP row in this vehicle when it has one. The mark after
 * "Individual LP" settles who the LP is in place (17 Oct 2026), as the People tab's card does; not on
 * a vehicle kept for its history, which stays as it was recorded.
 */
export async function LpUnitLine({ pursuitId, vehicleId, capacity, review, historical }: {
  pursuitId: string; personId: string; vehicleId: string; capacity: 'organisation' | 'personal' | null; review: string | null; historical: boolean;
}) {
  const row = (await pipelineData(vehicleId)).rows.find((r) => r.id === pursuitId);
  const firms = row?.firms ?? [];
  const settled = capacity === 'personal' && !review;
  // Something to choose: keeping the row (unless that is already settled), or a firm to move it to.
  const choosable = !historical && (!settled || firms.length > 0);
  return (
    <>
      {choosable ? (
        <>
          <span>Individual LP</span>
          <LpUnitPicker pursuitId={pursuitId} capacity={capacity} review={review}
            firms={firms.map((f) => ({ id: f.id, name: f.name, role: f.role, lpRow: f.lpRow }))} />
        </>
      ) : <LpUnitTags capacity={capacity} review={review} historical={historical} />}
      {firms.length > 0 && <span className="muted"> · </span>}
      {firms.map((f, i) => (
        <span key={f.id}>
          {i > 0 && <span className="muted"> · </span>}
          {f.role && <span className="muted">{f.role}, </span>}
          {f.lpRow ? <Link href={`/targets/${f.lpRow}`}>{f.name}</Link> : <Link href={`/orgs/${f.id}`}>{f.name}</Link>}
          {f.lpRow && <span className="muted"> (LP here)</span>}
        </span>
      ))}
    </>
  );
}

/**
 * The line's own words, which need no pipeline: also what shows while the firms load (an LP page's
 * Suspense fallback), the same mark as the picker's, not yet a control.
 */
export function LpUnitTags({ capacity, review, historical = false }: {
  capacity: 'organisation' | 'personal' | null; review: string | null; historical?: boolean;
}) {
  return (
    <>
      <span>Individual LP</span>
      {review ? <span className={`${u.tag} ${u.review}`} title={review}>firm or personal?</span>
        : capacity === 'personal' ? <span className={`${u.tag} ${u.personal}`}>personal</span>
        : historical ? null : <span className={u.tag} title="Who is the LP? Not established yet">firm or personal?</span>}
    </>
  );
}

/**
 * Who is the LP? On a person's page: what the record says, and a person's way to settle it — they
 * invest here in their own capacity, or the pursuit is one of their firms' and they are its contact.
 */
export async function LpUnitCard({ pursuitId, personName, vehicleId, capacity, review, historical }: {
  pursuitId: string; personId: string; personName: string; vehicleId: string;
  capacity: 'organisation' | 'personal' | null; review: string | null; historical: boolean;
}) {
  const row = (await pipelineData(vehicleId)).rows.find((r) => r.id === pursuitId);
  const firms = row?.firms ?? [];
  return (
    <div className="card">
      <div className="chead">
        <h2>Who is the LP?</h2>
        <span className="lbl">{review ? 'to review' : capacity === 'personal' ? 'individual · personal' : 'individual'}</span>
      </div>
      <div className="cbody" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
        <p style={{ margin: '0 0 8px' }}>
          {review ? <>The re-point rule could not tell: {review}</>
            : capacity === 'personal' ? <>{personName}, in their own capacity: there is evidence on file that they invest personally.</>
            : <>{personName}, as an individual. Whether they invest personally is not established yet.</>}
        </p>
        {firms.length > 0 && <p className="muted" style={{ margin: '0 0 8px' }}>
          A person at a firm is not the LP: if this pursuit is really {firms.length === 1 ? `${firms[0]!.name}’s` : 'one of their firms’'}, move it there
          and {personName} stays on it as a contact. Someone who invests both ways keeps this row and is named on the firm’s.
        </p>}
        {historical ? <p className="muted" style={{ margin: 0 }}>A vehicle kept for its history: left as it was recorded.</p>
          : <LpUnitChoice pursuitId={pursuitId} personal={capacity === 'personal' && !review}
              firms={firms.map((f) => ({ id: f.id, name: f.name, role: f.role, lpRow: f.lpRow }))} />}
      </div>
    </div>
  );
}
