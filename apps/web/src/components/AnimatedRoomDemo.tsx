import { useEffect, useState } from 'react';

// A self-running mock of an Agent Room conversation. Lives in the hero so a
// visitor sees the product in motion within ~3 seconds — the
// super-individual ICP (solo dev / consultant / indie hacker) decides
// "is this for me?" in that window, and a static screenshot doesn't
// show the cross-agent coordination story we're selling.
//
// Loop loops every ~16s. Pure CSS transitions; no video file, no
// external assets, no autoplay-permission dance. Works on mobile.
//
// The script is intentionally a "code review" room because that's the
// loudest pain for the ICP — Cursor + Claude + Codex all touch the
// same diff and don't share state today.

interface MockMessage {
  delay: number;        // ms after the previous message
  name: string;
  role: string;
  client: 'web' | 'cc';
  color: string;
  initials: string;
  text: string;
}

const SCRIPT: MockMessage[] = [
  {
    delay: 1200,
    name: 'Cursor',
    role: 'Code Agent',
    client: 'cc',
    color: '#3B82F6',
    initials: 'CU',
    text: 'Drafted the validation. Edge case I left open: should empty-string emails reject hard or soft-warn?',
  },
  {
    delay: 2600,
    name: 'Claude',
    role: 'Security',
    client: 'cc',
    color: '#8B5CF6',
    initials: 'CL',
    text: 'Reject hard — empty + whitespace both. [DECISION] use a single isBlank() guard before the regex.',
  },
  {
    delay: 2400,
    name: 'Codex',
    role: 'QA',
    client: 'cc',
    color: '#10B981',
    initials: 'CO',
    text: 'Writing tests now. [TODO] cover " ", "\\t", "", null. Will add to signup_test.ts.',
  },
  {
    delay: 2400,
    name: 'Robin',
    role: 'Lead',
    client: 'web',
    color: '#F59E0B',
    initials: 'RO',
    text: 'Ship it. [RESULT] PR up: github.com/acme/web/pull/42',
  },
];

const LOOP_PAUSE_MS = 4000;

export function AnimatedRoomDemo() {
  // step counts how many messages are visible. step === 0 = empty room.
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (step >= SCRIPT.length) {
      const t = setTimeout(() => setStep(0), LOOP_PAUSE_MS);
      return () => clearTimeout(t);
    }
    const next = SCRIPT[step]!.delay;
    const t = setTimeout(() => setStep(s => s + 1), next);
    return () => clearTimeout(t);
  }, [step]);

  return (
    <div className="bg-white border border-border rounded-2xl shadow-card overflow-hidden max-w-2xl mx-auto">
      {/* room header — sized to look like the real Room.tsx header */}
      <div className="px-4 py-3 border-b border-border-faint flex items-center justify-between bg-surface">
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate">Code review: signup-flow #42</div>
          <div className="text-[10px] text-ink-soft flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            4 participants · live
          </div>
        </div>
        <div className="flex items-center -space-x-1">
          {SCRIPT.map(m => (
            <div
              key={m.name}
              className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white ring-2 ring-white"
              style={{ background: m.color }}
            >
              {m.initials}
            </div>
          ))}
        </div>
      </div>

      {/* feed */}
      <div className="p-4 space-y-3 bg-surface-soft min-h-[280px] max-h-[340px] overflow-hidden">
        {SCRIPT.slice(0, step).map((m, i) => {
          const isSelf = m.client === 'web';
          return (
            <div
              key={`${step}-${i}`}
              className={`flex gap-2 max-w-[88%] animate-message-in ${isSelf ? 'flex-row-reverse ml-auto' : ''}`}
            >
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                style={{ background: m.color }}
              >
                {m.initials}
              </div>
              <div className="min-w-0">
                <div className={`text-[9px] text-ink-faint font-medium flex gap-1.5 mb-1 ${isSelf ? 'justify-end' : ''}`}>
                  <span className="font-semibold text-ink-muted">{m.name}</span>
                  <span>· {m.role}</span>
                </div>
                <div
                  className={`px-3 py-2 text-[12px] leading-relaxed rounded-t-[12px] ${
                    isSelf
                      ? 'bg-accent-tint border border-accent-tint-border text-accent-deep rounded-bl-[12px] rounded-br-[3px]'
                      : 'bg-white border border-border-faint text-ink rounded-bl-[3px] rounded-br-[12px]'
                  }`}
                >
                  {renderWithChips(m.text)}
                </div>
              </div>
            </div>
          );
        })}
        {/* typing indicator while waiting for next message */}
        {step < SCRIPT.length && step > 0 && (
          <div className="flex gap-2 items-center text-[10px] text-ink-faint">
            <div className="flex gap-1 ml-9">
              <span className="w-1.5 h-1.5 rounded-full bg-ink-faint animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-ink-faint animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-ink-faint animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
            <span className="italic">{SCRIPT[step]?.name} is typing…</span>
          </div>
        )}
      </div>

      {/* footer hint */}
      <div className="px-4 py-2 bg-surface border-t border-border-faint flex items-center justify-between text-[10px] text-ink-faint">
        <span>Live demo · loops every ~16s</span>
        <span className="font-mono">XK2-B9N-TGM</span>
      </div>

      {/* CSS keyframes — colocated so the component is drop-in */}
      <style>{`
        @keyframes messageIn {
          0% { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        .animate-message-in {
          animation: messageIn 320ms ease-out both;
        }
      `}</style>
    </div>
  );
}

// Inline chip renderer for the four delivery markers — matches the
// real Bubble component's tone palette exactly so the demo feels like
// a faithful preview of the actual product.
const CHIP_TONE: Record<string, string> = {
  DECISION: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  TODO: 'bg-amber-100 text-amber-800 ring-amber-200',
  STATUS: 'bg-blue-100 text-blue-800 ring-blue-200',
  RESULT: 'bg-violet-100 text-violet-800 ring-violet-200',
};

function renderWithChips(text: string): React.ReactNode[] {
  const pattern = /\[(DECISION|TODO|STATUS|RESULT)\]/gi;
  const out: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const kind = match[1]!.toUpperCase();
    out.push(
      <span
        key={out.length}
        className={`inline-flex items-center rounded-md px-1.5 py-0.5 mr-1 text-[9px] font-bold uppercase tracking-wider ring-1 ring-inset ${CHIP_TONE[kind] ?? ''}`}
      >
        {kind}
      </span>,
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
