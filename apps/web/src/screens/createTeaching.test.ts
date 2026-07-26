import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { suggestTemplateForTopic } from '../lib/templates.js';

const create = readFileSync(new URL('./CreateMeeting.tsx', import.meta.url), 'utf8');

// The creation page is a teaching surface: the room TYPE leads with
// when-to-use cards, the topic can suggest a type, and blank is a skip link —
// structure is the default posture, not an afterthought row of chips.
describe('create page — template-first teaching layout', () => {
  it('the type choice leads and renders when-to-use copy on cards', () => {
    const type = create.indexOf('What kind of room?');
    const topicField = create.indexOf('Room name');
    expect(type).toBeGreaterThan(-1);
    expect(type).toBeLessThan(topicField);
    expect(create).toContain('{t.whenToUse}');
  });

  it('blank is a demoted skip link, and a selected type previews crew + markers', () => {
    expect(create).toContain('Skip — just a topic, no structure');
    expect(create).toContain('data-gate="template-preview"');
    expect(create).toContain('Suggested crew:');
  });

  it('typing a recognizable topic on a blank room offers a type suggestion', () => {
    expect(create).toContain('data-gate="template-suggestion"');
    expect(suggestTemplateForTopic('Bug: back button minimizes app')?.id).toBe('bug-fix');
    expect(suggestTemplateForTopic('Customer support triage')?.id).toBe('support-desk');
    expect(suggestTemplateForTopic('WakiLab HQ')?.id).toBe('live-ops');
    expect(suggestTemplateForTopic('zz')).toBeUndefined();
  });
});
