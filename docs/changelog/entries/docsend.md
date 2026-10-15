# DocSend data-room visits, read only · 15 Oct 2026

Juan, 14 Oct 2026: "Are you connected to Docsend yet? if not … add API support". On 15 Oct: "i think they have an MCP",
and the address, `https://docsend.com/mcp`. The design is [docs/32](../../32-docsend.md).

- **Settings → Connections → DocSend.** An Admin presses **Connect DocSend** and signs in to DocSend as themselves.
  After that, **Read now**, **Connect again** and **Disconnect**, and a vehicle picker for each data room the account sees.
- **What is read**: every visit to every data room, with its history. Each visit has who (email), which document and
  link, when, time spent, the share of pages seen, and seconds on each page. Only DocSend's two list tools are called;
  every tool that changes a data room is refused before anything is sent.
- **When**: last in the nightly run, after Affinity and the calendars, so a viewer they just added is matched. The
  first read takes the whole history; later reads stop where the last one finished.
- **Who each viewer is**: matched to an LP by email, the way calendar guests are. Our own team's views are kept but
  never counted, and a viewer nobody has on record stays unmatched.
- **Per vehicle**: `visitsFor(vehicleId)` in `modules/docsend` gives the conversion page (docs/33) its dataroom charts,
  with an as-of time.
- Nothing appears until DocSend is connected on the live server.
