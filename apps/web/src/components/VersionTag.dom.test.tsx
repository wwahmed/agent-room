// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VersionTag } from './VersionTag.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('immutable release provenance', () => {
  it('shows the whole server+web release id, not only the frontend chunk', async () => {
    const json = vi.fn().mockResolvedValue({
      bundle: 'WebChunk123',
      release: 'bc6147157987583d89a7d3ac154a1da028c36c99a2f222884ae32ab2e71d47b6',
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json }));

    render(<VersionTag />);

    await waitFor(() => {
      const tag = screen.getByText('release bc6147157987');
      expect(tag.title).toContain('Immutable release bc6147157987583d');
      expect(tag.title).toContain('web bundle WebChunk123');
    });
  });

  it('keeps the legacy bundle id as a safe fallback against an older server', async () => {
    const json = vi.fn().mockResolvedValue({ bundle: 'LegacyChunk' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json }));

    render(<VersionTag />);

    await waitFor(() => {
      expect(screen.getByText('release LegacyChunk')).toBeTruthy();
    });
  });
});
