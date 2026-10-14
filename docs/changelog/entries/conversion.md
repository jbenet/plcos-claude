# Outreach conversion, a page per vehicle · 14 Oct 2026

Juan, 14 Oct 2026: "need a tool to understand how outreach is converting per vehicle. Include progression in pipeline,
and views in the datarooms (need docsend api). Start by scoping this out as a page per vehicle. Figure out what good
graphs can show us what's working / not working." The plan is [docs/33](../../33-outreach-conversion.md).

- **`/<vehicle>/conversion`**, in the rail under LP stats. It has six parts:
  - **Where LPs stop.** The funnel from Reached to Replied, Met, Indicated and Committed, with the share that went on,
    the median days between steps, and how many passed at each step.
  - **Is it getting better?** LPs first reached each week, and how far each week's LPs have got. Weeks under a
    fortnight old are marked young.
  - **What converts.** The reply rate among LPs reached, by way in (warm intro, direct, they came to us), who reached
    out, LP type, check size, score, fit, best path, source and owner. Each rate shows the range it likely sits in, and
    groups under 10 LPs show counts only.
  - **Who is stuck.** LPs with no reply yet, and LPs met with no dated next step, grouped by days waiting. Each group
    opens to the LPs.
  - **The effort, week by week.** Mail we sent, messages back, meetings held and LPs moved forward, one small chart
    each.
  - **Money.** Hard against the target, and soft on its own. The two are never added.
- **Steps are dated by evidence**: a mail, a meeting or call, or an amount. Mail comes from Affinity and from
  juanmail's comms trace, without auto-replies or group events. Where there is no evidence, a status change fills
  in and is counted as "from status".
- **`/all/conversion`** puts each raising vehicle on its own row, never summed.
- **Dataroom views** show as "Source unavailable" until DocSend is connected. Juan was asked which route to use.
- The numbers are computed in the background like LP stats (`lib/conversion/`, kept per data generation). Readers
  without licensed fields see segments that rest on Dakota as unknown.
