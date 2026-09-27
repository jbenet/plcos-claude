import type { ProspectResult } from '@/lib/enrich/prospects';

export type ProspectPrecedenceReport = Pick<ProspectResult, 'perFile' | 'losers'> & { lost: number };

/** Shared by the immediate receipt and the background import receipt. */
export function ProspectPrecedence({ report }: { report: ProspectPrecedenceReport }) {
  return <div style={{ overflowWrap: 'anywhere' }}>
    <p><b>{report.lost} rows lost precedence</b>. Winners below are selected input rows;
      person-set statuses are still kept. Only valid rows with resolved identities compete;
      a winner may still be skipped if its pursuits are ambiguous.</p>
    {report.perFile.length > 0 && <ul>{report.perFile.map(file => <li key={file.file}>
      <code>{file.file}</code> · {file.won} won · {file.lost} lost
    </li>)}</ul>}
    {report.lost > 0 && <>
      <p>Superseded rows (showing {Math.min(report.losers.length, 5)} of {report.lost}):</p>
      <ul>{report.losers.slice(0, 5).map((row, i) => <li key={i}>
        <code>{row.file}</code>, line {row.line} · {row.name} ({row.vehicle}) · {row.status}
        {' → '}<code>{row.winner.file}</code>, line {row.winner.line} · {row.winner.status}. {row.reason}
      </li>)}</ul>
    </>}
  </div>;
}
