import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./Room.tsx', import.meta.url), 'utf8');

// T-79: attachment + dictated text leave in ONE message. The T-84 phone
// mic-to-Send swap must never fire while an attachment is staged (or
// mid-dictation, per T-85) — otherwise the mic is unreachable exactly when
// the host wants to dictate the caption, forcing installment sends.
describe('phone mic swap respects staged attachments (T-79)', () => {
  it('hides the mic only when there is text, no dictation, AND no attachments', () => {
    expect(source).toContain("text.trim() && !dictationDraft && attachments.length === 0 ? 'max-sm:hidden' : 'contents'");
  });
});

// T-119: while dictation is ACTIVE the recording overlay carries every
// control, so the trigger cluster yields its slots and the draft textarea
// takes the full composer width.
describe('dictation clears the composer row (T-119)', () => {
  it('hides attach, expand, and send while dictating and hands VoiceButton the trigger-hiding prop', () => {
    expect(source).toContain("sm:hidden ${dictating ? 'hidden' : 'flex'}");
    expect(source.split("${dictating ? '' : 'sm:flex'}").length).toBe(3); // desktop attach + expand
    expect(source).toContain("dictating ? 'hidden' : text.trim() || attachments.length > 0");
    expect(source).toContain('hideTriggerWhileActive');
  });
});
