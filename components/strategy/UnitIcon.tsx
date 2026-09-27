import u from './lp-units.module.css';

/**
 * The LP unit's type, on every row of the LP tables (issue 0113): a building for an organisation,
 * a person for an individual. Small and quiet; the label is read out, and a title says it on hover.
 */
export function UnitIcon({ org, size = 13 }: { org: boolean; size?: number }) {
  const label = org ? 'Firm' : 'Individual';
  return (
    <span className={u.unit} data-unit={org ? 'firm' : 'individual'} title={org ? 'Firm: an organisation that commits as one' : 'Individual: a person in their own capacity'}>
      <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {org
          ? <><path d="M3 14V3.2c0-.4.3-.7.7-.7h5.6c.4 0 .7.3.7.7V14" /><path d="M10 7h2.3c.4 0 .7.3.7.7V14" /><path d="M1.8 14h12.4" /><path d="M5.3 5.2h1.4M5.3 7.8h1.4M5.3 10.4h1.4" /><path d="M11.3 9.6v.1M11.3 11.8v.1" /></>
          : <><circle cx="8" cy="5.3" r="2.6" /><path d="M3 14c0-2.9 2.2-4.9 5-4.9s5 2 5 4.9" /></>}
      </svg>
      <span className={u.srOnly}>{label}</span>
    </span>
  );
}
