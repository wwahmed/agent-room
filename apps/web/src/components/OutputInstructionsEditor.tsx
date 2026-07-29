import { useEffect, useMemo, useState } from 'react';

import { MAX_ROOM_OUTPUT_INSTRUCTIONS } from '@agent-room/shared';

interface Props {
  currentOverride?: string;
  defaultInstructions?: string;
  isHost: boolean;
  disabled?: boolean;
  onSave: (nextOverride: string) => Promise<void>;
}

type SaveState = 'saved' | 'unsaved' | 'saving' | 'error';

/**
 * T-47: owner-editable presentation guidance with an honest state model.
 *
 * This deliberately does not look like a hidden "system prompt" editor. The
 * authority boundary, active source, preview, and secret warning are visible at
 * the point of editing; an agent receives the same boundary in its MCP envelope.
 */
export function OutputInstructionsEditor({
  currentOverride = '',
  defaultInstructions = '',
  isHost,
  disabled,
  onSave,
}: Props) {
  const [draft, setDraft] = useState(currentOverride);
  const [persisted, setPersisted] = useState(currentOverride);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [error, setError] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    setDraft(currentOverride);
    setPersisted(currentOverride);
    setSaveState('saved');
    setError('');
  }, [currentOverride]);

  // "Active" must mean persisted and currently delivered to agents. An
  // unsaved draft is intentionally excluded: previewing it under "What agents
  // receive" would lie at the exact moment the editor is trying to be explicit.
  const effective = useMemo(
    () => persisted.trim() || defaultInstructions.trim(),
    [persisted, defaultInstructions],
  );
  const usesDefault = !persisted.trim() && !!defaultInstructions.trim();
  const overLimit = draft.length > MAX_ROOM_OUTPUT_INSTRUCTIONS;

  async function save(next: string) {
    if (next.length > MAX_ROOM_OUTPUT_INSTRUCTIONS) return;
    setSaveState('saving');
    setError('');
    try {
      await onSave(next);
      setDraft(next);
      setPersisted(next);
      setSaveState('saved');
    } catch (e) {
      setSaveState('error');
      setError(e instanceof Error ? e.message : 'Could not save output instructions');
    }
  }

  return (
    <div data-gate="output-instructions-editor">
      <div className="rounded-lg border border-border-faint bg-surface-softer p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[14px] font-semibold text-ink">Agent output instructions</div>
            <div className="mt-0.5 text-[13px] text-ink-soft">
              Active source: <span className="font-semibold text-ink">{usesDefault ? 'Room type default' : persisted.trim() ? 'Owner override' : 'None'}</span>
            </div>
          </div>
          <span
            className={`rounded-full px-2 py-1 text-[12px] font-semibold ${
              saveState === 'error' || overLimit ? 'bg-red-500/10 text-red-400'
                : saveState === 'unsaved' ? 'bg-amber-500/10 text-amber-400'
                  : saveState === 'saving' ? 'bg-accent-tint text-accent'
                    : 'bg-emerald-500/10 text-emerald-400'
            }`}
            role="status"
            aria-live="polite"
          >
            {overLimit ? 'Too long'
              : saveState === 'unsaved' ? 'Unsaved changes'
                : saveState === 'saving' ? 'Saving…'
                  : saveState === 'error' ? 'Save failed'
                    : 'Saved'}
          </span>
        </div>

        <p className="mt-3 text-[13px] leading-relaxed text-ink-soft">
          Presentation guidance only. It cannot override agent roles, room conventions, tool rules, security, or authorization.
          Do not paste secrets, mailbox tokens, credentials, or private customer data.
        </p>

        {isHost ? (
          <>
            <label htmlFor="room-output-instructions" className="mt-3 block text-[13px] font-semibold text-ink">
              Instructions
            </label>
            <textarea
              id="room-output-instructions"
              value={draft}
              disabled={disabled || saveState === 'saving'}
              onChange={(e) => {
                setDraft(e.target.value);
                setSaveState(e.target.value === currentOverride ? 'saved' : 'unsaved');
                setError('');
              }}
              rows={9}
              spellCheck
              placeholder={defaultInstructions ? 'Leave empty to use the room type default.' : 'Describe how agents should present output in this room.'}
              className="mt-1 min-h-44 w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 font-mono text-[13px] leading-relaxed text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-tint disabled:opacity-60"
            />
            <div className="mt-1 flex items-center justify-between gap-3 text-[12px]">
              <span className={`whitespace-nowrap ${overLimit ? 'font-semibold text-red-400' : 'text-ink-faint'}`}>
                {draft.length.toLocaleString()} / {MAX_ROOM_OUTPUT_INSTRUCTIONS.toLocaleString()}
              </span>
              <span className="text-ink-faint">Plain text only; HTML is never executed.</span>
            </div>
            {error && <p className="mt-2 text-[13px] text-red-400" role="alert">{error}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={disabled || saveState !== 'unsaved' || overLimit}
                onClick={() => { void save(draft); }}
                className="min-h-11 rounded-lg bg-accent px-3 text-[13px] font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45 sm:px-4 sm:text-[14px]"
              >
                {saveState === 'saving' ? 'Saving…' : 'Save instructions'}
              </button>
              <button
                type="button"
                disabled={disabled || saveState === 'saving' || (!currentOverride && !draft)}
                onClick={() => { void save(''); }}
                className="min-h-11 rounded-lg border border-border px-3 text-[13px] font-semibold text-ink-soft transition hover:border-border-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-45 sm:px-4 sm:text-[14px]"
              >
                Reset to room type
              </button>
              <button
                type="button"
                onClick={() => setPreviewOpen((open) => !open)}
                aria-expanded={previewOpen}
                className="min-h-11 rounded-lg px-3 text-[14px] font-semibold text-ink-soft transition hover:text-ink"
              >
                {previewOpen ? 'Hide preview' : 'Preview active instructions'}
              </button>
            </div>
          </>
        ) : (
          <p className="mt-3 text-[13px] text-ink-faint">Only the room host can edit these instructions.</p>
        )}
      </div>

      {(previewOpen || !isHost) && (
        <section className="mt-3 overflow-hidden rounded-lg border border-border-faint" aria-label="Active output instructions preview">
          <header className="border-b border-border-faint bg-surface-softer px-3 py-2 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
            What agents receive
          </header>
          {effective ? (
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words bg-surface p-3 text-[13px] leading-relaxed text-ink">{effective}</pre>
          ) : (
            <p className="bg-surface p-3 text-[13px] text-ink-faint">No output instructions are active.</p>
          )}
        </section>
      )}
    </div>
  );
}
