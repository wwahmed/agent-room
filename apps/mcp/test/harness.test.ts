import { describe, it, expect } from 'vitest';
import { detectHarness, persistenceSetupHint } from '../src/harness.js';

function env(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return overrides as NodeJS.ProcessEnv;
}

describe('detectHarness', () => {
  it('detects Claude Code via CLAUDECODE=1', () => {
    expect(detectHarness(env({ CLAUDECODE: '1' })).kind).toBe('claude-code');
  });

  it('detects Claude Code via CLAUDE_CODE_ENTRYPOINT', () => {
    expect(detectHarness(env({ CLAUDE_CODE_ENTRYPOINT: 'cli' })).kind).toBe('claude-code');
  });

  it('detects Cursor via CURSOR_TRACE_ID', () => {
    expect(detectHarness(env({ CURSOR_TRACE_ID: 'abc' })).kind).toBe('cursor');
  });

  it('detects Cursor via TERM_PROGRAM', () => {
    expect(detectHarness(env({ TERM_PROGRAM: 'Cursor' })).kind).toBe('cursor');
  });

  it('detects Codex CLI via CODEX_RUN_ID', () => {
    expect(detectHarness(env({ CODEX_RUN_ID: 'r1' })).kind).toBe('codex');
  });

  it('detects Claude Desktop via macOS bundle identifier', () => {
    expect(
      detectHarness(env({ __CFBundleIdentifier: 'com.anthropic.claudefordesktop' })).kind,
    ).toBe('claude-desktop');
  });

  it('falls back to unknown when no signals match', () => {
    expect(detectHarness(env({})).kind).toBe('unknown');
  });

  it('Claude Code wins when both Claude and Codex env vars are present', () => {
    // CLAUDECODE=1 reliably set inside Claude Code. CODEX_HOME is just
    // ~/.codex and may exist on Claude Code users' machines from a prior
    // codex install — the Claude Code branch must win.
    expect(detectHarness(env({ CLAUDECODE: '1', CODEX_HOME: '/Users/x/.codex' })).kind).toBe(
      'claude-code',
    );
  });

  it('claude-code and codex are flagged as not needing setup', () => {
    expect(detectHarness(env({ CLAUDECODE: '1' })).needsPersistenceSetup).toBe(false);
    expect(detectHarness(env({ CODEX_RUN_ID: 'r1' })).needsPersistenceSetup).toBe(false);
  });

  it('cursor / unknown / gemini-cli need setup, Claude Desktop Code/Cowork is strong-loop', () => {
    expect(detectHarness(env({ CURSOR_TRACE_ID: 'x' })).needsPersistenceSetup).toBe(true);
    expect(detectHarness(env({})).needsPersistenceSetup).toBe(true);
    expect(
      detectHarness(env({ __CFBundleIdentifier: 'com.anthropic.claudefordesktop' }))
        .needsPersistenceSetup,
    ).toBe(false);
    expect(detectHarness(env({ GEMINI_CLI: '1' })).needsPersistenceSetup).toBe(true);
  });
});

describe('persistenceSetupHint', () => {
  it('returns empty string for strong-loop harnesses', () => {
    expect(persistenceSetupHint(detectHarness(env({ CLAUDECODE: '1' })))).toBe('');
    expect(persistenceSetupHint(detectHarness(env({ CODEX_RUN_ID: 'r1' })))).toBe('');
    expect(
      persistenceSetupHint(
        detectHarness(env({ __CFBundleIdentifier: 'com.anthropic.claudefordesktop' })),
      ),
    ).toBe('');
  });

  it('returns a setup nudge mentioning init for weak-loop harnesses', () => {
    const hint = persistenceSetupHint(detectHarness(env({ CURSOR_TRACE_ID: 'x' })));
    expect(hint).toContain('Cursor');
    expect(hint).toContain('agent-room-mcp init');
  });

  it('uses generic label for unknown harnesses', () => {
    const hint = persistenceSetupHint(detectHarness(env({})));
    expect(hint).toContain('this client');
    expect(hint).toContain('agent-room-mcp init');
  });
});
