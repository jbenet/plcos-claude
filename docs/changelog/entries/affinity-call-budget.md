# Fewer Affinity requests a day · 8 Oct 2026

Juan, 8 Oct 2026, passing on PL's note: the plcos-claude key made about 900 Affinity requests a day, against a
shared limit of about 2,300 a day for everyone. "Could you bring it under 300 a day?"

- **The daily slice reads relationship strengths in rotation.** It used to read every person's relationships on
  every vehicle list once a day, one request per person; they move slowly and feed only the Affinity inventory
  page. Now a person never read before is read at once, and everyone else once every 90 days (first set at 30; the 8 Oct run read about 4,200 people, so 30 left about 240 requests a day), on the day their
  Affinity id falls on (`config.affinity.relationshipRefreshDays`, a guess). List entries, and so statuses, are
  still read in full every day.
- **`/api/health?affinity=1`** counts the Affinity requests this server sent per UTC day and endpoint template,
  for the last 14 days: counts only, no ids, paths or records. The plain health check is unchanged.

Checks: tsc, boundaries and the properties (a new one: new people at once, the rest on their day, everyone
within the cycle).
