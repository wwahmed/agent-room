import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RoomQuestion } from '@agent-room/shared';
import { answerOwnerQuestion, createClient, listOwnerQuestions } from '../lib/api.js';
import { partitionQuestions, questionAnswerLabels } from '../lib/questions.js';
import { relativeTime } from '../lib/relativeTime.js';

interface Props {
  code: string;
  isOwner: boolean;
  onPendingChange?: (count: number) => void;
}

export function QuestionsPanel({ code, isOwner, onPendingChange }: Props) {
  const [questions, setQuestions] = useState<RoomQuestion[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [textAnswer, setTextAnswer] = useState('');
  const [loading, setLoading] = useState(isOwner);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (!isOwner) return;
    if (!quiet) setLoading(true);
    try {
      const rows = await listOwnerQuestions(createClient(), code);
      setQuestions(rows);
      setError('');
    } catch (cause) {
      if (!quiet) setError(cause instanceof Error ? cause.message : 'Questions could not be loaded.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [code, isOwner]);

  useEffect(() => {
    if (!isOwner) return;
    void load();
    const timer = window.setInterval(() => { void load(true); }, 5_000);
    return () => window.clearInterval(timer);
  }, [isOwner, load]);

  const { pending, answered } = useMemo(() => partitionQuestions(questions), [questions]);
  useEffect(() => { onPendingChange?.(pending.length); }, [onPendingChange, pending.length]);
  const activeIndex = Math.max(0, pending.findIndex(question => question.id === activeId));
  const active = pending[activeIndex];

  useEffect(() => {
    if (pending.length === 0) {
      setActiveId(null);
      return;
    }
    if (!activeId || !pending.some(question => question.id === activeId)) setActiveId(pending[0]!.id);
  }, [activeId, pending]);

  useEffect(() => {
    setSelected([]);
    setTextAnswer('');
  }, [active?.id]);

  if (!isOwner) {
    return (
      <div className="flex min-h-full items-center justify-center p-6">
        <div className="max-w-sm rounded-2xl border border-border-faint bg-surface-softer p-6 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-accent-tint text-accent" aria-hidden="true">
            <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3.5" y="7" width="9" height="6.5" rx="1.5" /><path d="M5.5 7V5.25a2.5 2.5 0 0 1 5 0V7" /></svg>
          </div>
          <h2 className="text-base font-semibold text-ink">Owner-only questions</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">Agent prompts and owner answers are private to the room owner and participating agents.</p>
        </div>
      </div>
    );
  }

  const canSubmit = Boolean(active && (
    active.mode === 'text' ? textAnswer.trim() : selected.length > 0
  ));

  async function submitAnswer() {
    if (!active || !canSubmit || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const value = active.mode === 'text'
        ? textAnswer.trim()
        : active.mode === 'single'
          ? selected[0]!
          : selected;
      const updated = await answerOwnerQuestion(createClient(), code, active.id, value);
      setQuestions(current => current.map(question => question.id === updated.id ? updated : question));
      setNotice('Answer saved. The asking agent can consume it now.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Answer could not be saved.');
    } finally {
      setSubmitting(false);
    }
  }

  function toggleOption(optionId: string) {
    if (!active) return;
    if (active.mode === 'single') {
      setSelected([optionId]);
      return;
    }
    setSelected(current => current.includes(optionId)
      ? current.filter(id => id !== optionId)
      : [...current, optionId]);
  }

  return (
    <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-ink">Questions</h2>
          <p className="mt-1 text-sm text-ink-soft">A focused decision queue from your agents.</p>
        </div>
        <div className="flex gap-2 text-xs font-semibold">
          <span className="rounded-full bg-accent-tint px-2.5 py-1 text-accent">{pending.length} pending</span>
          <span className="rounded-full bg-surface-softer px-2.5 py-1 text-ink-soft">{answered.length} answered</span>
        </div>
      </div>

      <div aria-live="polite" className="sr-only">{notice || error}</div>
      {error && (
        <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-500">
          <span>{error}</span>
          <button type="button" onClick={() => { void load(); }} className="min-h-9 rounded-lg border border-current px-3 font-semibold">Retry</button>
        </div>
      )}
      {notice && !error && (
        <div role="status" className="mb-4 rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3 text-sm font-medium text-emerald-600">{notice}</div>
      )}

      {loading ? (
        <div role="status" className="rounded-2xl border border-border-faint bg-surface p-8 text-center text-sm text-ink-soft">Loading questions…</div>
      ) : active ? (
        <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm" aria-labelledby={`question-${active.id}`}>
          <div className="border-b border-border-faint bg-surface-softer px-4 py-3 sm:px-6">
            <div className="flex items-center justify-between gap-3 text-xs font-semibold text-ink-soft">
              <span>Question {activeIndex + 1} of {pending.length}</span>
              <span>{active.mode === 'single' ? 'Choose one' : active.mode === 'multiple' ? 'Choose any' : 'Write an answer'}</span>
            </div>
          </div>
          <div className="p-4 sm:p-6">
            <div className="mb-5">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-accent">From {active.createdBy}</div>
              <h3 id={`question-${active.id}`} className="text-lg font-semibold leading-snug text-ink sm:text-xl">{active.prompt}</h3>
              {active.context && <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">{active.context}</p>}
            </div>

            {active.mode === 'text' ? (
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-ink">Your answer</span>
                <textarea
                  value={textAnswer}
                  onChange={event => setTextAnswer(event.target.value)}
                  maxLength={5_000}
                  rows={6}
                  autoFocus
                  className="w-full resize-y rounded-xl border border-border bg-surface-soft p-3 text-base text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-tint"
                  placeholder="Type the direction your agents should follow…"
                />
              </label>
            ) : (
              <fieldset className="space-y-2">
                <legend className="sr-only">{active.mode === 'single' ? 'Choose one answer' : 'Choose one or more answers'}</legend>
                {(active.options ?? []).map(option => {
                  const checked = selected.includes(option.id);
                  return (
                    <label key={option.id} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm font-medium transition ${checked ? 'border-accent bg-accent-tint text-ink' : 'border-border-faint bg-surface-soft text-ink hover:border-border'}`}>
                      <input
                        type={active.mode === 'single' ? 'radio' : 'checkbox'}
                        name={`question-${active.id}`}
                        checked={checked}
                        onChange={() => toggleOption(option.id)}
                        className="h-4 w-4 accent-[var(--color-accent)]"
                      />
                      <span>{option.label}</span>
                    </label>
                  );
                })}
              </fieldset>
            )}

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border-faint pt-4">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setActiveId(pending[Math.max(0, activeIndex - 1)]!.id)}
                  disabled={activeIndex === 0}
                  className="min-h-11 rounded-lg border border-border px-3 text-sm font-semibold text-ink-soft disabled:opacity-40"
                >Previous</button>
                <button
                  type="button"
                  onClick={() => setActiveId(pending[Math.min(pending.length - 1, activeIndex + 1)]!.id)}
                  disabled={activeIndex === pending.length - 1}
                  className="min-h-11 rounded-lg border border-border px-3 text-sm font-semibold text-ink-soft disabled:opacity-40"
                >Next</button>
              </div>
              <button
                type="button"
                onClick={() => { void submitAnswer(); }}
                disabled={!canSubmit || submitting}
                className="min-h-11 rounded-xl bg-accent px-5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >{submitting ? 'Saving…' : 'Submit answer'}</button>
            </div>
          </div>
        </section>
      ) : (
        <div className="rounded-2xl border border-border-faint bg-surface p-8 text-center">
          <div className="text-2xl" aria-hidden="true">✓</div>
          <h3 className="mt-2 text-base font-semibold text-ink">You’re all caught up</h3>
          <p className="mt-1 text-sm text-ink-soft">New agent questions will appear here automatically.</p>
        </div>
      )}

      {answered.length > 0 && (
        <section className="mt-6" aria-labelledby="answered-questions-heading">
          <h3 id="answered-questions-heading" className="mb-3 text-sm font-semibold text-ink">Answered</h3>
          <div className="space-y-2">
            {[...answered].reverse().map(question => (
              <details key={question.id} className="rounded-xl border border-border-faint bg-surface">
                <summary className="cursor-pointer list-none px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-ink">{question.prompt}</div>
                      <div className="mt-0.5 text-xs text-ink-soft">Asked by {question.createdBy}</div>
                    </div>
                    <span className="flex-shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-600">Answered</span>
                  </div>
                </summary>
                <div className="border-t border-border-faint px-4 py-3">
                  <div className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{questionAnswerLabels(question).join(', ')}</div>
                  {question.answer && <div className="mt-2 text-xs text-ink-faint">Saved {relativeTime(question.answer.answeredAt)}</div>}
                </div>
              </details>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
