# One list of LPs, with a type on each row · issue 0113

| | |
|---|---|
| ![Selection as one ranked list, with a type icon on each row and the Firms/Individuals toggles](docs/changelog/shots/selection-0113/01-type-icons-toggles.webp) | Organisations and individuals as one ranked list, each row with its type icon, and the **Firms**/**Individuals** toggles in the filter line. |

**Selection and Pipeline.** Organisations and individuals are one ranked list again, ranked
together in the chosen order (Juan: "intersperse them"), instead of two sections. Every row starts
with a small type icon: a building for a firm, a person for an individual, read out as "Firm" or
"Individual" and explained on hover. The *personal* and *firm or personal?* marks stay after an
individual's name. Two toggles in the filter line, **Firms** and **Individuals**, both on to start,
each show how many LPs of that type the current statuses and filters hold. Their state is in the
address (`units=firms`, `units=individuals`, `units=none`), so a link or Back returns to it.

A firm still names its people inside its row, and "also individual" and "firm's row" still jump
between the two rows of someone who invests both ways. A jump to a row the toggles or statuses
hide turns its type or status back on first. The keyboard (↑↓, j/k, x, s, u, Enter), Move to
Selected, Undo and the SPV column work as before; the detail beside Selection says "#3 by score ·
firm". The LP-unit model itself (docs/23) is unchanged.

**The issue arrived titled "\\".** The first line of the report was a lone backslash: a backslash
then Enter is how a terminal (and Claude Code) types a newline, and the feedback box's title came
from the first non-empty line. Now a line-end backslash is read as a typed newline and dropped from
the report, and a line with no letter or digit is never a title. Separately, the issue file's
frontmatter now quotes a title with any quote mark, backslash, leading bracket, trailing space or
line break, so every title reads back exactly as written; before, a title such as `"rail" is "odd"`
lost its outer quotes and `[x]` read back as a list.

**Checks.** New properties: one ranked list with no row held back; the toggles hide only their own
type, start on both and survive an edited address; 14 awkward titles round-trip through the issue
file; a typed-newline backslash never becomes a title while one inside the text is kept.
