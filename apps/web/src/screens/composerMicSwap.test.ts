import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./Room.tsx', import.meta.url), 'utf8');
const voiceButton = readFileSync(new URL('../components/VoiceButton.tsx', import.meta.url), 'utf8');

// T-120 FULL-WIDTH FIELD RULE (host order, supersedes the T-84 phone swap,
// the T-45 one-row layout, and the T-79/T-119 visibility conditions those
// layouts required): the text box owns the entire composer width at every
// moment; attach, mic, expand, and send live on their own row BELOW it.
describe('composer full-width field rule (T-120)', () => {
  it('gives the textarea the full width with no flex sharing', () => {
    expect(source).toContain('className="msg-composer w-full resize-none overflow-y-auto border-0 bg-transparent px-2 py-2 outline-none focus:ring-0"');
    expect(source).not.toContain('msg-composer w-full resize-none overflow-y-auto border-0 bg-transparent px-2 py-2 outline-none focus:ring-0 min-w-0 flex-1');
  });

  it('keeps the tools row height while dictating (invisible, not hidden) so the recording bar covers tools, never the transcript', () => {
    expect(source).toContain("${dictating ? 'invisible' : ''}");
    // the overlay escapes the inherited visibility so the recording controls stay usable
    expect(voiceButton).toContain('visible absolute inset-x-0 bottom-0');
  });

  it('retires the width-contention machinery: mic always present, single attach trigger', () => {
    expect(source).toContain('<span className="contents">');
    expect(source).not.toContain("max-sm:hidden' : 'contents'");
    expect(source).not.toContain('attachTriggerPhoneRef');
  });
});
