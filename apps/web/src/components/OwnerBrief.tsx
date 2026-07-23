import { useRef, useState } from 'react';
import type { BriefLine } from '@agent-room/shared';

// T-134: the on-demand owner executive brief. A "Brief" control opens a small
// panel that fetches /api/brief (assembled server-side from real messages + the
// account read marker + the board — never invented) and renders the five lines.
// The speaker plays the EXACT shown text via local TTS (/api/tts): the string
// sent to speech is the same lines the eye reads, so spoken and shown never
// diverge.
export function OwnerBrief({ code, selfName }: { code: string; selfName: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lines, setLines] = useState<BriefLine[] | null>(null);
  const [speech, setSpeech] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  async function loadBrief() {
    setOpen(true);
    setLoading(true);
    setError(null);
    setLines(null);
    setSpeech('');
    try {
      const r = await fetch(`/api/brief?code=${encodeURIComponent(code)}&self=${encodeURIComponent(selfName)}`, { credentials: 'same-origin' });
      if (!r.ok) throw new Error(`brief ${r.status}`);
      const body = (await r.json()) as { lines?: BriefLine[]; speech?: string };
      setLines(body.lines ?? []);
      setSpeech(body.speech ?? '');
    } catch {
      setError('Could not load your brief. Try again.');
    } finally {
      setLoading(false);
    }
  }

  function stopSpeaking() {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    setSpeaking(false);
  }

  async function speak() {
    if (!speech || speaking) { stopSpeaking(); return; }
    setSpeaking(true);
    try {
      const r = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // The exact text the eye reads — spoken == shown by construction.
        body: JSON.stringify({ text: speech }),
        credentials: 'same-origin',
      });
      if (!r.ok) throw new Error(`tts ${r.status}`);
      const url = URL.createObjectURL(await r.blob());
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => { setSpeaking(false); URL.revokeObjectURL(url); audioRef.current = null; };
      await audio.play();
    } catch {
      setSpeaking(false);
      setError('Could not play the brief.');
    }
  }

  function close() {
    stopSpeaking();
    setOpen(false);
  }

  return (
    <div className="relative flex-shrink-0">
      <button
        type="button"
        onClick={() => (open ? close() : loadBrief())}
        aria-label="Brief me — what changed since you last looked"
        title="Brief me"
        aria-expanded={open}
        className="header-glass-control flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold text-ink-soft transition hover:text-ink"
      >
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 3.5h10M3 8h10M3 12.5h6" />
        </svg>
        <span className="hidden sm:inline">Brief</span>
      </button>

      {open && (
        <div
          data-gate="owner-brief"
          role="dialog"
          aria-label="Your brief"
          className="absolute right-0 top-12 z-40 w-[min(92vw,22rem)] rounded-xl border border-border bg-surface p-3 shadow-xl"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[13px] font-bold text-ink">Since you last looked</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={speak}
                disabled={!speech || loading}
                aria-label={speaking ? 'Stop playback' : 'Play brief aloud'}
                title={speaking ? 'Stop' : 'Play aloud'}
                className="flex h-8 w-8 items-center justify-center rounded-full text-ink-soft transition hover:bg-surface-softer hover:text-accent disabled:opacity-40"
              >
                {speaking ? (
                  <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1" /></svg>
                ) : (
                  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M8 3 4.5 6H2v4h2.5L8 13V3Z" /><path d="M11 6.2a2.5 2.5 0 0 1 0 3.6M12.8 4.5a5 5 0 0 1 0 7" />
                  </svg>
                )}
              </button>
              <button type="button" onClick={close} aria-label="Close brief" className="flex h-8 w-8 items-center justify-center rounded-full text-ink-faint transition hover:bg-surface-softer hover:text-ink">
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
              </button>
            </div>
          </div>
          {loading && <p className="text-[13px] text-ink-soft">Reading the room…</p>}
          {error && <p role="alert" className="text-[13px] font-semibold text-red-400">{error}</p>}
          {lines && (
            <ul className="space-y-1.5">
              {lines.map((l, i) => (
                <li key={i} data-gate="brief-line" className="flex gap-2 text-[13px] leading-snug text-ink">
                  <span aria-hidden="true" className={`mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full ${l.kind === 'needs' ? 'bg-amber-400' : l.kind === 'none' ? 'bg-ink-faint' : 'bg-accent'}`} />
                  <span>{l.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
