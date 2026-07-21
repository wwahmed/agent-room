# Primary-surface release walkthrough

This is a release control, not a design-review suggestion. A web candidate may
not be approved until a person has used the exact immutable staged artifact as
a normal user and a different person has reviewed the resulting receipt.

Synthetic fixtures remain useful for deterministic state coverage. They do not
replace this walkthrough and must not contaminate the real-room views used here.

## Required people and provenance

- Record the full 40-character commit SHA, immutable artifact SHA-256, fixture
  manifest SHA-256, and gate-result SHA-256.
- Record builder, walkthrough reviewer, and independent verifier. Builder and
  walkthrough reviewer must differ; walkthrough reviewer and independent
  verifier must differ.
- Review a durable staging URL or versioned local artifact. Rebuilding from a
  moving worktree invalidates the receipt.
- Every captured frame is stored outside the mutable staging directory and
  listed with its SHA-256.

## Required surfaces

Walk all eight width/theme combinations:

| Surface | Width | Themes |
| --- | ---: | --- |
| Phone | 390 | light, dark |
| Phone | 430 | light, dark |
| Desktop | 1440 | light, dark |
| Desktop | 2032 | light, dark |

Desktop uses a real active room within a list of at least 100 mixed rooms.
Fixture/test rooms must be absent from the normal primary list. The phone pass
uses the real visual viewport, including keyboard-open behavior; resizing a
desktop browser to 390px is supporting evidence only.

## Required journey

Perform these steps without resetting the application between them:

1. Enter from Home and identify the next useful action within ten seconds.
2. Find and switch to a real room amid 100+ mixed rooms.
3. Read the newest message, load older content, and return to the newest point.
4. Exercise forward/reverse scrolling and contextual chrome.
5. Compose empty, typed, multiline, attachment, and voice states; open the
   keyboard and complete/send or safely cancel each applicable flow.
6. Open Chat, Project, People, and Outputs and return to Chat.
7. Resize panes with pointer and keyboard, then test 150% zoom.
8. Switch rooms rapidly, use Back/Forward, and return Home.
9. Exercise loading, empty, error, retry, and disconnected/recovery states.

Keep a first-60-seconds friction log and a separate five-minute friction log.
“None observed” is allowed only as an explicit observation, never as a missing
field.

## Whole-frame judgment

Judge the complete frame at every step, not only the component named in the
task. Record pass, block, or triaged for every category:

- space budget and progressive disclosure;
- hierarchy, typography, contrast, and information noise;
- navigation continuity and state preservation;
- resizing, responsive behavior, and zoom;
- scrollbars and scrolling quality;
- composer and bottom-stack reachability;
- overlays, occlusion, and terminal-message clearance;
- loading, empty, error, and recovery states;
- fixture/test-data pollution;
- keyboard, focus, targets, and assistive semantics.

Anything visible in an ordinary primary frame is in scope for this release
decision. `triaged` requires severity, owner, task reference, and rationale.
`block` prevents approval. There is no “out of scope” escape hatch for visible
product damage.

## Permanent ordinary-frame floors

- Desktop resting composer: 56–64px.
- Phone resting composer: 52–60px; empty editable region at least 68% of the
  composer inner width.
- At newest: the full final message interaction block clears the measured
  bottom stack by at least 16px.
- Every phone bottom-stack control is fully inside `window.visualViewport`.
- Desktop rail is resizable; primary scrollbars are not native-dominant.
- Room switching causes zero document reloads and preserves the shell.
- Fixture rooms visible in the normal work list: zero.

These floors are validated by `scripts/validate-ux-walkthrough.mjs`. They do not
replace judgment; they stop a reviewer from signing a receipt that contradicts
measurements visible in the evidence.

## Release decision

The walkthrough reviewer writes the receipt and may recommend approval only
when there are no blocks or untriaged findings. The independent verifier checks
the full frames, friction log, measurement provenance, and hashes, then signs
the same receipt. Promotion consumes the receipt by digest; editing it after
signature invalidates approval.

For an incident hotfix, restoration may precede this walkthrough only under the
named incident lane. The same immutable hotfix artifact must then run this
walkthrough automatically as post-incident debt, and normal feature promotion
remains blocked until it passes.
