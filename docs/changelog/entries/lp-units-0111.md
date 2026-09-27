# LP units: the firm is the LP, individuals apart · issues 0111, 0112

**The model (docs/23).** The LP is the committing unit: an organisation, or a person in their own
capacity. A person at a firm is a contact on the firm's pursuit, named in its row with their role.
A person who also invests personally has an individual LP row of their own, linked to the same
person, only where there is evidence of it. "Personal" is not a firm: an organisation record named
for a capacity is read as evidence of personal investing.

**Selection and Pipeline.** Both lists now have two sections. Organisations come first, each once
and selectable, with their people named inside the row (contacts in bold). Individuals follow, each
with their firms as context, a green *personal* mark where there is evidence, and an amber *firm or
personal?* mark where the rule could not tell. Someone who invests both ways is in both places:
"also individual ↓" and "firm's row ↑" jump between the two rows. The Pipeline has Selection's
keyboard: ↑↓ or j/k move, x ticks, Enter opens, s moves a New or Sourcing LP to Selected, and u
undoes it. The black Move to Selected button now also heads the Pipeline's tray for ticked New and
Sourcing LPs. The org rows built from their people's pursuits (issue 0092) are gone: there is
nothing to summarise when every row is one LP.

**The LP page.** An organisation's page lists its people: its contacts on this pursuit first, and
which of them are also individual LPs here, with their status. A person's page is theirs as an
individual: it names their firms, links each firm's own LP row, and asks "Who is the LP?" with a
person's way to settle it (they invest personally, or move the pursuit to a firm as its contact).

**Re-point pursuits to their LP.** A job in Developer → Enrich, also run by Import the findings.
Evidence of personal investing keeps a person's pursuit; one investing organisation and no such
evidence moves it to the organisation's pursuit, created when missing, with status, owner, rungs,
strategies, updates, meetings, notes and plans; anything else is flagged for review. Money in a
person's name, or a number on their ladder, is never moved: it is a question for a person. No
status is lowered. Every decision is journalled and reversible; a reversed or person-made decision
is never re-applied; a second pass writes nothing. A contact's meetings still count as the LP's.

**On the demo** (invented cases, `scripts/lp-units-demo.ts`): a joint vehicle whose two founders
invest personally, an allocator with one associate, an angel with no firm, and a founder of a
company that does not invest. The first pass over the whole demo moved 8 pursuits (7 organisation
pursuits created), kept 6 individuals and flagged 8; the second pass changed nothing; reversals
restored every row exactly.

**Checks.** New properties: the rules, no person-set status lowered (all 224 combinations of status and who set it),
a move carrying history, idempotence, a person's decision standing, exact reversal, and the
grouping (an organisation once, individuals apart, a person in both places). The 0092/0105
grouping properties are replaced: they checked people nested under a firm, which this retires.
