import { canonicalizeCode, isValidCode } from '@agent-room/shared';

interface Props {
  value: string;                          // free text as typed (word or legacy code)
  onChange: (value: string) => void;      // fires on every keystroke
  onComplete?: (canonical: string) => void; // fires with the canonical code once valid
}

// T-47: room codes are now human-friendly words (door-cat-hall) as well as the
// legacy alphanumeric (D64-2UJ-FNR). Both are variable-shaped and
// separator-tolerant, so the old fixed 3×3 per-character grid no longer fits —
// this is a single field that accepts either format in any case, validates via
// the shared parser, and reports the canonical form (words → lower, legacy →
// UPPER) so existing rooms keep resolving.
export function CodeInput({ value, onChange, onComplete }: Props) {
  const valid = isValidCode(value);

  function handle(v: string) {
    onChange(v);
    if (isValidCode(v)) {
      const canonical = canonicalizeCode(v);
      if (canonical) onComplete?.(canonical);
    }
  }

  return (
    <input
      value={value}
      onChange={(e) => handle(e.target.value)}
      autoCapitalize="none"
      autoCorrect="off"
      autoComplete="off"
      spellCheck={false}
      inputMode="text"
      placeholder="door-cat-hall"
      aria-label="Room code"
      className={`w-full rounded-lg border px-4 py-3 text-center font-mono text-lg tracking-wide outline-none transition ${
        value && !valid
          ? 'border-red-400/60 text-red-300'
          : valid
          ? 'border-accent text-accent ring-4 ring-accent-tint'
          : 'border-border bg-surface-sunken text-ink'
      }`}
    />
  );
}
