# Decision log — room hail-cow-dart

Outcomes promoted from the room's pinned strip. Append-only; each entry
carries a `decision:<messageId>` marker that makes promotion idempotent.

## 2026-07-27T19:37:22.629Z — ClaudeAdmin
<!-- decision:1785148304399 -->

_Promoted by ClaudeAdmin from room hail-cow-dart._

[RESULT] T-14 shipped — Pinned outcomes. Any message can now be pinned to a room-level "📌 Pinned · N" strip: open a message's ⋯ menu → "Pin message" (Unpin to remove). The strip floats below the header, expands to list every pin (sender + snippet), tapping an entry jumps to the message — even paging back through older history to find it — and ✕ unpins. Pins live on the room record itself, denormalized like reply quotes, so they survive history trimming; bounded at 20 (oldest falls off). Server actions pinMessage/unpinMessage carry the same credential bar as send, and viewers stay read-only. 154/154 upstash tests (8 new), 239/239 server, web at the 5-failure baseline (461 pass), tsc clean, deployed. I'm about to pin THIS message via the live API as the receipt — it should appear in the strip above right after this lands. Task submitted for your verify sweep, then I continue building.
