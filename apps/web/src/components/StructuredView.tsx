import { useState } from 'react';

import { extractViewBlock, parseStructuredView, type StructuredView, type ViewAction } from '@agent-room/shared';

import { CollapsibleMessageBody } from './CollapsibleMessageBody.js';

// T-46: renders an agent's structured view with FIRST-PARTY components.
//
// Every string below reaches the DOM as a React child, which escapes it. There is
// no dangerouslySetInnerHTML anywhere in this file and there must never be: the
// entire safety argument of the fluid interface is that model output is data, so a
// `<script>` in a subject line is an ugly subject line and nothing more.
//
// Actions are declarative too. An agent may say "offer a button labelled Reply
// with id reply-42"; it cannot say what the button does. Pressing one sends a
// normal room message naming that id, so the agent's next turn decides — the loop
// stays conversational and the app never executes an instruction it was handed.

interface Props {
  view: StructuredView;
  /** Sends a plain room message on the user's behalf. Undefined in read-only
   *  contexts (history, exports), where actions render disabled rather than
   *  vanishing — a button that silently does nothing is worse than a visibly
   *  unavailable one. */
  onAction?: (action: ViewAction) => void | Promise<void>;
}

const CARD = 'my-1 overflow-hidden rounded-xl border border-border bg-surface';
const HEAD = 'border-b border-border-faint px-3 py-2 text-[13px] font-semibold text-ink';
const LABEL = 'text-[12px] font-semibold uppercase tracking-wide text-ink-faint';

function Actions({ actions, onAction }: { actions?: ViewAction[]; onAction?: Props['onAction'] }) {
  // T-46 rev2: a verifier pointed out that "Archive" reads like the app archiving
  // something, when in fact pressing it only ASKS the agent to. The button now says
  // what it does, and once pressed it stays pressed — an action fires once, and a
  // second click cannot replay it.
  // Pending -> Requested / Failed. A local one-shot flag is not a loading state:
  // the earlier version latched the button on click and never came back, so a
  // server rejection left it permanently dead with no way to retry and no sign
  // anything had gone wrong.
  const [state, setState] = useState<Record<string, 'pending' | 'done' | 'failed'>>({});
  if (!actions?.length) return null;
  const mark = (id: string, s: 'pending' | 'done' | 'failed') =>
    setState(prev => ({ ...prev, [id]: s }));
  return (
    <div className="border-t border-border-faint px-3 py-2" data-gate="view-actions">
      <div className="flex flex-wrap gap-2">
        {actions.map(a => {
          const st = state[a.id];
          const busyOrDone = st === 'pending' || st === 'done';
          return (
            <button
              key={a.id}
              type="button"
              disabled={!onAction || busyOrDone}
              aria-disabled={!onAction || busyOrDone}
              aria-busy={st === 'pending'}
              onClick={() => {
                if (!onAction || busyOrDone) return;
                mark(a.id, 'pending');
                // A rejected request must re-enable the button — the server can
                // refuse (already requested, source gone, invalid action) and the
                // user has to be able to see that and try again.
                void Promise.resolve(onAction(a))
                  .then(() => mark(a.id, 'done'))
                  .catch(() => mark(a.id, 'failed'));
              }}
              title={onAction ? `Ask the agent to: ${a.label}` : 'Actions are unavailable here'}
              className={`min-h-11 rounded-lg border px-3 text-[13px] font-semibold transition disabled:opacity-40 ${
                st === 'failed' ? 'border-red-400/60 text-red-300' : 'border-border text-ink hover:border-accent'}`}
            >
              {st === 'pending' ? `Requesting: ${a.label}…`
                : st === 'done' ? `Requested: ${a.label}`
                : st === 'failed' ? `Failed — retry: ${a.label}`
                : a.label}
            </button>
          );
        })}
      </div>
      {/* Says the true effect once, rather than implying each button acts. */}
      <p className="mt-1.5 text-[12px] text-ink-faint">These ask the agent to act — they do not act themselves.</p>
    </div>
  );
}

