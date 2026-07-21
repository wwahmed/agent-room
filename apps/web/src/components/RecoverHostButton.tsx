import { useState } from 'react';
import { createClient, recoverHost } from '../lib/api.js';
import { showToast } from './Toast.js';

// T-45 / T-36: phone-friendly one-tap host recovery, so Waqas never needs the
// JS console. The Access cookie proves it's him; the server migrates the
// orphaned host identity onto his keyed session. Two-tap guard: the first tap
// arms "Tap again to confirm", the second runs it (auto-disarms after a few
// seconds so a stray tap can't stay armed). recoverHost() stores the returned
// hostKey — it is never rendered here — and we toast a plain confirmation.
type State = 'idle' | 'confirming' | 'working';

export function RecoverHostButton({ code }: { code: string }) {
  const [state, setState] = useState<State>('idle');

  async function run() {
    setState('working');
    try {
      const { migrated } = await recoverHost(createClient(), code);
      showToast(migrated > 0 ? `Host access recovered ✓ (${migrated} updated)` : 'Host access recovered ✓');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Recovery failed';
      showToast(`Host recovery failed: ${msg}`, 'error');
    } finally {
      setState('idle');
    }
  }

  function onClick() {
    if (state === 'working') return;
    if (state === 'idle') {
      setState('confirming');
      window.setTimeout(() => setState((s) => (s === 'confirming' ? 'idle' : s)), 4000);
      return;
    }
    void run();
  }

  const label =
    state === 'working' ? 'Recovering…' : state === 'confirming' ? 'Tap again to confirm' : 'Recover host access';

  return (
    // T-71 Lifecycle ruling: recovery is a compact outlined SECONDARY —
    // it must never read as the page's second primary.
    <button
      type="button"
      onClick={onClick}
      disabled={state === 'working'}
      aria-label="Recover host access"
      className={`flex min-h-11 w-fit items-center rounded-lg border px-4 text-sm font-semibold transition disabled:opacity-60 ${
        state === 'confirming'
          ? 'border-accent bg-accent text-white'
          : 'border-border text-ink-soft hover:border-accent hover:text-accent'
      }`}
    >
      {label}
    </button>
  );
}
