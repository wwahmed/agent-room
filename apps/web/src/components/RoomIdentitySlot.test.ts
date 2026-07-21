import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const slot = readFileSync(new URL('./RoomIdentitySlot.tsx', import.meta.url), 'utf8');
const home = readFileSync(new URL('../screens/Home.tsx', import.meta.url), 'utf8');
const desktopPane = readFileSync(new URL('./RoomListPane.tsx', import.meta.url), 'utf8');

describe('room-list identity placement', () => {
  it('shares one explicitly left-side identity slot across room lists', () => {
    expect(slot).toContain('data-room-identity-slot="left"');
    expect(home).toContain('<RoomIdentitySlot');
    expect(desktopPane).toContain('<RoomIdentitySlot');
    expect(desktopPane).not.toContain('<AgentFacepile');
    expect(desktopPane).not.toContain('ml-auto');
    expect(desktopPane).toContain('data-room-list-width="responsive"');
    expect(desktopPane).toContain('w-[320px]');
    expect(desktopPane).toContain('2xl:w-[400px]');
  });
});
