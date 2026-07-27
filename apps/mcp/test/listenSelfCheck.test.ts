import { describe, it, expect } from 'vitest';
import { evaluateSelfRow } from '../src/tools.js';

// T-06: split-brain presence self-heals only if every listen cycle tells the
// agent what the server thinks of ITS OWN row. evaluateSelfRow is the pure
// verdict; runRoomListenPoll turns exists:false into terminated:
// "rejoin_required" instead of a normal quiet window.

const rows = [
  { name: 'host', client: 'web', canSpeak: true },
  { name: 'Builder', client: 'cc', canSpeak: true },
  { name: 'MutedOne', client: 'cc', canSpeak: false },
  { name: 'Auditor', client: 'cc', canSpeak: true, viewer: true },
];

describe('T-06 listen self-check', () => {
  it('echoes a healthy row: exists, name, canSpeak', () => {
    expect(evaluateSelfRow(rows, 'Builder')).toEqual({ exists: true, name: 'Builder', canSpeak: true });
  });

  it('a missing row reads exists:false — the rejoin_required trigger', () => {
    expect(evaluateSelfRow(rows, 'Ghost')).toEqual({ exists: false });
  });

  it('a renamed sibling does NOT satisfy the check — exact name only', () => {
    // The Codex failure: session believes it is "Builder" but its live row is
    // "Builder (2)". The verdict must be exists:false for the stale identity.
    expect(evaluateSelfRow([{ name: 'Builder (2)', client: 'cc', canSpeak: true }], 'Builder')).toEqual({ exists: false });
  });

  it('a web row with the same name never masks a missing cc row', () => {
    expect(evaluateSelfRow([{ name: 'Builder', client: 'web', canSpeak: true }], 'Builder')).toEqual({ exists: false });
  });

  it('echoes muted and viewer verdicts honestly', () => {
    expect(evaluateSelfRow(rows, 'MutedOne')).toEqual({ exists: true, name: 'MutedOne', canSpeak: false });
    expect(evaluateSelfRow(rows, 'Auditor')).toEqual({ exists: true, name: 'Auditor', canSpeak: true, viewer: true });
  });
});