export function StructuredViewCard({ view, onAction }: Props) {
  if (view.kind === 'list') {
    return (
      <section className={CARD} data-gate="view-list" aria-label={view.title || 'List'}>
        {view.title && <header className={HEAD}>{view.title}</header>}
        {view.items.length === 0 ? (
          <p className="px-3 py-4 text-center text-[13px] text-ink-faint">{view.empty || 'Nothing to show.'}</p>
        ) : (
          <ul className="divide-y divide-border-faint" role="list">
            {view.items.map(item => (
              <li key={item.id} className="px-3 py-2" role="listitem">
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">{item.title}</span>
                  {item.meta && <span className="flex-shrink-0 text-[12px] tabular-nums text-ink-faint">{item.meta}</span>}
                </div>
                {item.subtitle && <div className="truncate text-[13px] text-ink-soft">{item.subtitle}</div>}
                {item.badges?.length ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {item.badges.map((b, i) => (
                      <span key={`${item.id}-b${i}`} className="rounded-full bg-surface-softer px-2 py-0.5 text-[12px] font-semibold text-ink-soft">{b}</span>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  if (view.kind === 'detail') {
    return (
      <section className={CARD} data-gate="view-detail" aria-label={view.title}>
        <header className={HEAD}>{view.title}</header>
        {view.fields.length > 0 && (
          // A definition list is the honest semantic for label/value pairs, and it
          // is what a screen reader announces usefully.
          <dl className="divide-y divide-border-faint">
            {view.fields.map((f, i) => (
              <div key={`${f.label}-${i}`} className="flex gap-3 px-3 py-1.5">
                <dt className={`w-24 flex-shrink-0 ${LABEL}`}>{f.label}</dt>
                <dd className="min-w-0 flex-1 break-words text-[13px] text-ink">{f.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {view.body && (
          // whitespace-pre-wrap preserves the sender's line breaks without letting
          // a long unbroken token push the card wider than the column.
          <div className="whitespace-pre-wrap break-words border-t border-border-faint px-3 py-2 text-[14px] leading-relaxed text-ink">{view.body}</div>
        )}
        <Actions actions={view.actions} onAction={onAction} />
      </section>
    );
  }

  if (view.kind === 'draft') {
    return (
      <section className={CARD} data-gate="view-draft" aria-label="Draft">
        <header className={`${HEAD} flex items-center gap-2`}>
          <span aria-hidden="true">✎</span>
          <span>Draft{view.subject ? `: ${view.subject}` : ''}</span>
        </header>
        <dl className="divide-y divide-border-faint">
          {view.to && (
            <div className="flex gap-3 px-3 py-1.5">
              <dt className={`w-24 flex-shrink-0 ${LABEL}`}>To</dt>
              <dd className="min-w-0 flex-1 break-words text-[13px] text-ink">{view.to}</dd>
            </div>
          )}
        </dl>
        <div className="whitespace-pre-wrap break-words px-3 py-2 text-[14px] leading-relaxed text-ink">{view.body}</div>
        {view.note && <p className="px-3 pb-2 text-[12px] italic text-ink-faint">{view.note}</p>}
        <Actions actions={view.actions} onAction={onAction} />
      </section>
    );
  }

  return (
    <section className={CARD} data-gate="view-confirm" aria-label="Confirmation">
      <p className="px-3 py-2 text-[14px] text-ink">{view.prompt}</p>
      <div className="flex flex-wrap gap-2 border-t border-border-faint px-3 py-2">
        <button
          type="button"
          disabled={!onAction}
          onClick={() => onAction?.({ id: 'confirm', label: view.confirmLabel })}
          className="min-h-11 rounded-lg bg-accent px-4 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
        >
          {view.confirmLabel}
        </button>
        <button
          type="button"
          disabled={!onAction}
          onClick={() => onAction?.({ id: 'cancel', label: view.cancelLabel || 'Cancel' })}
          className="min-h-11 rounded-lg border border-border px-4 text-[13px] font-semibold text-ink transition hover:border-accent disabled:opacity-40"
        >
          {view.cancelLabel || 'Cancel'}
        </button>
      </div>
    </section>
  );
}

/** Shown when a view cannot be rendered. Never blank, and never a broken panel:
 *  an unsupported VERSION is a stale-client problem (T-30) and says so, while a
 *  malformed payload says that instead. Either way the raw text stays visible
 *  above/below via the caller, so nothing is ever lost. */
export function StructuredViewFallback({ reason, unsupportedVersion }: { reason: string; unsupportedVersion?: number }) {
  return (
    <div className="my-1 rounded-xl border border-amber-400/40 bg-amber-500/10 px-3 py-2" data-gate="view-fallback" role="status">
      <div className="text-[13px] font-semibold text-amber-300">
        {unsupportedVersion !== undefined
          ? `This message contains a view (version ${unsupportedVersion}) newer than this app understands`
          : 'This message contains a view this app could not read'}
      </div>
      <p className="mt-0.5 text-[12px] leading-relaxed text-ink-soft">
        {unsupportedVersion !== undefined
          ? 'Reload to pick up a newer app build. The message text is shown as sent.'
          : `Showing the message as sent instead. Reason: ${reason}`}
      </p>
    </div>
  );
}

/**
 * Message body that renders a structured view when the sender emitted one.
 *
 * Ordinary messages take the ordinary path — the fence is absent, so nothing
 * changes for the 99% case. When a view IS present, the prose around it still
 * renders, because the agent's sentence ("here are today's emails") is context the
 * card does not carry, and losing it would make the transcript unreadable later.
 */
export interface ViewActionLifecycle {
  status: 'delivered' | 'completed' | 'failed' | 'cancelled';
  by: string;
  note?: string;
}

export function ViewAwareBody({ text, selfName, onAction, viewAction, actionState }: {
  text: string;
  selfName?: string;
  onAction?: (action: ViewAction) => void;
  /** Name of the addressed session that acknowledged this request, if it has. */
  actionState?: ViewActionLifecycle;
  /** Present when THIS message is itself an action request; the receipt replaces
   *  the host-authored token text, which nobody needs to read. */
  viewAction?: { actionId: string; label: string; sourceMessageId: number; sourceSender?: string; sourceLineage?: string; viewVersion: number; nonce: string };
}) {
  if (viewAction) return <ViewActionReceipt action={viewAction} actionState={actionState} />;
  const block = extractViewBlock(text);
  if (!block) return <CollapsibleMessageBody text={text} selfName={selfName} />;
  const parsed = parseStructuredView(block.json);
  return (
    <div data-gate="view-aware-body">
      {block.before && <CollapsibleMessageBody text={block.before} selfName={selfName} />}
      {parsed.ok
        ? <StructuredViewCard view={parsed.view} onAction={onAction} />
        : (
          <>
            <StructuredViewFallback reason={parsed.reason} unsupportedVersion={parsed.unsupportedVersion} />
            {/* The raw payload stays visible on failure: a view we cannot render
                must never become a message the reader cannot see. */}
            <CollapsibleMessageBody text={block.json.trim()} selfName={selfName} />
          </>
        )}
      {block.after && <CollapsibleMessageBody text={block.after} selfName={selfName} />}
    </div>
  );
}

/**
 * T-46 rev2: honest receipt for a pressed action.
 *
 * The transcript used to show raw protocol syntax (`[action:draft-reply-m1] …`),
 * which is both ugly and misleading — it reads like the host typed a command. This
 * renders the same event as a compact receipt built from METADATA, with the
 * agent-authored label displayed as text (a React child, so inert) and the binding
 * available for anyone auditing what was requested against which message.
 */
export function ViewActionReceipt({ action, actionState }: {
  action: { actionId: string; label: string; sourceMessageId: number; sourceSender?: string; sourceLineage?: string; viewVersion: number; nonce: string };
  /** T-49: the addressed session confirmed it took the request. Only that session
   *  can produce this — the server refuses an ack from anyone else — so it is a fact
   *  about delivery rather than an optimistic guess. */
  actionState?: ViewActionLifecycle;
}) {
  return (
    <div
      className="my-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border border-border-faint bg-surface-softer px-2.5 py-1.5 text-[13px]"
      data-gate="view-action-receipt"
      title={`action ${action.actionId} · from message ${action.sourceMessageId} · view v${action.viewVersion}`}
    >
      <span aria-hidden="true">↳</span>
      {/* Names the producer rather than "the agent": with several agents in a room,
          "asked the agent" does not say who owns the request. The name is resolved
          server-side from the real source message, not from the click. */}
      <span className="text-ink-soft">You asked{action.sourceSender ? ` ${action.sourceSender}` : ' the agent'} to</span>
      <span className="font-semibold text-ink">{action.label}</span>
      {/* Requested is what WE know; Delivered is what the producer told us. Saying
          "delivered" before the addressed session confirms would be the same
          optimism that made the old one-shot button look successful when the server
          had refused it. */}
      <span
        className={
          actionState?.status === 'failed' ? 'text-red-600 dark:text-red-400'
            : actionState?.status === 'cancelled' ? 'text-ink-faint'
              : actionState ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-ink-faint'
        }
        data-gate="view-action-state"
        role="status"
        aria-live="polite"
      >
        {actionState?.status === 'delivered' ? `· delivered to ${actionState.by}`
          : actionState?.status === 'completed' ? `· completed by ${actionState.by}`
            : actionState?.status === 'failed' ? `· failed${actionState.note ? ` — ${actionState.note}` : ''}`
              : actionState?.status === 'cancelled' ? `· cancelled${actionState.note ? ` — ${actionState.note}` : ''}`
                : '· requested'}
      </span>
    </div>
  );
}
