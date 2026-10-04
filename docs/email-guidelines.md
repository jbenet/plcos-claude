# Email guidelines

The rules every drafter follows, person or agent: the W5 strategy writers, the Email box on the LP page,
an agent drafting over MCP, and anyone typing. Juan, 3 Oct 2026, on a prefilled draft: "This is not a good
email." The annotated example at the end shows what went wrong.

An email goes to a person outside. It is written to them, in the sender's voice, about one thing. Our
analysis stays in our records.

## 1. The kinds of email

| Kind (`firstMessage.kind`) | To | When |
|---|---|---|
| **Intro ask** (`intro_ask`) | the connector | The best route goes through someone and the LP has not met us. Ask the connector to check with the LP first and introduce us if the LP is glad to (double opt-in). Under the sign-off, a **forwardable blurb**. |
| **After the intro** (`after_intro`) | the LP | The introduction has happened, or the route holder knows the LP directly. |
| **Cold note** (`cold`) | the LP | Rare. Only when no route exists. Never when a tier A or B route exists. |
| **Follow-up** (`follow_up`) | the LP | They have met us or written to us. No introduction needed. |
| **Reply owed** (`reply`) | the LP | The last word is theirs. Answer what they asked first. |

The first email is the **next** one to send. If the route goes through a connector and the intro hasn't
happened, that is the intro ask, not the message that comes after it.

## 2. Who sends

The **route holder**: the team member at the start of the best route, or the person the strategy names.
If Priya holds the route, Priya sends it, in Priya's voice, and nobody else sends it cold. A draft that
someone else starts says who should send it, and the box warns its owner.

## 3. Structure and length

1. **Why them.** One specific thing they did or said, in plain words.
2. **The one thing.** One vehicle and one point.
3. **One clear ask** that is easy to answer: a call, a time, a person to meet.

Aim for **80–150 words**. The checker refuses more than 200 (a guess). A forwardable blurb is
**3–4 sentences** (at most 100 words). It is written for the LP to read, about us, and has no greeting
or sign-off. An intro ask runs: why you're asking this connector, why the LP in a sentence, the ask
(double opt-in), the sign-off, then the blurb.

Why now: say it only if it is true and theirs ("you mentioned you're deploying again this year"). Don't
manufacture urgency.

## 4. What never goes in an email

- **Our sources and when we read them.** No "per our portfolio document", "read 30 Sep 2026", "on its
  homepage (example.com, …)", "the team's note (Juan, 26 Sep)".
- **Our notes, scores and reasoning.** No affinity, propensity, capacity, tier, confidence, "the angle",
  "the LP", a W-number. No instructions to ourselves ("ask for X, then the position", "first message,
  after the introduction:").
- **Third person about the recipient.** Don't write "ML for biology is his field" to him. Write "you work
  on ML for biology".
- **A second message.** Don't quote another draft inside the email, and don't add template lines after it.
- **Other LPs** and their decisions, amounts, or words.
- **Amounts**, unless they have already been discussed with this person. The prefill never fills one in.
- **Non-public portfolio details**: a round and its date, a valuation, terms, anything from our documents.
  Say only what the recipient can already know, or what we choose to share.

## 5. Vehicle and compliance

- **One vehicle per email** (domain rules 5 and 11). A fund email doesn't pitch an SPV. An SPV email
  doesn't present the company as a fund holding. Overlaps are coordinated in Capital OS, not in the
  email. The draft checks flag another vehicle by name, and any SPV or fund language in the other's email.
- **506(c) care.** No performance claims, no returns, no promises, no "can't lose". Accreditation is
  verified later, in the process, not in the email.
- **Materials only through the send gate.** No deck with a first intro. Attach only material approved for
  this vehicle (the materials matrix, a SEND ticket).
- An LP outside the US gets no fund terms until counsel has said how (W5).
- Grants-rail outreach needs a funder invitation (rule 12).

## 6. Subject lines

Short, specific and plain. Their topic, not our product: "Organism recordings and ML", "Intro to Dana
Whitfield?", "Following up on Tuesday". No "Exciting opportunity", no all-caps, no vehicle names stacked up.

## 7. Tone

Plain, specific, warm, and no hype. Use contractions. Write one idea per paragraph. Leave out "excited to
share", "game-changing", "circle back" and "synergy". Ask a question they can answer in one line.

**Public facts, used naturally.** Write "I saw your talk at the Lindell symposium on cross-species models",
not "(source: symposium video, read 30 Sep 2026)". If you can't say how you'd know it without our records,
leave it out.

## 8. Where the words live

W5 writes the email as the strategy's own field, separate from the analysis (`lib/enrich/strategy.ts`,
`FirstMessage`):

