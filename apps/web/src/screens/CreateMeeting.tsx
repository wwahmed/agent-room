import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { createClient, createRoom, summonWorkspaces, type SummonWorkspaceGroup } from '../lib/api.js';
import { normalizeRoomTopic, roomTopicIssue } from '@agent-room/shared';
import { ROOM_TEMPLATES, roleLabelFor, suggestTemplateForTopic, templateById } from '../lib/templates.js';
import { RolePicker } from '../components/RolePicker.js';
import { fetchIdentity, lastRole } from '../lib/identity.js';
import { colorForName, initialsFor } from '../lib/colors.js';

const TEMPLATE_KEY = 'room:pending-template:';

// T-09: the create page is a concise three-step stepper (Type → Details →
// Review), replacing the single newspaper-length scroll the host rejected on
// mobile. Each step fits one screen; the type cards are compact (emoji +
// label), with the when-to-use line only on the selected card and the full
// teaching preview folded beneath it. The T-22 teaching posture is kept:
// the room TYPE still leads, blank is still a demoted skip link, and the
// topic can still suggest a type.

const STEPS = [
  { n: 1, label: 'Type' },
  { n: 2, label: 'Details' },
  { n: 3, label: 'Review' },
] as const;
type StepN = (typeof STEPS)[number]['n'];

