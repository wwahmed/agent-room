import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const room = readFileSync(new URL('./Room.tsx', import.meta.url), 'utf8');
const messageMenu = readFileSync(new URL('../components/MessageMenu.tsx', import.meta.url), 'utf8');
const messageRow = readFileSync(new URL('../components/MessageRow.tsx', import.meta.url), 'utf8');

describe('phone action targets', () => {
  it('keeps every message-menu row at least 44px tall', () => {
    expect(messageMenu).toContain(
      "const itemClass = 'flex min-h-11 w-full items-center",
    );
  });

  it('does not create a phone-width overflow with a negative-margin hit box', () => {
    expect(messageMenu).toContain('className={`flex h-11 w-11 items-center');
    expect(messageMenu).not.toContain('-m-2.5 flex min-h-11 min-w-11');
    expect(messageRow).toContain('className="absolute right-0 top-0 sm:hidden"');
    expect(messageRow).toContain('max-w-[42%] shrink-0 truncate sm:max-w-[60%]');
  });

  it('gives reply cancellation and attachment removal 44px hit boxes', () => {
    expect(room).toContain('aria-label="Cancel reply"');
    expect(room).toContain(
      'className="flex min-h-11 min-w-11 flex-shrink-0 items-center justify-center rounded-md',
    );
    expect(room).toContain('aria-label={`Remove ${attachment.name}`}');
    expect(room).toContain(
      'className="flex min-h-11 min-w-11 items-center justify-center rounded text-sm',
    );
  });
});
