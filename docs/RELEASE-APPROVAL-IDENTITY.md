# Release approval identity: the minimal T-96 server prerequisite

Status: DESIGN ONLY - no server code exists for this yet. T-95 is formally
blocked on this per the Lead's ruling: until the server persists sender
identity and holds the approver policy, the pipeline's approval gate is a
known fail-open gap and T-95 cannot submit.

## The problem, as adjudicated

- VA-0079: release approval compared display names. The builder's own post,
  and a sibling identity operated by the same builder ("ClaudeUI (3)"),
  could both approve the builder's release.
- The current mitigation (challenge line binding full SHA + artifact digest +
  gate digest + policy digest + nonce, registry of (name, client) pairs,
  builder-lineage exclusion by base name) kills replay and the demonstrated
  name-path attacks, but is still name-domain logic and the registry lives
  in the candidate repo - a builder commit can change the policy its own
  release is approved under. Ruled insufficient. Policy digest binding makes
  tampering VISIBLE to the approver; it does not make it impossible.
- The public room payload strips credential hashes, so the pipeline cannot
  even see whether a sender's row is keyed.

## Minimal server additions (three, all small, all in apps/server)

### 1. Sender attestation persisted on every message

At send time, `authenticateSender` already knows exactly how the sender
proved itself. Persist that verdict on the stored message:

```ts
message.metadata.sender = {
  attested: 'memberKey' | 'authId' | 'legacy-name',
  // The durable identity hash the row carries - agentIdHash for cc rows,
  // authIdHash for web rows. Never the plaintext, never the memberKeyHash
  // (it rotates).
  idHash?: string,
}
```

Written server-side only, after authentication, before append - a client can
never supply it (the server overwrites any client-sent `metadata.sender`).
Historical messages simply lack the field and are treated as unattested.

### 2. `keyed` on the public participant row

`get` responses gain two booleans per participant: `keyed` (row carries a
memberKeyHash) and `authed` (row carries an authIdHash), plus the durable
`agentIdHash` where present. No hash preimages, no rotation-sensitive
material. This closes the verifier's "the pipeline cannot see keyed-ness"
finding mechanically.

### 3. Server-held approver policy

A room-scoped policy record, readable by anyone, writable ONLY through the
host-key path (`requireHost` - the same authority that can end a room):

```
action: 'getReleasePolicy'  -> { policy, version, digest }
action: 'setReleasePolicy'  -> requires hostKey; bumps version; appends to
                               an immutable policy history list
policy = {
  approvers:       [{ label, idHash }],       // durable identity hashes
  builderLineages: [{ label, idHashes: [] }], // every identity a builder operates
}
```

The policy leaves the builder's write authority entirely: only Waqas (host
key holder) can change who approves releases, every change is versioned and
kept, and the pipeline records the policy version + digest in the release.

### Room-of-record binding (verifier finding, pre-implementation)

Room-scoped policy alone is spoofable: a builder can create a FRESH room,
hold its host key legitimately, set that room's policy to name their own
sibling identity, and point the pipeline at it - every check then passes.
Closure: `getReleasePolicy` also returns the policy room's host identity
hash (`hostAuthIdHash`, derived server-side from the room creator's
verified Access identity), and the pipeline refuses any policy room whose
host hash differs from the RATIFIED OWNER hash. The owner hash is recorded
once, at ratification, in the release pipeline's committed configuration -
changing it is a reviewed commit the owner and Lead see, and a
builder-minted room can never satisfy it because the builder cannot forge
Waqas's server-verified Access identity. The governance room code itself is
then convenience, not authority.

## Pipeline consumption (changes in scripts/release-pipeline.mjs)

`approve-check` then requires ALL of:
1. the approval message text is the exact challenge line (unchanged);
2. `message.metadata.sender.attested` is `memberKey` or `authId` - a
   legacy-name or missing attestation can never approve;
3. `message.metadata.sender.idHash` matches a policy approver hash;
4. that idHash is in no builder lineage;
5. the policy version/digest recorded at challenge time still matches at
   approve time (no policy swap mid-approval).

Display names stop participating in any decision; they become labels.

## Deploying the server change (server changes have no gate today)

Proposed procedure, needing the Lead's ratification before any of it runs:
1. change lands as a normal reviewed commit with unit tests over
   authenticateSender stamping, policy actions, and hostKey enforcement;
2. TechLead reviews the diff in-room; UX-Adversary verifies the tests
   independently;
3. restart is announced in-room BEFORE execution, with the rollback stated
   (previous commit, `launchctl kickstart`), and executed only on explicit
   authorization - server restarts are held state under the standing rule;
4. post-restart verification: healthz, a probe send with a wrong memberKey
   (must refuse), one attested message inspected for the new metadata.

Pre-cutover runbook steps (verifier findings, named so neither is a
surprise):
- BEFORE enforcement flips, verify the host's own web row carries an
  authIdHash - otherwise the host locks himself out of approving with an
  unattested row. If absent, one fresh authenticated join repairs it.
- The initial `setReleasePolicy` is a HOST action: until Waqas performs it,
  no approval can succeed anywhere. That is correct fail-closed behavior
  and an explicit, scheduled step of the cutover, not an incident.

## Explicitly out of scope here

Full T-96 (identity, presence, People control plane, lifecycle) remains its
own program. This document is only the smallest server surface that makes
release approval identity-true, so T-95 can close honestly.
