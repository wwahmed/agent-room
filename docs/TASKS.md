# Task ledger — WakiChat

Durable record of WakiChat room task boards for this project. The
fenced section below is machine-managed; write anything you like
outside it.

<!-- wakichat:tasks:begin v1 — machine-managed section; edit OUTSIDE the markers -->
<!-- wakichat:hash:25487db13d2b2c03 -->

_Last sync: 2026-08-16T17:22:43Z from room page-wig-tape · 1 tasks (1 in_progress)_

### T-01 · App-driven agent revive + intuitive lifecycle surfaces
- **status:** in_progress
- **owner:**  (cc) · **verifier:** Waqas · **created by:** ClaudeDeveloper
- **timeline:** created 2026-08-16T17:22:38Z · claimed 2026-08-16T17:22:43Z
- **DoD:** Right-click (and long-press) on an agent name in the People sidebar and other agent lists opens a context menu with a Bring back action that revives the agent from the app, with no terminal step for the human. Revive reuses the existing summoner relaunch path at the agents current permission level, so a live agent is never disturbed and a dead one is re-summoned. Agents the app genuinely cannot relaunch (adopted, join-code) show an honest explained state instead of a button that fails. Lifecycle surfaces are decrowded: protocol vocabulary (listen loop, tmux, harness, stale, client build) is replaced with plain language, and recovery is presented as a progressive ladder from the simple app action to the aggressive manual/remove path, with advanced terminal detail behind disclosure. Unit and DOM tests cover the ladder decisions and the menu; typecheck and the web test suite pass; work is committed and pushed on its branch; evidence submitted for Waqas review.

<!-- wakichat:state:begin
```json
{"v":1,"roomCode":"page-wig-tape","syncedAt":1786900963424,"board":{"tasks":[{"id":"T-01","title":"App-driven agent revive + intuitive lifecycle surfaces","state":"in_progress","createdBy":"ClaudeDeveloper","owner":"","ownerClient":"cc","verifier":"Waqas","verifierClient":"web","dod":"Right-click (and long-press) on an agent name in the People sidebar and other agent lists opens a context menu with a Bring back action that revives the agent from the app, with no terminal step for the human. Revive reuses the existing summoner relaunch path at the agents current permission level, so a live agent is never disturbed and a dead one is re-summoned. Agents the app genuinely cannot relaunch (adopted, join-code) show an honest explained state instead of a button that fails. Lifecycle surfaces are decrowded: protocol vocabulary (listen loop, tmux, harness, stale, client build) is replaced with plain language, and recovery is presented as a progressive ladder from the simple app action to the aggressive manual/remove path, with advanced terminal detail behind disclosure. Unit and DOM tests cover the ladder decisions and the menu; typecheck and the web test suite pass; work is committed and pushed on its branch; evidence submitted for Waqas review.","createdAt":1786900958333,"claimedAt":1786900963392}]}}
```
wakichat:state:end -->
<!-- wakichat:tasks:end -->
