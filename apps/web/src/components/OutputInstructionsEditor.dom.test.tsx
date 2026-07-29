// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { OutputInstructionsEditor } from './OutputInstructionsEditor.js';

afterEach(() => cleanup());

describe('OutputInstructionsEditor', () => {
  it('shows source, authority boundary, unsaved state, preview, and successful save', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <OutputInstructionsEditor
        currentOverride=""
        defaultInstructions="Template guidance"
        isHost
        onSave={onSave}
      />,
    );
    expect(screen.getByText('Room type default')).toBeTruthy();
    expect(screen.getByText(/cannot override agent roles/i)).toBeTruthy();
    expect(screen.getByText(/Do not paste secrets/i)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Instructions'), { target: { value: 'Owner guidance' } });
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    fireEvent.click(screen.getByText('Preview active instructions'));
    const preview = screen.getByRole('region', { name: 'Active output instructions preview' });
    expect(preview.textContent).toContain('Template guidance');
    expect(preview.textContent).not.toContain('Owner guidance');
    fireEvent.click(screen.getByText('Save instructions'));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('Owner guidance'));
    expect(screen.getByText('Saved')).toBeTruthy();
    expect(preview.textContent).toContain('Owner guidance');
  });

  it('surfaces a failed save without losing the draft', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('Host credential expired'));
    render(<OutputInstructionsEditor isHost onSave={onSave} />);
    fireEvent.change(screen.getByLabelText('Instructions'), { target: { value: 'Keep this draft' } });
    fireEvent.click(screen.getByText('Save instructions'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Host credential expired'));
    expect((screen.getByLabelText('Instructions') as HTMLTextAreaElement).value).toBe('Keep this draft');
    expect(screen.getByText('Save failed')).toBeTruthy();
  });

  it('is read-only for non-hosts and previews the effective instructions', () => {
    render(
      <OutputInstructionsEditor
        currentOverride="Owner guidance"
        defaultInstructions="Template guidance"
        isHost={false}
        onSave={vi.fn()}
      />,
    );
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText(/Only the room host can edit/i)).toBeTruthy();
    expect(screen.getByText('Owner guidance')).toBeTruthy();
  });
});