export function CreateMeeting() {
  // A4: optional `?topic=...&from=<code>` query params let the report
  // page deep-link a reader straight into a new-room flow with the topic
  // pre-seeded. `from` is preserved purely for attribution/debugging.
  const [searchParams] = useSearchParams();
  const initialTopic = searchParams.get('topic') ?? '';
  const [step, setStep] = useState<StepN>(1);
  const [templateId, setTemplateId] = useState<string>('blank');
  const [topic, setTopic] = useState(initialTopic);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [identityKnown, setIdentityKnown] = useState(false);
  const [editIdentity, setEditIdentity] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The room is based in a single grouped Workspace (unified — the old separate
  // Project/repo picker was folded into this per Waqas).
  const [wsGroups, setWsGroups] = useState<SummonWorkspaceGroup[]>([]);
  const [workspace, setWorkspace] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    void summonWorkspaces().then(gs => {
      setWsGroups(gs);
      setWorkspace(prev => prev || gs[0]?.items[0]?.path || '');
    });
    let cancelled = false;
    void fetchIdentity().then(me => {
      if (cancelled || !me) return;
      setName(prev => prev || me.name);
      setRole(prev => prev || me.role || lastRole());
      setIdentityKnown(true);
    });
    return () => { cancelled = true; };
  }, []);

  const template = templateById(templateId);
  const topicIssue = roomTopicIssue(topic);
  const detailsOk = Boolean(topic.trim()) && !topicIssue;

  function pickTemplate(id: string) {
    setTemplateId(id);
  }

  function goTo(next: StepN) {
    // Forward past Details requires a valid room name; backward is always free.
    if (next > 2 && step >= 2 && !detailsOk) {
      setError(topicIssue || 'Give the room a name first.');
      return;
    }
    setError(null);
    setStep(next);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    // Enter inside a field mid-flow advances the stepper — it never
    // fires the create call from a half-reviewed form.
    if (step !== 3) { goTo((step + 1) as StepN); return; }
    if (topicIssue) { setError(topicIssue); return; }
    if (!name.trim()) return;
    setBusy(true); setError(null);
    try {
      const client = createClient();
      // The server allocates the room code (it can check collisions
      // against Redis; the browser can't).
      const created = await createRoom(client, {
        topic: normalizeRoomTopic(topic),
        createdBy: name.trim(),
        workspace: workspace || undefined,
        // Persist the room's type server-side: joiners (and agents, via their
        // join response) read it from the room record — no longer a
        // this-browser-only sessionStorage fact.
        templateId: template && template.id !== 'blank' ? template.id : undefined,
      });
      const code = created.code;
      sessionStorage.setItem(`room:${code}:self`, JSON.stringify({ name: name.trim(), role: role.trim() }));
      // Host key: required to claim the host's display name on any future
      // join. localStorage so it survives tab close (room TTL bounds it).
      localStorage.setItem(`room:${code}:hostKey`, created.hostKey);
      if (template && template.id !== 'blank') {
        sessionStorage.setItem(`${TEMPLATE_KEY}${code}`, template.id);
      }
      // T-116: the room now exists — the create form is a dead intermediate
      // state. Replace it in history so Back from the lobby/room lands on
      // Home (where the flow started), never on this committed form.
      navigate(`/r/${code}/lobby`, { replace: true });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  }

  const fieldClass = 'w-full min-h-14 rounded-2xl border border-border bg-surface-softer px-4 py-3 text-base outline-none focus:border-accent focus:ring-4 focus:ring-accent-tint sm:min-h-11 sm:rounded-xl sm:px-3 sm:py-2';

  const suggestion = templateId === 'blank' ? suggestTemplateForTopic(topic) : undefined;

  // Review rows: every fact links back to the step that owns it.
  const reviewRows: Array<{ label: string; value: string; step: StepN }> = [
    { label: 'Type', value: template && template.id !== 'blank' ? `${template.emoji} ${template.label}` : 'Blank — just a topic', step: 1 },
    { label: 'Name', value: topic.trim() || '—', step: 2 },
    ...(wsGroups.length > 0 ? [{ label: 'Workspace', value: workspace.split('/').pop() || workspace || '—', step: 2 as StepN }] : []),
  ];

  return (
    <div className="min-h-[100dvh] bg-surface-sunken">
      <div className="flex h-16 items-center border-b border-border-faint bg-surface px-4 sm:h-[52px] sm:px-3">
        <div className="mx-auto flex h-full w-full max-w-[720px] items-center gap-2">
          <Link to="/" aria-label="WakiChat home" className="flex min-h-11 items-center gap-2 transition hover:opacity-85">
            <img src="/brand/wakichat/wakichat-icon-192.png" alt="" className="h-9 w-9 sm:h-8 sm:w-8" />
            <span className="text-lg font-bold tracking-tight sm:text-[15px]">WakiChat</span>
          </Link>
          <span className="text-sm text-ink-faint sm:text-[13px]">/ new room</span>
        </div>
      </div>

      <form onSubmit={submit} className="mx-auto w-full max-w-[720px] px-5 py-7 pb-[calc(6.5rem+env(safe-area-inset-bottom))] sm:px-4 sm:py-6">
        <h1 className="text-3xl font-bold tracking-tight sm:text-xl">Start a room</h1>

        {/* Stepper rail: tappable for completed steps, worded — never dots-only. */}
        <ol data-gate="create-stepper" className="mb-8 mt-6 flex items-center gap-2 sm:mb-6 sm:mt-4" aria-label={`Step ${step} of 3`}>
          {STEPS.map(s => {
            const done = s.n < step;
            const current = s.n === step;
            return (
              <li key={s.n} className="flex-1">
                <button
                  type="button"
                  onClick={() => s.n < step && goTo(s.n)}
                  disabled={s.n > step}
                  aria-current={current ? 'step' : undefined}
                  className={`min-h-12 w-full rounded-lg px-1 py-1.5 text-center transition sm:min-h-0 ${done ? 'cursor-pointer' : ''}`}
                >
                  <span className={`block h-2 rounded-full sm:h-1.5 ${current || done ? 'bg-accent' : 'bg-border'}`} aria-hidden="true" />
                  <span className={`mt-2 block text-sm font-semibold sm:mt-1.5 sm:text-[12px] ${current ? 'text-ink' : done ? 'text-accent' : 'text-ink-faint'}`}>
                    {done ? '✓ ' : ''}{s.label}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        {error && <div className="mb-5 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-300 sm:mb-4 sm:rounded-lg sm:px-3 sm:py-2 sm:text-xs">{error}</div>}

        {/* STEP 1 — the room TYPE leads (teaching moment): compact cards, the
            when-to-use line only where it's needed (the selected card), and
            the full preview folded beneath. Blank is demoted to a skip link —
            structure is the default posture. */}
        {step === 1 && (
          <section data-gate="step-type">
            <span className="mb-3 block text-lg font-semibold text-ink sm:mb-2 sm:text-sm">What kind of room?</span>
            <div className="grid grid-cols-2 gap-3 sm:gap-2">
              {ROOM_TEMPLATES.filter(t => t.id !== 'blank').map(t => {
                const active = t.id === templateId;
                return (
                  <button
                    type="button"
                    key={t.id}
                    onClick={() => pickTemplate(t.id)}
                    aria-pressed={active}
                    className={`min-h-16 rounded-2xl border px-4 py-3.5 text-left transition sm:min-h-0 sm:rounded-xl sm:px-3 sm:py-2.5 ${
                      active
                        ? 'border-accent bg-accent-tint'
                        : 'border-border bg-surface hover:border-accent/40'
                    }`}
                  >
                    <span className="flex items-center gap-2 text-base font-semibold text-ink sm:gap-1.5 sm:text-[13px]">
                      <span aria-hidden="true">{t.emoji}</span>
                      <span>{t.label}</span>
                    </span>
                    {active && (
                      <span className="mt-1.5 block text-sm leading-snug text-ink-soft sm:mt-1 sm:text-[12px]">{t.whenToUse}</span>
                    )}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => { pickTemplate('blank'); goTo(2); }}
              aria-pressed={templateId === 'blank'}
              className={`mt-4 min-h-11 text-sm font-semibold transition sm:mt-3 sm:min-h-0 sm:text-[12px] ${templateId === 'blank' ? 'text-accent' : 'text-ink-faint hover:text-ink'}`}
            >
              Skip — just a topic, no structure
            </button>
            {template && template.id !== 'blank' && (
              <div className="mt-4 rounded-2xl border border-border-faint bg-surface p-4 sm:mt-3 sm:rounded-xl sm:p-3" data-gate="template-preview">
                <p className="text-sm leading-relaxed text-ink-soft sm:text-[12px]">{template.description}</p>
                {template.suggestedRoleIds.length > 0 && (
                  <p className="mt-2 text-sm text-ink-faint sm:mt-1 sm:text-[12px]">
                    Suggested crew: {template.suggestedRoleIds.map(roleLabelFor).join(' · ')}
                  </p>
                )}
                <p className="mt-2 text-sm text-ink-faint sm:mt-1 sm:text-[12px]">
                  Its opening message teaches the room the [DECISION] / [TODO] / [STATUS] / [RESULT] markers, and agents get this room type in their briefing.
                </p>
              </div>
            )}
          </section>
        )}

        {/* STEP 2 — one screen: name + workspace. */}
        {step === 2 && (
          <section data-gate="step-details">
            <label className="mb-1 block">
              <span className="mb-2 block text-base font-semibold text-ink sm:mb-1.5 sm:text-sm">Room name</span>
              <input value={topic} onChange={e => { setTopic(e.target.value); setError(null); }} required autoFocus
                aria-invalid={Boolean(topic && topicIssue)}
                placeholder={template?.topicSeed || 'What are we working on?'}
                className={fieldClass} />
              {template && template.id !== 'blank' && (
                <span className="mt-2 block text-sm text-ink-faint sm:mt-1 sm:text-[12px]">
                  The example stays placeholder text—type the specific name you want people to see.
                </span>
              )}
            </label>
            {suggestion && (
              <button
                type="button"
                data-gate="template-suggestion"
                onClick={() => pickTemplate(suggestion.id)}
                className="mb-3 mt-2 inline-flex min-h-11 items-center gap-2 rounded-full border border-accent/40 bg-accent-tint px-4 text-sm font-semibold text-accent transition hover:border-accent sm:mb-2 sm:mt-1 sm:min-h-9 sm:gap-1.5 sm:px-3 sm:text-[12px]"
              >
                <span aria-hidden="true">{suggestion.emoji}</span>
                Looks like a {suggestion.label} room — use that type?
              </button>
            )}
            <div className="mb-4" />

            {wsGroups.length > 0 && (
              <label className="mb-4 block">
                <span className="mb-2 block text-base font-semibold text-ink sm:mb-1.5 sm:text-sm">Workspace</span>
                <select value={workspace} onChange={e => setWorkspace(e.target.value)} className={fieldClass}>
                  {wsGroups.map(g => (
                    <optgroup key={g.group} label={g.group}>
                      {g.items.map(it => <option key={it.path} value={it.path}>{it.name}</option>)}
                    </optgroup>
                  ))}
                </select>
                <span className="mt-2 block text-sm text-ink-faint sm:mt-1 sm:text-[12px]">
                  The local workspace this room is based in. Agents you summon here inherit it.
                </span>
              </label>
            )}
          </section>
        )}

        {/* STEP 3 — review: every fact editable via its own step, identity
            confirmed last, one unambiguous commit button. */}
        {step === 3 && (
          <section data-gate="step-review">
            <span className="mb-3 block text-lg font-semibold text-ink sm:mb-2 sm:text-sm">Ready to go?</span>
            <div className="mb-5 divide-y divide-border-faint rounded-2xl border border-border-faint bg-surface sm:mb-4 sm:rounded-xl">
              {reviewRows.map(r => (
                <div key={r.label} className="flex min-h-14 items-center gap-3 px-4 py-3 sm:min-h-0 sm:px-3 sm:py-2.5">
                  <span className="w-24 flex-shrink-0 text-sm font-semibold text-ink-faint sm:text-[12px]">{r.label}</span>
                  <span className="min-w-0 flex-1 truncate text-base font-semibold text-ink sm:text-sm">{r.value}</span>
                  <button type="button" onClick={() => goTo(r.step)} className="min-h-11 rounded-lg px-2 text-sm font-semibold text-accent transition hover:bg-accent-tint sm:min-h-9 sm:text-xs">
                    Edit
                  </button>
                </div>
              ))}
            </div>

            {identityKnown && !editIdentity ? (
              <div className="mb-6 flex items-center gap-3 rounded-2xl border border-border-faint bg-surface p-4 sm:mb-5 sm:gap-2.5 sm:rounded-xl sm:p-3">
                <div
                  className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold text-white sm:h-9 sm:w-9 sm:text-[12px]"
                  style={{ backgroundColor: colorForName(name) }}
                  aria-hidden="true"
                >
                  {initialsFor(name)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-base font-semibold sm:text-sm">Creating as {name}</div>
                  <div className="text-sm text-ink-faint sm:text-[12px]">{role || 'no role set'} · from your Google sign-in</div>
                </div>
                <button type="button" onClick={() => setEditIdentity(true)} className="min-h-11 rounded-lg px-3 text-sm font-semibold text-accent transition hover:bg-accent-tint sm:text-xs">
                  Edit
                </button>
              </div>
            ) : (
              <div className="mb-5 grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-ink-muted sm:mb-1.5 sm:text-xs">Your name</span>
                  <input value={name} onChange={e => setName(e.target.value)} required className={fieldClass} />
                </label>
                <RolePicker value={role} onChange={setRole} fieldClass={fieldClass} />
              </div>
            )}
          </section>
        )}

        {/* Footer nav: Back is quiet, forward is the single loud action. */}
        <div className="fixed inset-x-0 bottom-0 z-20 flex items-center gap-3 border-t border-border-faint bg-surface px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-12px_30px_rgba(0,0,0,0.12)] sm:static sm:mt-6 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:shadow-none">
          {step > 1 && (
            <button type="button" onClick={() => goTo((step - 1) as StepN)} className="min-h-14 rounded-2xl border border-border px-5 text-base font-semibold text-ink-soft transition hover:border-border-strong hover:text-ink sm:min-h-11 sm:rounded-xl sm:px-4 sm:text-sm">
              ← Back
            </button>
          )}
          {/* Distinct keys are load-bearing: without them React reuses one
              <button> DOM node across steps, and the browser's native default
              action for the click that advanced step 2→3 re-reads the node —
              now type="submit" — and creates the room straight past Review.
              Caught live in the T-09 walkthrough; a keyed remount detaches
              the node mid-dispatch, so the default action dies with it. */}
          {step < 3 ? (
            <button
              key="step-next"
              type="button"
              onClick={() => goTo((step + 1) as StepN)}
              disabled={step === 2 && !detailsOk}
              className="min-h-14 flex-1 rounded-2xl bg-accent py-3 text-base font-bold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50 sm:min-h-11 sm:rounded-xl sm:py-2.5 sm:text-sm"
            >
              Next →
            </button>
          ) : (
            <button key="step-create" disabled={busy || Boolean(topicIssue)} type="submit" className="min-h-14 flex-1 rounded-2xl bg-accent py-3 text-base font-bold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50 sm:min-h-11 sm:rounded-xl sm:py-2.5 sm:text-sm">
              {busy ? 'Creating…' : 'Create room →'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
