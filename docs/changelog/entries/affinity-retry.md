## Affinity — retry transient reads and preserve paused chunks

History and meetings reads retry network/timeouts, 5xx and 429 up to three times
with 5 s, 20 s and 60 s backoff (GUESS), honoring 429 Retry-After. Every attempt
counts against the chunk cap. Bulk email pages get a 60 s timeout (GUESS).
Exhausted retries and caps pause using the existing held state; continuing keeps
the unread page, filters, stream phase and original watermark. GET-only guards remain.

Verified with invented fake transports, TypeScript, boundaries and the property suite.
