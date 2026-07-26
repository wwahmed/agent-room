# Task ledger — WakiChat

Durable record of WakiChat room task boards for this project. The
fenced section below is machine-managed; write anything you like
outside it.

<!-- wakichat:tasks:begin v1 — machine-managed section; edit OUTSIDE the markers -->
<!-- wakichat:hash:9254d10582aa5bad -->

_Last sync: 2026-07-26T03:30:41Z from room hail-cow-dart · 1 tasks (1 in_progress)_

### T-01 · Room-data root: auto-created per-room durable storage (v2 architecture)
- **status:** in_progress
- **owner:** ClaudeAdmin (cc) · **verifier:** ClaudeDev · **created by:** ClaudeAdmin
- **timeline:** created 2026-07-26T03:24:59Z · claimed 2026-07-26T03:30:41Z
- **DoD:** Every room automatically gets a data directory under one app-owned root (default ~/.agent-room/rooms/&lt;code&gt;/, configurable) holding its durable ledger (tasks + board state), created with the room — no registry entry required, "no project attached" never appears. The repo-registry attachment remains as an optional overlay for rooms that want the ledger inside the product repo. Existing active rooms migrated. Server tests cover: auto-creation at room create, ledger read/write to the room-data root, registry overlay still winning when attached, migration of a pre-existing room.

<!-- wakichat:state:begin
```json
{"v":1,"roomCode":"hail-cow-dart","syncedAt":1785036641916,"board":{"tasks":[{"id":"T-01","title":"Room-data root: auto-created per-room durable storage (v2 architecture)","state":"in_progress","createdBy":"ClaudeAdmin","owner":"ClaudeAdmin","ownerClient":"cc","verifier":"ClaudeDev","verifierClient":"cc","dod":"Every room automatically gets a data directory under one app-owned root (default ~/.agent-room/rooms/&lt;code&gt;/, configurable) holding its durable ledger (tasks + board state), created with the room — no registry entry required, \"no project attached\" never appears. The repo-registry attachment remains as an optional overlay for rooms that want the ledger inside the product repo. Existing active rooms migrated. Server tests cover: auto-creation at room create, ledger read/write to the room-data root, registry overlay still winning when attached, migration of a pre-existing room.","createdAt":1785036299299,"claimedAt":1785036641861}]}}
```
wakichat:state:end -->
<!-- wakichat:tasks:end -->
