## Modules 17 and 13 — the answer library, and a backlog that generates itself

**Shipped.** Approved answers with their own versioning and approval state, and the
coverage-gap analysis that module 13 describes — as a query rather than a page of its own.

![Answer library](docs/changelog/shots/m17/01-answer-library.webp)

### Why an answer needs its own approval

An answer is approved separately from the documents it cites. That sounds like a
distinction without a difference until the document changes: the answer sits there still
marked approved, and somebody reads it out in a meeting.

So `library.answer` carries its own status, approver and expiry, and `library.answer_source`
records the claims and documents underneath it. An answer goes stale **two ways** and both
are detected:

- **On a date.** The PRI answer was approved in March 2024 with a one-year expiry. It is
  flagged.
- **On a fact.** If a claim it rests on is superseded, it is flagged even though nobody
  touched the answer.

### The backlog generates itself

`coverageGaps()` is module 13, and it is nine lines of SQL and a word-overlap match. It
takes every objection and every diligence question that has actually been raised and looks
for an approved answer. What comes back is ten questions with nothing behind them — the
content backlog, derived from what people were asked rather than from what somebody
planned to write.

### Where I disagreed

**The matching heuristic is crude, and deliberately biased toward over-reporting.** It
needs two shared words over four characters, so "Fee load is above what their committee has
approved" does not match "What are the fee terms, and is there a break at size?" — even
though the approved answer covers it. That is a false gap.

I left it, because a backlog generator that over-reports wastes a minute of reading and one
that under-reports hides the question you keep being asked. The column is labelled
*nearest*, not *answer*, and the cover line says the match is a pointer to check. Attaching
the real answer to the real objection happens in the decision room, where a person does it.

**Modules 02, 06, 12 and 23 still have no screens, and should not get them yet.** Module 13
earned one because the gap query turned out to be genuinely useful; 17 earned one because
answers need somewhere to live. Segmentation, signals, the LP-fit audit and team capacity
have not demonstrated a workflow that needs a page, and building four more would be exactly
the "twenty-four screens before anything is proven" the plan refuses.

---
