import type { ResearchExportStatus } from '@/lib/enrich/export-status';

export function ExportStatus({ status }: { status: ResearchExportStatus | null }) {
  if (!status?.identityReviewError) return null;
  return <p role="alert" className="note" style={{ marginTop: 10 }}>
    Identity review {status.identityReviewError === 'timeout' ? 'timed out' : 'failed'} on {status.at}.
    {' '}The research set, candidates, team and triage files were written.
    {' '}Do not use identity-review.jsonl until you retry Export the research set successfully.
  </p>;
}
