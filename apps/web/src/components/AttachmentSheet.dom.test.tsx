// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { useRef, useState } from 'react';
import { AttachmentSheet } from './AttachmentSheet.js';

// T-80: dismissal state machine. The host's live defect was a chooser whose
// ONLY close path was a successful file selection; every exit here must be
// real, close must precede the native-picker launch, and reopening must
// yield exactly one surface with focus returning to the trigger.

function Harness({ log }: { log: string[] }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={triggerRef} onClick={() => setOpen(v => !v)} aria-label="Add photos or files">clip</button>
      <AttachmentSheet
        open={open}
        onClose={() => { log.push('close'); setOpen(false); }}
        onPickImages={() => log.push('launch-images')}
        onPickFiles={() => log.push('launch-files')}
        returnFocusRef={triggerRef}
      />
    </>
  );
}

function mount() {
  const log: string[] = [];
  const utils = render(<Harness log={log} />);
  const trigger = document.querySelector<HTMLButtonElement>('[aria-label="Add photos or files"]')!;
  fireEvent.click(trigger);
  return { ...utils, log, trigger };
}

const sheet = () => document.querySelector('[role="dialog"][aria-label="Add attachment"]');

afterEach(() => cleanup());

describe('AttachmentSheet dismissal state machine', () => {
  it('opens with title, two pick rows, and an explicit Cancel; focus enters the first row', () => {
    mount();
    const d = sheet()!;
    expect(d.textContent).toContain('Add attachment');
    expect(d.textContent).toContain('Photos & images');
    expect(d.textContent).toContain('Files & documents');
    expect(d.textContent).toContain('Cancel');
    expect(document.activeElement?.textContent).toContain('Photos & images');
  });

  it('CLOSES BEFORE the native picker launches, on both rows', () => {
    const a = mount();
    fireEvent.click([...sheet()!.querySelectorAll('button')].find(b => b.textContent?.includes('Photos'))!);
    expect(a.log).toEqual(['close', 'launch-images']); // order is the fix
    expect(sheet()).toBeNull(); // a cancelled OS picker returns to no sheet
    fireEvent.click(a.trigger);
    fireEvent.click([...sheet()!.querySelectorAll('button')].find(b => b.textContent?.includes('Files'))!);
    expect(a.log.slice(2)).toEqual(['close', 'launch-files']);
    expect(sheet()).toBeNull();
  });

  it('Cancel, Escape, outside pointer, and backdrop each close it; focus returns to the paperclip', () => {
    const a = mount();
    fireEvent.click([...sheet()!.querySelectorAll('button')].find(b => b.textContent === 'Cancel')!);
    expect(sheet()).toBeNull();
    expect(document.activeElement).toBe(a.trigger);

    fireEvent.click(a.trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(sheet()).toBeNull();
    expect(document.activeElement).toBe(a.trigger);

    fireEvent.click(a.trigger);
    fireEvent.mouseDown(document.body); // outside tap
    expect(sheet()).toBeNull();
    expect(document.activeElement).toBe(a.trigger);
  });

  it('Android Back (popstate) closes it without resurrecting', () => {
    const a = mount();
    expect(sheet()).not.toBeNull();
    fireEvent.popState(window);
    expect(sheet()).toBeNull();
    expect(a.log).toEqual(['close']);
    expect(document.activeElement).toBe(a.trigger);
  });

  it('repeated open/close yields exactly one surface and no duplicated listener effects', () => {
    const a = mount();
    for (let i = 0; i < 3; i++) {
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(a.log.filter(e => e === 'close')).toHaveLength(i + 1); // ONE close per Escape
      expect(sheet()).toBeNull();
      fireEvent.click(a.trigger);
      expect(document.querySelectorAll('[role="dialog"][aria-label="Add attachment"]')).toHaveLength(1);
    }
  });
});
