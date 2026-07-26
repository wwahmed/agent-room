import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const menu = readFileSync(new URL('../components/RoomContextMenu.tsx', import.meta.url), 'utf8');
const home = readFileSync(new URL('./Home.tsx', import.meta.url), 'utf8');
const pane = readFileSync(new URL('../components/RoomListPane.tsx', import.meta.url), 'utf8');

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
    expect(menu).toContain('MOVE_TOLERANCE_PX');
    expect(menu).toContain('onTouchMove');
    expect(menu).toContain('onClickCapture');
    expect(menu).toContain('suppressUntilRef');
  });

  it('suppresses the native context menu only on the card', () => {
    expect(menu).toContain('onContextMenu: (e: React.MouseEvent) => {');
    expect(menu).toContain('e.preventDefault();');
  });

  it('offers the sensible action set, host-gated where the server requires host authority', () => {
    for (const label of ['Open People', 'Copy invite link', 'Change room type', 'Reactivate room', 'Archive room', 'Unarchive room']) {
      expect(menu).toContain(label);
    }
    expect(menu).toContain('const canHost = hasHostKey(menu.code);');
  });
});
