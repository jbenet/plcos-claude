# Linear — the integration points, written down before the connector exists

**Status: nothing is wired.** No Linear client is installed, no API token exists, and none
will before L13. This file is the list of places the product already assumes a tracker, so
that when the connector lands nobody has to go looking for them.

CLAUDE.md lists this as open question 3: *"Linear custom fields. UNVERIFIED in all three
design packages. Check the live GraphQL schema before anything depends on it."* Nothing in
this document should be built against until that check happens.

---

## 1. What already exists

### `plays.handoff` — the outbox

Assigning a play or writing a commitment inserts a row:

| column | meaning |
|---|---|
| `play_id` / `commitment_id` | exactly one is set |
| `provider` | `'linear'` today; the column exists so it does not have to be added later |
| `payload` | the full `LinearPayload` that would be sent, as JSON |
| `state` | `pending` · `sent` · `failed`. **Nothing is ever `sent` before a connector exists.** |
| `external_ref` | the Linear issue identifier, once there is one |
| `note` | why it is still pending |

The UI renders the payload verbatim under a disclosure on the strategy board. That is the
difference between a stub and a lie: a reader can see exactly what would have gone out.

### `LinearPayload` — the shape

```ts
interface LinearPayload {
  title: string;
  description: string;      // markdown
  assigneeHandle: string | null;   // our handle, NOT a Linear user id
  labels: string[];         // capital-os, lever:<lever>, horizon:<h>, gate:<KIND>
  sourceRef: string;        // our play_id or commitment_id
  sourceKind: 'play' | 'commitment';
}
```

`assigneeHandle` is deliberately our handle and not a Linear user id. The mapping between
the two is a thing somebody has to establish, and putting a foreign id in our payload
before that mapping exists would be inventing it.

### `standup.external` — the inbox

The daily standup reads Linear task summaries from `standup.external` with
`source = 'linear'`. Those rows are fixtures today, labelled *mocked* in the card header
and again in the cover line.

---

## 2. What the connector has to do

Four operations, in the order they matter:

1. **Drain the outbox.** `select * from plays.handoff where state = 'pending'` → create
   issue → write `external_ref`, set `state = 'sent'`. Idempotent on `sourceRef`: a
   re-run must find the existing issue rather than create a second one. This is the same
   discipline as the acceptance idempotency key in the agent runtime.
2. **Backfill the inbox.** Replace the `standup.external` fixtures with real issues, and
   keep `ref`, `title`, `state`, `who`, `occurred_at`, `url`.
3. **Accept webhooks.** State changes on an issue we created should close the loop:
   `plays.play.status` → `done` when its issue closes.
4. **Normalise.** Through `Connector<T>` like every other source, so `backfill`, `poll`,
   `onWebhook` and `normalize` are the only four methods any caller sees.

---

## 3. Decisions that are not made yet

- **Team and project.** Which Linear team owns these, and whether each vehicle is a
  project. Affects whether one token is enough.
- **Custom fields.** The unverified part. The lever, horizon, leverage score and gate are
  all things we would like on the issue. **Check the live GraphQL schema first** — if
  custom fields are not available on the plan, labels carry it, which is why the payload
  already encodes them as labels.
- **Assignee mapping.** `platform.app_user.handle` → Linear user id. Needs a stored map,
  and a decision about what happens when somebody has no Linear account.
- **Who owns state.** If a play is assigned here and the issue is closed there, which is
  true? Proposal: **Linear owns execution state, we own why it exists.** `status` follows
  the issue; `because`, `lever` and `leverage` never leave here.
- **Deletion.** An issue deleted in Linear should not silently delete a play. Proposal:
  mark the handoff `failed` with a note and leave the play alone.

---

## 4. Where the seams already are

| Place | What it does today | What it does with Linear |
|---|---|---|
| `modules/plays/service.ts` · `assignPlay` | writes a `pending` handoff | creates the issue, sets `external_ref` |
| `modules/plays/service.ts` · `commit` | writes a `pending` handoff | same |
| `app/[vehicle]/strategy` · Committed | renders the payload under a disclosure | renders a link to the issue |
| `app/standup/[day]` · Linear pane | fixtures from `standup.external` | polled issues |
| `lib/issues/github.ts` | refuses with a sentence | unrelated — that seam is for *issues about this app*, not for work tracking. **Do not merge the two.** |

The last row is the one to be careful about. `IssueSink` is where a complaint about this
software goes; `plays.handoff` is where work on the fundraise goes. They look similar and
they are not the same, and collapsing them would put product bugs into the fundraising
board.
