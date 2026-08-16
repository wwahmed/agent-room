import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const menu = readFileSync(new URL('../components/RoomContextMenu.tsx', import.meta.url), 'utf8');
const home = readFileSync(new URL('./Home.tsx', import.meta.url), 'utf8');
const pane = readFileSync(new URL('../components/RoomListPane.tsx', import.meta.url), 'utf8');
// The gesture handling itself is shared with the agent-row menu.
const trigger = readFileSync(new URL('../lib/contextMenuTrigger.ts', import.meta.url), 'utf8');
const agentMenu = readFileSync(new URL('../components/AgentContextMenu.tsx', import.meta.url), 'utf8');

// Host order: room actions where the rooms are listed — long-press on touch,
// right-click on desktop, one shared menu on every card surface.
describe('room-card context actions', () => {
  it('one shared menu serves Home cards and the desktop rooms pane', () => {
    expect(home).toContain('useRoomCardMenu()');
    expect(home.match(/\{\.\.\.bindRoomMenu\(/g)?.length).toBe(3); // active, ended, archived cards
    expect(pane).toContain('useRoomCardMenu()');
    expect(pane).toContain('<RoomContextMenu');
  });

  it('long-press is scroll-guarded and a synthetic open swallows the stretched-link click', () => {
    expect(trigger).toContain('MOVE_TOLERANCE_PX');
    expect(trigger).toContain('onTouchMove');
    expect(trigger).toContain('onClickCapture');
    expect(trigger).toContain('suppressUntilRef');
  });

  it('suppresses the native context menu only on the element that owns the trigger', () => {
    expect(trigger).toContain('onContextMenu: (e: React.MouseEvent) => {');
    expect(trigger).toContain('e.preventDefault();');
  });

  it('room cards and agent rows share ONE gesture implementation', () => {
    // Two copies of this interaction is how the surfaces quietly drift apart:
    // a scroll guard fixed on one menu and not the other is invisible until a
    // phone user complains. Both must delegate to the shared hook.
    expect(menu).toContain('useContextMenuTrigger');
    expect(agentMenu).toContain('useContextMenuTrigger');
    expect(menu).not.toContain('MOVE_TOLERANCE_PX');
    expect(agentMenu).not.toContain('MOVE_TOLERANCE_PX');
  });

  it('offers the sensible action set, host-gated where the server requires host authority', () => {
    for (const label of ['Open People', 'Copy invite link', 'Change room type', 'Reactivate room', 'Archive room', 'Unarchive room']) {
      expect(menu).toContain(label);
    }
    expect(menu).toContain('const canHost = hasHostKey(menu.code);');
  });
});
