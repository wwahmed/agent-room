import { useEffect, useRef, useState } from 'react';
import type { RoomQuestion } from '@agent-room/shared';
import { answerOwnerQuestion, createClient, listOwnerQuestions } from '../lib/api.js';
import { questionAnswerLabels } from '../lib/questions.js';

const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

interface Props {
  code: string;
  questionId: string;
  isOwner: boolean;
  onClose: () => void;
  onAnswered: (question: RoomQuestion) => void;
}

export function QuestionArtifactSheet({ code, questionId, isOwner, onClose, onAnswered }: Props) {
  const [question, setQuestion] = useState<RoomQuestion | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [textAnswer, setTextAnswer] = useState('');
  const [loading, setLoading] = useState(isOwner);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // T-46: real modal behavior — Escape closes, Tab cycles INSIDE the sheet,
  // and focus returns to whatever opened it. Matches the T-36 lightbox.
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { onClose(); return; }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      returnFocus?.focus();
    };
  }, [onClose]);

  useEffect(() => {
    if (!isOwner) return;
    let cancelled = false;
    (async () => {
      try {
        const questions = await listOwnerQuestions(createClient(), code);
        if (!cancelled) {
          setQuestion(questions.find(item => item.id === questionId) ?? null);
          setError(questions.some(item => item.id === questionId) ? '' : 'This question artifact is no longer available.');
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Question artifact could not be loaded.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [code, isOwner, questionId]);

  const canSubmit = Boolean(question && !question.answer && (
    question.mode === 'text' ? textAnswer.trim() : selected.length > 0
  ));

  async function submit() {
    if (!question || !canSubmit || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const value = question.mode === 'text'
        ? textAnswer.trim()
        : question.mode === 'single'
          ? selected[0]!
          : selected;
      const answered = await answerOwnerQuestion(createClient(), code, question.id, value);
      setQuestion(answered);
      onAnswered(answered);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Answer could not be saved.');
    } finally {
      setSubmitting(false);
    }
  }

  function toggle(optionId: string) {
    if (!question) return;
    if (question.mode === 'single') setSelected([optionId]);
    else setSelected(current => current.includes(optionId) ? current.filter(id => id !== optionId) : [...current, optionId]);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-labelledby="question-artifact-title">
      <button type="button" className="absolute inset-0 bg-black/55" onClick={onClose} aria-label="Close question artifact" />
      <section ref={dialogRef} className="relative z-10 flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-border bg-surface shadow-2xl sm:rounded-2xl">
        <header className="flex items-center justify-between gap-3 border-b border-border-faint px-4 py-3 sm:px-6">
          <div>
            <div className="text-[13px] font-semibold uppercase tracking-wide text-accent">Question artifact</div>
            <h2 id="question-artifact-title" className="mt-0.5 text-lg font-semibold text-ink">Owner decision document</h2>
          </div>
          <button type="button" onClick={onClose} autoFocus={!isOwner} className="flex h-11 w-11 items-center justify-center rounded-full text-ink-soft hover:bg-surface-softer" aria-label="Close"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="m4 4 8 8M12 4l-8 8" /></svg></button>
        </header>

        <div className="overflow-y-auto p-4 sm:p-6">
          {!isOwner ? (
            <div className="py-8 text-center">
              <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-accent-tint text-accent" aria-hidden="true">🔒</div>
              <h3 className="font-semibold text-ink">Owner-only artifact</h3>
              <p className="mx-auto mt-2 max-w-sm text-base leading-relaxed text-ink-soft">The inline card is visible to the room, but its prompt and answer are available only to the authenticated owner and participating agents.</p>
            </div>
          ) : loading ? (
            <div role="status" className="flex flex-col items-center gap-3 py-10 text-base font-medium text-ink-soft"><span className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-accent" aria-hidden="true" />Loading artifact…</div>
          ) : question ? (
            <>
              <div className="mb-5 flex items-center justify-between gap-3">
                <span className={`rounded-full px-2.5 py-1 text-sm font-semibold ${question.answer ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600'}`}>{question.answer ? 'Completed' : 'Pending'}</span>
                <span className="text-sm text-ink-faint">Created by {question.createdBy}</span>
              </div>
              <h3 className="text-xl font-semibold leading-snug text-ink">{question.prompt}</h3>
              {question.context && <p className="mt-3 whitespace-pre-wrap text-base leading-relaxed text-ink-soft">{question.context}</p>}

              {question.answer ? (
                <div className="mt-6 rounded-xl border border-emerald-400/25 bg-emerald-500/10 p-4">
                  <div className="text-[13px] font-semibold uppercase tracking-wide text-emerald-600">Owner answer</div>
                  <div className="mt-2 whitespace-pre-wrap text-base font-medium text-ink">{questionAnswerLabels(question).join(', ')}</div>
                </div>
              ) : question.mode === 'text' ? (
                <label className="mt-6 block">
                  <span className="mb-2 block text-base font-semibold text-ink">Your answer</span>
                  <textarea value={textAnswer} onChange={event => setTextAnswer(event.target.value)} maxLength={5_000} rows={6} autoFocus className="w-full resize-y rounded-xl border border-border bg-surface-soft p-3 text-base text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent-tint" />
                </label>
              ) : (
                <fieldset className="mt-6 space-y-2">
                  <legend className="mb-2 text-base font-semibold text-ink">{question.mode === 'single' ? 'Choose one' : 'Choose one or more'}</legend>
                  {(question.options ?? []).map(option => {
                    const checked = selected.includes(option.id);
                    return <label key={option.id} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border p-3 text-base font-medium ${checked ? 'border-accent bg-accent-tint text-ink' : 'border-border-faint bg-surface-soft text-ink'}`}><input type={question.mode === 'single' ? 'radio' : 'checkbox'} name={`question-${question.id}`} checked={checked} onChange={() => toggle(option.id)} className="h-4 w-4" /><span>{option.label}</span></label>;
                  })}
                </fieldset>
              )}

              {error && <div role="alert" className="mt-4 rounded-xl bg-red-500/10 p-3 text-sm text-red-500">{error}</div>}
              {!question.answer && <button type="button" onClick={() => { void submit(); }} disabled={!canSubmit || submitting} className="mt-6 min-h-11 w-full rounded-xl bg-accent px-5 text-sm font-semibold text-white disabled:opacity-40">{submitting ? 'Saving…' : 'Complete artifact'}</button>}
            </>
          ) : (
            <div role="alert" className="py-10 text-center text-sm text-red-500">{error || 'Question artifact not found.'}</div>
          )}
        </div>
      </section>
    </div>
  );
}
