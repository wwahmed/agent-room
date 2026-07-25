import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const room = readFileSync(new URL('./Room.tsx', import.meta.url), 'utf8');
const voice = readFileSync(new URL('../components/VoiceButton.tsx', import.meta.url), 'utf8');

// Waqas: the recorder's finish control must SEND in one tap — no two-stage
// "Use draft" then Send. Live transcript + in-place editing stay as they are.
describe('recorder finishes with a one-tap Send', () => {
  it('the overlay accept control is Send when the composer can dispatch', () => {
    expect(voice).toContain("aria-label={onSendTranscript ? 'Send message' : 'Use voice draft'}");
    expect(voice).toContain("{onSendTranscript ? 'Send' : 'Use draft'}");
  });

  it('routes the finalize to onSendTranscript only for a Send-initiated stop', () => {
    expect(voice).toContain('sendOnStopRef.current = true;');
    expect(voice).toContain('if (sendOnStopRef.current && onSendRef.current) {');
    // discard and fresh sessions must not inherit a stale Send intent
    expect(voice).toContain("onClick={() => { sendOnStopRef.current = false; ctrlRef.current?.cancel(); onCancel?.(); }}");
    expect(voice).toContain('sendOnStopRef.current = false; // a new session never inherits a Send intent');
  });

  it('the room dispatches with an explicit body, never the not-yet-rendered DOM', () => {
    expect(room).toContain('async function send(bodyOverride?: string)');
    expect(room).toContain('const body = (bodyOverride ?? textareaRef.current?.value ?? text).trim();');
    expect(room).toContain('onSendTranscript={(t) => {');
    expect(room).toContain('void send(body);');
  });

  it('the send chime stays single: the recorder tap defers to the send path', () => {
    // In send mode the overlay button must NOT play its own cue — send() plays
    // the dictation chime once the message actually dispatches.
    expect(voice).toContain('sendOnStopRef.current = true;\n                  ctrlRef.current?.stop();\n                  return;');
  });
});
