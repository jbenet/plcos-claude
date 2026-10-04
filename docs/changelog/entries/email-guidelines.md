# Email guidelines: drafts written to the recipient, by the route holder, about one vehicle · 3 Oct 2026

| | |
|---|---|
| ![Preferences → Your voice: style notes and two sample emails, saved](docs/changelog/shots/email-guidelines/01-preferences-your-voice.webp) | **Your voice.** In Preferences, write a few lines on how you write and paste three to five emails you sent. Only you can read or change it. The Email box shows it beside the editor, and the strategy writers read it from the research export. Saving it empty deletes it. |
| ![An LP page's Email card: the strategy's own first message, for Lior to send, with Your voice open](docs/changelog/shots/email-guidelines/02-first-message-from-the-strategy.webp) | **From the strategy's own first message.** The draft is the strategy's `firstMessage` as written: to Bram, in Lior's voice, about PLC Neurotech I. It carries none of the angle, sources or reasoning. |
| ![An intro ask to the connector, empty, with the four steps of the guideline](docs/changelog/shots/email-guidelines/03-intro-ask-the-route-calls-for.webp) | **The email the route calls for.** The best route to this LP goes through a connector, so the card offers the intro ask to that connector, with the direct note as the second choice. With no clean draft, the box starts empty and lists the guideline's structure. |
| ![A draft whose strategy names another sender, with the check saying so](docs/changelog/shots/email-guidelines/04-another-sender-holds-the-route.webp) | **Who sends.** When the strategy names another team member as the route holder, the draft says so beside the Move button. |

Juan, 3 Oct 2026, on the draft the LP page prefilled: "This is not a good email." The page pasted the
strategy's angle into the draft: third person about the recipient, source citations and reading dates,
and our instructions to ourselves, with a quoted second message inside. It was signed by Juan as a cold
note although the route was an introduction. It mixed the fund and an SPV, and it ended with a template
line.

**The guidelines.** `docs/email-guidelines.md` covers:

- the five kinds of email (intro ask with a forwardable blurb, after the intro, cold, follow-up, reply owed);
- who sends (the route holder);
- the structure (why them, the one thing, one clear ask) and the length (80–150 words; a blurb of 3–4 sentences);
- what never goes in an email;
- one vehicle, with 506(c) care and materials only through the send gate;
- subject lines and tone;
- four invented examples, and the bad one anonymised and annotated.

W5 links to it, and the API-run W5 carries it.

**The strategy's first message is its own field.** `Strategy.firstMessage` has `{ kind, from, to, subject, body, blurb? }`.
It is optional, and the checker validates it when present. The checker refuses one with the wrong recipient
for its kind, a greeting to someone else, a cold note beside an A or B route, or an intro ask without a
blurb. It also refuses analysis or private detail in the words (`lib/email/lint.ts`), two vehicles, or
more than 200 words. No real strategy file was rewritten. A later W5 pass fills the field.

**The prefill uses only that field.** It never uses the angle and never adds template lines. Without a clean
first message, the box starts with the greeting and the structure, and the note says why. The LP page
picks the kind from the strategy, else from the best route. A route through someone the LP hasn't met
gets an intro ask to that connector. Someone who has met us gets a follow-up. Draft-time checks now flag
guideline breaks in typed or agent-written drafts. They also flag a draft the strategy gives to another
sender. These checks warn and never block.

**Voice.** `email.voice` (migration `modules/email/002_voice.sql`) stores one row per person. The
research export writes `us/voice.json`. The plan for learning a voice is in `docs/email-guidelines.md` §11:
emails pasted or picked by the person, then their own sent mail through mailguard's read-only key, then
Affinity metadata with no bodies.

Tests: nine properties on invented people.

- Across 600 random strategies, the prefill never carries a citation, a reading date, a note to
  ourselves, third person about the recipient, a template line, an amount or the angle.
- Every draft names one vehicle.
- Across 400 routes, the intro ask goes to the connector, from the route holder, and is never a cold
  note beside a warm route.
- The checker accepts the field when it is absent, accepts a clean one, and refuses the 3 Oct draft.
- The guideline's own good examples pass, and its bad one fails.
- Drafts made from records use only the field.
- Who sends is checked.
- A typed bad draft is warned about.
- The voice is per person, audited by length only, and deleted by saving it empty.

The demo fixture strategies carry a `firstMessage`. The shots are from a demo server, after those
strategies were imported.
