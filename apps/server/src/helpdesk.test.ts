import { describe, it, expect } from 'vitest';
import { adminHelpPage, helpConfirmation, ADMIN_AGENT_NAME, ADMIN_HQ_ROOM } from './helpdesk.js';

// T-10: the page's wording is load-bearing — the leading @mention is what the
// admin agent's listen loop flags as a direct address, and the join link is
// what gets them into the right room. Pin both.
describe('helpdesk composers', () => {
  const page = adminHelpPage({
    admin: 'ClaudeAdmin',
    requester: 'Waqas',
    code: 'mint-mop-cope',
    topic: '3dByPixel 2.0',
    origin: 'https://chat.wakilabs.dev',
    note: 'attachments are broken again',
  });

  it('leads with the @mention and carries requester, room, topic, note, and join link', () => {
    expect(page.startsWith('[HELP] @ClaudeAdmin — ')).toBe(true);
    expect(page).toContain('Waqas needs help in room mint-mop-cope');
    expect(page).toContain('("3dByPixel 2.0")');
    expect(page).toContain('"attachments are broken again"');
    expect(page).toContain('Join: https://chat.wakilabs.dev/j/mint-mop-cope');
  });

  it('omits the note cleanly when absent or blank', () => {
    const bare = adminHelpPage({ admin: 'A', requester: 'R', code: 'c-d-e', topic: 't', origin: 'https://x', note: '  ' });
    expect(bare).not.toContain('— ""');
    expect(bare).toContain('R needs help in room c-d-e');
  });

  it('the source-room confirmation names both parties', () => {
    const c = helpConfirmation('ClaudeAdmin', 'Waqas');
    expect(c).toContain('Waqas requested help');
    expect(c).toContain('ClaudeAdmin has been paged');
  });

  it('defaults point at the standing admin setup', () => {
    expect(ADMIN_HQ_ROOM).toBe(process.env.ADMIN_HQ_ROOM || 'hail-cow-dart');
    expect(ADMIN_AGENT_NAME).toBe(process.env.ADMIN_AGENT_NAME || 'ClaudeAdmin');
  });
});
