# Investments relevant to the vehicle, on the LP page · 8 Oct 2026

Juan, 8 Oct 2026, on LPs who hold competing BCI companies: "just flag it in their vehicle-LP page, -- we should list
investments relevant to the vehicle".

- **A card on the LP page** (`components/entity/VehicleInvestments.tsx`, after the research card): the LP's public
  portfolio facts (investments, funds they run or back, exits, SPVs) and roles whose words fall in the vehicle's
  field. The words are the same ones strategic value uses (`config.strategic.domains`, issue 0120). An SPV also
  matches its company's name. Each row has its source and confidence, unverified.
- **A competing holding is a flag.** On an SPV, a holding in another company in its field reads "a possible
  competitor to <company>, worth knowing before the ask". It blocks nothing; Juan said such holders "can be fine".
- **Coverage is stated.** The card names the words it read for. When nothing matches it says how many facts it read,
  and that a company whose name doesn't use those words is missed.

Checks: tsc and boundaries, plus a demo render.
