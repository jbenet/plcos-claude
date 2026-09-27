# Vehicle status and WIP navigation · issues 0075–0076

Vehicle Status now shows pipeline counts and a paginated close overview for the selected vehicle. Each LP has its recorded close milestones, next step, open diligence questions, close conditions and latest context note. Multiple commitments remain separate. LP-wide notes are labelled, and Committed pursuits without a close record remain visible with the gap stated.

Hard commitments, soft indications and cash receipts have separate labels and amounts. Pipeline status does not imply consent or money. The timeline plots recorded milestone dates; missing dates and unmodelled planned durations are stated explicitly. Source claims remain labelled and do not become cash or hard commitments.

The rail groups the six requested unfinished pages under a native, collapsed “WIP pages” disclosure for every vehicle, including the grants rail and All vehicles. A label explains that pages may be incomplete; a current WIP page is indicated even while collapsed. Disclosure controls and WIP links have 44-pixel touch targets.

Close Room now selects an open cycle for the vehicle in the URL, instead of showing the first fund’s cycle under other vehicles. Vehicles without a matching cycle show an empty state with links to the SPV or grants workspace where relevant.

Close details load in batches for 20 LP–vehicle pairs per page. No schema changes, connectors or writes to domain records were added. CSS additions are contained in one issue-labelled block.

Validation: TypeScript and module boundaries pass; 416 of 416 properties hold. Demo HTML assertions cover every vehicle’s six-link collapsed WIP group and scoped empty states. All 18 timed routes returned 200 on port 3218; the slowest first visit was 2.63 seconds and the slowest warm visit was 0.33 seconds. Browser rendering and physical iPad interaction could not be verified in this environment; native HTML disclosure semantics and responsive CSS were checked. No screenshots or real records are included.
