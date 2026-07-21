// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { useRef, useState } from 'react';
import { AttachmentSheet } from './AttachmentSheet.js';

// T-80: dismissal state machine on the NATIVE <dialog> architecture. The
// host's live defect was a chooser whose ONLY close path was a successful
// file selection. Every exit here must be real, close must precede the
// native-picker launch in the same gesture, and reopening must yield
// exactly one surface with focus returning to the trigger. Top-layer
// behaviors jsdom cannot model (inert background, Android close request)
// are exercised through the dialog's cancel/close events and verified
// physically on the host's phone.

function Harness({ log }: { log: string[] }) {
  const [open, setOpen] = useState(false);
  const [, setTick] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button onClick={() => setTick(t => t + 1)} aria-label="rerender">tick</button>
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

const sheet = () => document.querySelector<HTMLDialogElement>('dialog[aria-label="Add attachment"]');

afterEach(() => cleanup());

describe('AttachmentSheet dismissal state machine (native dialog)', () => {
  it('opens a real <dialog> with title, two pick rows, and an explicit Cancel', () => {
    mount();
    const d = sheet()!;
    expect(d.tagName).toBe('DIALOG');
    expect(d.open).toBe(true);
    expect(d.textContent).toContain('Add attachment');
    expect(d.textContent).toContain('Photos & images');
    expect(d.textContent).toContain('Files & documents');
    expect(d.textContent).toContain('Cancel');
  });

  it('CLOSES BEFORE the native picker launches, on both rows, same gesture stack', () => {
    const a = mount();
    fireEvent.click([...sheet()!.querySelectorAll('button')].find(b => b.textContent?.includes('Photos'))!);
    expect(a.log).toEqual(['close', 'launch-images']); // order is the fix
    expect(sheet()).toBeNull(); // a cancelled OS picker returns to no sheet
    fireEvent.click(a.trigger);
    fireEvent.click([...sheet()!.querySelectorAll('button')].find(b => b.textContent?.includes('Files'))!);
    expect(a.log.slice(2)).toEqual(['close', 'launch-files']);
    expect(sheet()).toBeNull();
  });

  it('explicit Cancel closes and focus returns to the paperclip', () => {
    const a = mount();
    fireEvent.click([...sheet()!.querySelectorAll('button')].find(b => b.textContent === 'Cancel')!);
    expect(sheet()).toBeNull();
    expect(document.activeElement).toBe(a.trigger);
  });

  it('the dialog cancel event (Escape / Android close request) closes it', () => {
    const a = mount();
    fireEvent(sheet()!, new Event('cancel'));
    expect(sheet()).toBeNull();
    expect(a.log).toEqual(['close']);
    expect(document.activeElement).toBe(a.trigger);
  });

  it('backdrop click (target === dialog) closes; inside clicks never dismiss', () => {
    mount();
    const d = sheet()!;
    fireEvent.click(d.querySelector('div')!); // inside the padded panel
    expect(sheet()).not.toBeNull();
    fireEvent.click(d); // ::backdrop reports the dialog itself as target
    expect(sheet()).toBeNull();
  });

  it('parent re-renders while open do NOT re-arm the lifecycle', () => {
    // Room re-renders continuously from polling and recreates onClose every
    // time; the effect must key on `open` alone or the dialog would close
    // and re-open (focus churn) each render.
    const a = mount();
    const d = sheet()!;
    const tick = document.querySelector<HTMLButtonElement>('[aria-label="rerender"]')!;
    fireEvent.click(tick);
    fireEvent.click(tick);
    fireEvent.click(tick);
    expect(sheet()).toBe(d); // same element instance, still open
    expect(sheet()!.open).toBe(true);
    expect(a.log).toEqual([]); // no phantom closes
  });

  it('repeated open/close yields exactly one surface each time', () => {
    const a = mount();
    for (let i = 0; i < 3; i++) {
      fireEvent(sheet()!, new Event('cancel'));
      expect(a.log.filter(e => e === 'close')).toHaveLength(i + 1); // ONE close per cancel
      expect(sheet()).toBeNull();
      fireEvent.click(a.trigger);
      expect(document.querySelectorAll('dialog[aria-label="Add attachment"]')).toHaveLength(1);
    }
  });
});
