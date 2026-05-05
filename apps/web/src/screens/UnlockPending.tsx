import { Link, useSearchParams } from 'react-router-dom';

// Stripe redirects here after a successful Payment Link checkout. We
// don't yet do a webhook → email-the-unlock-URL flow (pilot phase
// stays manual), so this page just tells the customer "we got it,
// unlock URL is on its way to your email" and gives them a way to
// reach support if it doesn't show up.
//
// Stripe appends `?session_id=cs_test_...` (or cs_live_... in
// production) and our `?client_reference_id=ROOMCODE` is preserved
// on the redirect, so we can show the customer which room they paid
// for as a reassurance.
export function UnlockPending() {
  const [params] = useSearchParams();
  const roomCode = params.get('client_reference_id') ?? params.get('code') ?? null;
  const sessionId = params.get('session_id');

  return (
    <div className="min-h-screen bg-gradient-to-br from-accent-tint via-white to-amber-50 flex items-center justify-center px-6 py-16">
      <div className="max-w-lg bg-white border border-border rounded-2xl shadow-card p-10 text-center">
        <div className="text-5xl mb-4">📨</div>
        <h1 className="text-2xl font-bold tracking-tight mb-3">Payment received — unlock URL on its way</h1>
        <p className="text-base text-ink-soft leading-relaxed mb-6">
          Thanks for supporting Agent Room. Your unlock URL will arrive at the email you entered at checkout, as soon as we can during early access.
        </p>

        {roomCode && (
          <div className="rounded-lg bg-surface-soft border border-border-faint px-4 py-3 mb-6 text-sm">
            <div className="text-[11px] font-semibold text-ink-faint uppercase tracking-wider mb-1">Room being unlocked</div>
            <div className="font-mono font-bold text-ink">{roomCode}</div>
          </div>
        )}

        <div className="text-left space-y-3 text-sm text-ink-muted mb-8">
          <p><strong>What happens next:</strong></p>
          <ol className="list-decimal pl-5 space-y-1">
            <li>You'll receive an email with the title <em>"Your Agent Room report is unlocked"</em>.</li>
            <li>It contains a permanent URL — <code className="bg-surface-softer px-1 rounded text-[11px]">/report?unlock=...</code> — open it once to remove the watermark.</li>
            <li>The unlock persists in your browser; share the original report URL with your client and it stays clean.</li>
          </ol>
        </div>

        <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-900 mb-6">
          If your unlock URL hasn't arrived after a few hours, reply to your Stripe receipt or email <a href="mailto:hello@agent-room.com" className="font-semibold underline">hello@agent-room.com</a>{roomCode ? ` with your room code (${roomCode})` : ''}.
        </div>

        <div className="flex flex-col sm:flex-row gap-2 justify-center">
          {roomCode && (
            <Link
              to={`/r/${roomCode}/report`}
              className="inline-flex items-center justify-center bg-accent text-white px-5 py-2.5 rounded-lg text-sm font-semibold hover:opacity-90 transition"
            >
              Back to your report
            </Link>
          )}
          <Link
            to="/"
            className="inline-flex items-center justify-center bg-white border border-border px-5 py-2.5 rounded-lg text-sm font-semibold text-ink-muted hover:bg-surface-soft transition"
          >
            Home
          </Link>
        </div>

        {sessionId && (
          <p className="text-[10px] text-ink-faint mt-6">
            Stripe session: <code className="font-mono">{sessionId.slice(0, 24)}…</code>
          </p>
        )}
      </div>
    </div>
  );
}
