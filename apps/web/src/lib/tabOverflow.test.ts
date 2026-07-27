import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const room = readFileSync(new URL('../screens/Room.tsx', import.meta.url), 'utf8');
const switcher = readFileSync(new URL('../components/WorkspaceSwitcher.tsx', import.meta.url), 'utf8');

// T-15: header declutter — promote the work surfaces, fold the rest.
describe('Tab overflow — Chat/Board/People promoted, Outputs/Settings folded', () => {
  it('the room splits the tab list: three primary, two behind More', () => {
    expect(room).toContain("t.key === 'chat' || t.key === 'project' || t.key === 'people'");
    expect(room).toContain("t.key === 'outputs' || t.key === 'room'");
    expect(room).toContain('destinations={PRIMARY_TABS}');
    expect(room).toContain('overflow={OVERFLOW_TABS}');
  });

  it('the More control is a real menu that closes on select/outside/Escape', () => {
    expect(switcher).toContain('data-gate="tab-overflow"');
    expect(switcher).toContain('aria-haspopup="menu"');
    expect(switcher).toContain('role="menu"');
    expect(switcher).toContain("e.key === 'Escape'");
    expect(switcher).toContain('setMoreOpen(false); onSelect(d.key);');
  });

  it('an active folded destination surfaces on the More control itself', () => {
    // The user must never lose their place: More wears the active overflow
    // tab's icon + label and the selected fill.
    expect(switcher).toContain('overflow.find(d => d.key === active)');
    expect(switcher).toContain('activeOverflow ? activeOverflow.label : ');
    expect(switcher).toContain("aria-current={activeOverflow ? 'page' : undefined}");
  });

  it('deep-link resolution still spans ALL destinations, not just promoted ones', () => {
    // ?panel=outputs / ?panel=room must keep working — the full MAIN_TABS
    // list stays the source of truth for key resolution.
    expect(room).toContain("MAIN_TABS.some(t => t.key === panel)");
  });
});
