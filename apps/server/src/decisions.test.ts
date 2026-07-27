import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendDecisionAt, decisionMarkdown, type DecisionEntry } from './decisions.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'decisions-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const entry = (over: Partial<DecisionEntry> = {}): DecisionEntry => ({
  messageId: 42,
  author: 'ClaudeAdmin',
  text: '[DECISION] Pins live on the room record.',
  promotedBy: 'Waqas',
  at: 1785180000000,
  ...over,
});

describe('T-23 decision log — durable, append-only, idempotent', () => {
  it('creates the file with a header and the full entry on first promotion', () => {
    const abs = join(dir, 'DECISIONS.md');
    const out = appendDecisionAt(abs, 'hail-cow-dart', entry());
    expect(out.already).toBe(false);
    const body = readFileSync(abs, 'utf8');
    expect(body).toContain('# Decision log — room hail-cow-dart');
    expect(body).toContain('<!-- decision:42 -->');
    expect(body).toContain('ClaudeAdmin');
    expect(body).toContain('Promoted by Waqas');
    expect(body).toContain('[DECISION] Pins live on the room record.');
  });

  it('re-promoting the same message id is a no-op, never a duplicate', () => {
    const abs = join(dir, 'DECISIONS.md');
    appendDecisionAt(abs, 'hail-cow-dart', entry());
    const again = appendDecisionAt(abs, 'hail-cow-dart', entry({ promotedBy: 'SomeoneElse' }));
    expect(again.already).toBe(true);
    const body = readFileSync(abs, 'utf8');
    expect(body.split('decision:42').length - 1).toBe(1);
    expect(body).not.toContain('SomeoneElse');
  });

  it('appends distinct messages in order without touching earlier entries', () => {
    const abs = join(dir, 'DECISIONS.md');
    appendDecisionAt(abs, 'hail-cow-dart', entry());
    appendDecisionAt(abs, 'hail-cow-dart', entry({ messageId: 43, text: 'Second outcome', at: 1785181111111 }));
    const body = readFileSync(abs, 'utf8');
    expect(body.indexOf('decision:42')).toBeLessThan(body.indexOf('decision:43'));
    expect(body).toContain('Second outcome');
    // one header only
    expect(body.split('# Decision log').length - 1).toBe(1);
  });

  it('entry markdown carries the ISO timestamp and provenance line', () => {
    const md = decisionMarkdown('abc-def-ghj', entry());
    expect(md).toContain('2026-07-27T');
    expect(md).toContain('_Promoted by Waqas from room abc-def-ghj._');
  });
});
