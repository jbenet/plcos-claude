'use client';

export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const busy = error.digest === 'CAPITAL_OS_DB_BUSY' || error.message.includes('The server is busy');
  return <main role="alert" style={{ padding: 32 }}>
    <h1>{busy ? 'The server is busy, try again.' : 'This page could not load.'}</h1>
    <p>{busy ? 'This request waited too long for the database and was dropped before it started.' : 'The request did not finish. You can try loading the page again.'}</p>
    <button type="button" className="btn" onClick={reset}>Try again</button>
  </main>;
}
