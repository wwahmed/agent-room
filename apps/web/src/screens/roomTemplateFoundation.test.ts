import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ROOM_TEMPLATES } from '../lib/templates.js';
import { ROOM_TEMPLATES_SHARED } from '@agent-room/shared';

const room = readFileSync(new URL('./Room.tsx', import.meta.url), 'utf8');
const create = readFileSync(new URL('./CreateMeeting.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('../lib/api.ts', import.meta.url), 'utf8');

// Template foundation: the template id is a ROOM property (persisted at
// create, host-editable later), not a creation-browser-only fact.
describe('room-template foundation', () => {
  it('the web and shared template registries agree on ids', () => {
    const webIds = ROOM_TEMPLATES.map((t) => t.id).sort();
    const sharedIds = ROOM_TEMPLATES_SHARED.map((t) => t.id).sort();
    expect(webIds).toEqual(sharedIds);
  });

  it('creation sends the template id to the server', () => {
    expect(create).toContain("templateId: template && template.id !== 'blank' ? template.id : undefined");
    expect(api).toContain('templateId: input.templateId');
  });

  it('the host can retag an existing room from Settings (conversion)', () => {
    expect(api).toContain("action: 'setTemplate'");
    expect(room).toContain('handleSetTemplate');
    expect(room).toContain('aria-label="Room type"');
    expect(room).toContain('room.templateId ?? \'\'');
  });
});
