import { describe, expect, it } from 'vitest';

import {
  MAX_ROOM_OUTPUT_INSTRUCTIONS,
  normalizeRoomOutputInstructions,
  roomOutputInstructions,
} from '../src/outputInstructions.js';

describe('room output instructions', () => {
  it('resolves owner override before template default and labels its limited authority', () => {
    const owner = roomOutputInstructions({
      templateId: 'fluid-interface',
      outputInstructions: 'Use compact tables.',
    });
    expect(owner).toMatchObject({
      source: 'owner',
      text: 'Use compact tables.',
      authority: 'presentation_only',
    });
    expect(owner?.precedence).toMatch(/tool schemas.*security.*conventions/i);

    const fallback = roomOutputInstructions({ templateId: 'fluid-interface' });
    expect(fallback?.source).toBe('template');
    expect(fallback?.text).toContain('`wakiview` JSON block');
    expect(fallback?.text).toContain('Never emit HTML');
  });

  it('treats empty override as reset and leaves non-fluid rooms without hidden guidance', () => {
    expect(roomOutputInstructions({ templateId: 'fluid-interface', outputInstructions: ' \n ' })?.source).toBe('template');
    expect(roomOutputInstructions({ templateId: 'blank' })).toBeNull();
  });

  it('normalizes controls/line endings and rejects malformed or oversized input', () => {
    expect(normalizeRoomOutputInstructions('  first\r\nsecond\u0000\u0007  ')).toEqual({
      ok: true,
      value: 'first\nsecond',
    });
    expect(normalizeRoomOutputInstructions({ text: 'forged' }).ok).toBe(false);
    const tooLarge = normalizeRoomOutputInstructions('x'.repeat(MAX_ROOM_OUTPUT_INSTRUCTIONS + 1));
    expect(tooLarge.ok).toBe(false);
    if (!tooLarge.ok) expect(tooLarge.reason).toMatch(/exceeds/);
  });
});
