import { describe, it, expect } from 'vitest';
import { parseBriefCommand } from './briefCommand.js';

describe('parseBriefCommand', () => {
  it('parses bare /brief', () => {
    expect(parseBriefCommand('/brief')).toEqual({ withAudio: false, mode: 'default', topic: null });
  });
  it('parses /brief-with-audio and prose audio forms', () => {
    expect(parseBriefCommand('/brief-with-audio')).toEqual({ withAudio: true, mode: 'default', topic: null });
    expect(parseBriefCommand('/brief with audio')).toEqual({ withAudio: true, mode: 'default', topic: null });
    expect(parseBriefCommand('/brief aloud')).toEqual({ withAudio: true, mode: 'default', topic: null });
  });
  it('parses /brief deep', () => {
    expect(parseBriefCommand('/brief deep')).toEqual({ withAudio: false, mode: 'deep', topic: null });
  });
  it('parses /brief <topic> and audio+deep+topic together', () => {
    expect(parseBriefCommand('/brief dictation')).toEqual({ withAudio: false, mode: 'default', topic: 'dictation' });
    expect(parseBriefCommand('/brief-with-audio deep payments')).toEqual({ withAudio: true, mode: 'deep', topic: 'payments' });
  });
  it('parses natural-language triggers only when the message IS the trigger', () => {
    expect(parseBriefCommand('brief me')).toEqual({ withAudio: false, mode: 'default', topic: null });
    expect(parseBriefCommand('catch me up!')).toEqual({ withAudio: false, mode: 'default', topic: null });
    expect(parseBriefCommand('进度')).toEqual({ withAudio: false, mode: 'default', topic: null });
    // Must NOT hijack a sentence that merely contains the phrase.
    expect(parseBriefCommand('can you catch me up on the design later')).toBeNull();
  });
  it('returns null for ordinary messages and lookalike commands', () => {
    expect(parseBriefCommand('hello team')).toBeNull();
    expect(parseBriefCommand('/briefing notes')).toBeNull(); // "/briefing" is not "/brief"
    expect(parseBriefCommand('/briefcase')).toBeNull();
  });
});
