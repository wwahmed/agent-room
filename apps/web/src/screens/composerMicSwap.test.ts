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