```
firstMessage { kind, from, to: { name, key?, isPerson? }, subject, body, blurb? }
```

`body` runs from the greeting to the sign-off. `from` is the route holder. `to` is the LP, or the
connector for an intro ask (`key` = their entity key when W3 has one). `blurb` is required for an intro
ask. The checker (`checkFirstMessage`, using `lib/email/lint.ts`) refuses a first message that fails
any rule above that a machine can check.

The LP page's Email box offers the kind the route calls for. With a route through someone, that is
"Draft the intro ask to <connector>", with the direct note as the second choice. The box starts from
`firstMessage` and nothing else. It never uses the angle or the reasoning, and never adds template
lines. With no clean first message, the box starts empty, showing the structure above.

## 9. Examples (invented people)

**Intro ask** (from Mira Castell, who holds the route, to Tomas Lindqvist):

> Subject: Intro to Dana Whitfield?
>
> Hi Tomas,
>
> You sat on Dana's board at Brightwater, so you'd know better than anyone whether this is her kind of
> thing. We're raising PLC Neurotech I, a fund backing companies that build tools to read and write the
> brain. Dana has written about wanting earlier exposure to neurotech.
>
> Would you ask her if she'd like an introduction? Only if she's glad to. I've put a short note below
> you can forward.
>
> Thanks,
> Mira
>
> Mira Castell runs neurotech investing at Protocol Labs. Her fund, PLC Neurotech I, backs early teams
> building brain-computer interfaces and the tools around them. She'd value 30 minutes with Dana on where
> neurotech is heading in the clinic.

**After the intro** (from Mira to Dana, once Tomas has introduced them):

> Subject: Neurotech in the clinic
>
> Hi Dana,
>
> Thanks for saying yes to Tomas. I liked your piece on why most neurotech stalls between the lab and the
> clinic. It's the gap we spend most of our time on.
>
> We're raising PLC Neurotech I, a fund for early teams building brain-computer interfaces and the tools
> they need. I'd like to hear how you think about that gap, and tell you where we see it closing.
>
> Would 30 minutes next week work? Tuesday or Thursday afternoon are open.
>
> Best,
> Mira

**Follow-up** (from Owen Achebe to Lena Park, after a meeting):

> Subject: Following up on Tuesday
>
> Hi Lena,
>
> Thanks for the time on Tuesday. You asked how we pick between two teams on the same problem. The short
> answer is that we back the team with its own data. I'm happy to walk through two examples.
>
> Would a call with our scientific lead help before your committee meets?
>
> Best,
> Owen

**Cold note** (rare; no route on file, from Owen to Ravi Menon):

> Subject: Your talk on closed-loop stimulation
>
> Hi Ravi,
>
> I watched your talk at the Boston neuromodulation meeting. Your point about closed-loop trials needing
> new endpoints stuck with me. I run part of a neurotech fund, PLC Neurotech I, and we see the same
> problem in our teams.
>
> Would you be open to a 20-minute call to compare notes? No pitch deck. I'd mostly like your view.
>
> Best,
> Owen

## 10. The bad example, anonymised

The draft the LP page prefilled on 3 Oct 2026, with the names changed:

> Hi Jordan,
>
> ML for biology is his field; Orrin Labs, a PLC Neurotech I portfolio company (pre-seed, Nov 2025, per
> our portfolio document), describes recording systems, cross-species datasets and foundation models of
> living organisms on its homepage (orrinlabs.example, read 30 Sep 2026); the team's note (Juan, 26 Sep)
> puts its first applications in AI and robotics. Ask for a diligence conversation with Priya on whether
> organism recordings make better models, then the position. First message (draft, nothing sent), after
> the introduction: 'Jordan, Priya Raman leads our neurotech work. One of our portfolio companies, Orrin
> Labs, records living organisms to build cross-species datasets and foundation models. Would you spend 30
> minutes with Priya on whether that data transfers to ML? There's a small vehicle for individuals if
> it's interesting.'
>
> I would like to tell you about Orrin Labs SPV. Would you have time for a short call in the next couple
> of weeks?
>
> Best,
> Juan

