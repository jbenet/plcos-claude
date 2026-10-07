# Slow outreach calls say where their time went · 7 Oct 2026

JuanMail's mail desk sometimes waited more than 15 s for `GET /api/outreach/vehicles`, gave up, and showed its fallback
vehicles instead of PLC Neurotech I and PLC Crypto/Rails. The vehicles query itself is small, so the guess is a full
connection pool: the desk reads every vehicle's whole queue at the same moment, and the pool holds eight connections.

Now each outreach call that takes a second or more (a guess), or fails with a 5xx, writes one line to the server log:

```
[outreach] GET vehicles 200 16210ms · 9 queries, 15980ms in them, slowest 5012ms · pool at start 8/8 busy, 14 waiting, at end 3/8 busy, 0 waiting
```

That is the op, the status, the time, how many queries it ran and their time (on Postgres this includes waiting for a
connection), the slowest one, and the pool as the call began and ended. No token, arguments, SQL or data. Mostly
"waiting" points at the pool; a slowest query near the total points at the query.
