import { describe, expect, it } from 'vitest';
import { normalizeRoomTopic, roomTopicIssue } from './roomTopic.js';

describe('room topics', () => {
  it('normalizes surrounding and repeated whitespace', () => {
    expect(normalizeRoomTopic('  Build:   WakiChat mic fix  ')).toBe('Build: WakiChat mic fix');
  });

  it('requires a meaningful non-empty name', () => {
    expect(roomTopicIssue('   ')).toMatch(/specific name/i);
    expect(roomTopicIssue('Build: {feature-name}')).toMatch(/placeholder/i);
    expect(roomTopicIssue('Bug: microphone transcription')).toBeNull();
  });
});
