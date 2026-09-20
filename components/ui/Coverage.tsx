export interface CoverageProps {
  corpus: string;
  from: string | null;
  to: string | null;
  /** Sources deliberately not inspected. Rendered, not logged. */
  notInspected: Array<{ source: string; why: string }>;
}

const list = (names: string[]): string =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/**
 * Rule 7. Every search surface states which corpus and date range were inspected, and
 * distinguishes "no supported result in the material available" from "none exists".
 */
export function Coverage({ corpus, from, to, notInspected }: CoverageProps) {
  return (
    <p className="cover">
      <b>What was searched:</b> {corpus}
      {from && to ? `, covering ${from} to ${to}` : ''}.
      {notInspected.length > 0 && (
        <>
          {' '}
          {list(notInspected.map((n) => n.source))}{' '}
          {notInspected.length === 1 ? 'was' : 'were'} not inspected — no connector is attached
          before L13.
        </>
      )}{' '}
      <b>
        An empty result here means nothing supported was found in the material available, not that
        nothing exists.
      </b>
    </p>
  );
}