What is wrong:

1. **The strategy's analysis was pasted in.** It talks about Jordan in the third person ("his field"),
   cites sources and reading dates ("per our portfolio document", "read 30 Sep 2026", "(Juan, 26 Sep)"),
   and gives us instructions ("Ask for …, then the position", "First message (draft, nothing sent),
   after the introduction:"). The prefill used to paste the strategy's `angle`. It now uses only
   `firstMessage`.
2. **Two messages in one.** The quoted first message, then a template line after it. The template is gone.
3. **Wrong sender and channel.** The route is an introduction, with Priya leading. Juan's cold note
   skips both. The right email is an intro ask to the connector with a blurb, or Priya's first message
   after the intro.
4. **Two vehicles.** It calls Orrin Labs a PLC Neurotech I portfolio company, then pitches "Orrin Labs
   SPV" and "a small vehicle for individuals". Choose one.
5. **Private detail.** The round, its date, and our documents and notes.
6. **The generic closing ask.** It gives no reason why them or why now, runs to 150 words of analysis
   before the ask, and isn't in the sender's voice.

The same email, done right: Priya's message after the intro, about the SPV only.

> Subject: Organism recordings and ML
>
> Hi Jordan,
>
> Thanks for taking the intro. You work on ML for biology, so I'd value your take on a question we keep
> coming back to. Orrin Labs records living organisms to build cross-species datasets and foundation
> models. Does data like that make better models, or just bigger ones?
>
> Would you spend 30 minutes with me on it next week? If it's interesting after that, I can tell you
> about the Orrin Labs SPV.
>
> Best,
> Priya

## 11. Voice

Drafts should sound like the person sending them. That person's own mail is the best guide, and it is
the most private input we have, so each way in is opt-in, local and deletable.

**Built (3 Oct 2026).** Preferences → **Your voice**: a few lines on how you write, plus three to five
emails you sent. You paste or pick them yourself. It is stored per person in `email.voice`, and only
you can read or change it. Saving it empty deletes it, and the audit keeps only the lengths. Drafters
see it in two places. The Email box shows it beside the editor ("Your voice"). The research export
writes `us/voice.json`, which the W5 strategy writers read, so `firstMessage.body` is in its sender's
voice.

**How to learn a voice, in order of preference:**

1. **Emails the person pastes or picks.** This is the minimum, and it's built. Three to five emails
   that read like them at their best, plus their own notes ("short, first name, signs off 'Best, J'").
2. **Their own sent mail through mailguard**, once it's integrated (being built in parallel;
   `lib/connectors/gmail` is moving to it). mailguard gives each tool its own key and policy. Here that
   means a key that can only read message bodies (`read.body`), scoped to the person's sent label and a
   recent window, with no draft or send. From it we'd propose 10–20 recent sent emails written by
   them, not forwards or replies-all with long threads. The person ticks the 3–5 to keep, and only
   those are saved. Nothing else is stored. Whether mailguard's label scope can pin to Sent is not
   verified.
3. **Affinity email metadata, with no bodies.** Who they write to, how often, how quickly they reply,
   and their usual length and hours. This shows patterns, not words. It's useful for "who should send"
   and for pacing, not for wording.
4. **A per-user voice profile in the app.** Short style notes plus 3–5 examples, editable in
   Preferences. This is what's built; 1 and 2 feed it. Whatever drafts reads it: the W5 agents now,
   and later an in-app drafter on the capped Anthropic key, which would put the profile in its prompt
   beside these guidelines and the strategy's `firstMessage`.

**Privacy.** A person's own mail only, never a colleague's. It's kept local (this database and
`data/real/enrich/us/`). It's never used for training. It's shown only to drafters working for that
person. It's deletable at any time (Preferences → Delete it), and a deletion reaches the next export.
No inbox is read without the person turning it on.
