# The page warm-up works behind Google sign-in · 5 Oct 2026

On the first Railway boot the warm-up (the page-speed fix: rebuild the shared page caches after a write, before
anyone clicks) logged "14 failed" and then warmed nothing: its loopback requests carried no session, so every page
answered with a redirect to /signin.

**Before setup** it now skips, says why in one line ("[warm] skipped: not set up yet"), and counts no failures. It
does the same with no sign-in client, with no active admin, and under LabOS.

**Once set up** it requests the pages as the oldest active admin, with a warm pass (`lib/auth/warm.ts`) rather than a
session:
- minted in the process just before a warm-up, signed under its own key, and revoked when the warm-up ends
  (5 minutes at most);
- accepted only for a loopback GET of the pages that warm-up listed;
- refused by the mutation guard and so by every server action and write route;
- never logged, written or sent anywhere but 127.0.0.1;
- reading it writes nothing.

On a demo started as a deployed server it logged "skipped: not set up yet", then after /setup "14 pages rebuilt in
2.6 s". The Mac's user switcher is unchanged.

**Nothing admin-shaped is cached for others.** A warm-up fills the `buildCache` memos, which are keyed by vehicle and
whose loaders never read the current user. Pages read those memos through the `lib/authz/read` facades, which redact
for each person after the cache. A render is shared only among requests with the same cookies and access.

Tests: 5 properties (`scripts/properties/warm-session.ts`). They cover the skip, admission through the Google
`currentUser` that pages call, every refusal, no writes, the cache keys, and the switcher. Invented data only.
