import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const room = readFileSync(new URL('../screens/Room.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');
const menu = readFileSync(new URL('../components/MessageMenu.tsx', import.meta.url), 'utf8');
const row = readFileSync(new URL('../components/MessageRow.tsx', import.meta.url), 'utf8');
const hook = readFileSync(new URL('../hooks/useRoom.ts', import.meta.url), 'utf8');

// T-14: pinned outcomes. Source-contract pins in the helpAction/invite style.
describe('Pinned outcomes — pin any message, strip with jump-to-message', () => {
  it('the room renders the pinned strip with jump and unpin wiring', () => {
    expect(room).toContain('data-gate="pinned-strip"');
    expect(room).toContain('Pinned · {pinnedList.length}');
    expect(room).toContain('jumpToPin(p.id)');
    expect(room).toContain('togglePinById(p.id, false)');
  });

  it('every message action affordance carries the Pin/Unpin toggle', () => {
    expect(menu).toContain('data-gate="pin-toggle"');
    expect(menu).toContain("pinned ? 'Unpin message' : 'Pin message'");
    // MessageRow threads the pin affordance into all its menu call sites
    // AND both hover treatments (the SHIPPED desktop tray + the rail).
    // Six call sites: self + grouped, split phone/desktop controls for the
    // ungrouped header, and the two hover treatments.
    expect(row.match(/onPin=\{onPin\} pinned=\{pinned\}/g)?.length).toBe(6);
    const tray = readFileSync(new URL('../components/MessageActionTray.tsx', import.meta.url), 'utf8');
    expect(tray).toContain("pinned ? 'Unpin message' : 'Pin message'");
    expect(tray.match(/onPin=\{onPin\} pinned=\{pinned\}/g)?.length).toBe(2);
    expect(room).toContain('pinned={pinnedIds.has(m.id)}');
  });

  it('a pin whose target sits in paged-out history seeks older pages', () => {
    expect(room).toContain('setPinSeekId(id)');
    expect(room).toContain('pinSeekId, messages, hasOlder, loadingOlder');
  });

  it('the API client posts pinMessage/unpinMessage with the member credential', () => {
    expect(api).toContain("action: pinned ? 'pinMessage' : 'unpinMessage'");
    expect(api.slice(api.indexOf("'pinMessage'"))).toContain('memberKey: mk');
  });

  it('the pin result patches the room record immediately', () => {
    expect(hook).toContain('patchRoomPins');
    expect(room).toContain('patchRoomPins(out.pinnedMessages)');
  });

  // T-23: pins are transient; the 📖 action makes them durable.
  it('every strip entry can be promoted into the durable decision log', () => {
    expect(room).toContain('data-gate="promote-decision"');
    expect(room).toContain('promotePinnedDecision(createClient(), code, p.id, self.name)');
    expect(api).toContain("action: 'promoteDecision'");
    expect(api.slice(api.indexOf("action: 'promoteDecision'"))).toContain('memberKey: mk');
  });
});
