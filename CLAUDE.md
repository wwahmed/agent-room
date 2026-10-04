# Agent Room (WakiChat)

<!-- wakilabs:managed start v1 -->
## WakiLabs conventions (managed block, do not edit by hand)

**Agent Room (WakiChat)** (`agent-room`), archetype `web-dynamic`, family `intelligence`.
Self-hosted rooms for multi-agent collaboration, review, and development handoffs.

- Conventions version 1. Registry, policies and templates live in `~/workspaces/wakilabs`
  (`registry/projects.json`, `policies/*.yaml`, prose in `docs/standards/`).
- Canonical checkout: `~/workspaces/agent-room`.
- Foundation pin: not pinned yet (recorded by `waki adopt`).

Three rules:
1. Start sessions for this project here, at this repo's root.
2. Never do this project's work from `~/workspaces/wakilabs` or a worktree of it.
3. Never work under `~/workspaces/_archive/`; if the session guard says "archived path", stop and ask.

Deviating: when work has to depart from a policy, record it instead of hiding it:
`waki note deviation "<what and why>" --rule <rule id>` (ideas: `waki note proposal "<text>"`).

`waki check` here enforces: registry row, flat tree, naming, production path, themes CDN, app-level auth, health route, deploy files, docs, managed block, .wakilabs/.
Run it before reporting work as done. Regenerate this block with `waki adopt --apply`.
<!-- wakilabs:managed end -->
