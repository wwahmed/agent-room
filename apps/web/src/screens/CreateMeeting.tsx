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

  const fieldClass = 'w-full min-h-11 px-3 py-2 bg-surface-softer border border-border rounded-xl outline-none text-base focus:border-accent focus:ring-4 focus:ring-accent-tint';

  const suggestion = templateId === 'blank' ? suggestTemplateForTopic(topic) : undefined;

  // Review rows: every fact links back to the step that owns it.
  const reviewRows: Array<{ label: string; value: string; step: StepN }> = [
    { label: 'Type', value: template && template.id !== 'blank' ? `${template.emoji} ${template.label}` : 'Blank — just a topic', step: 1 },
    { label: 'Name', value: topic.trim() || '—', step: 2 },
    ...(wsGroups.length > 0 ? [{ label: 'Workspace', value: workspace.split('/').pop() || workspace || '—', step: 2 as StepN }] : []),
  ];

  return (
    <div className="min-h-[100dvh] bg-surface-sunken">
      <div className="flex h-[52px] items-center border-b border-border-faint bg-surface px-3">
        <div className="mx-auto flex h-full w-full max-w-[720px] items-center gap-2">
          <Link to="/" aria-label="WakiChat home" className="flex min-h-11 items-center gap-2 transition hover:opacity-85">
            <img src="/brand/wakichat/wakichat-icon-192.png" alt="" className="h-8 w-8" />
            <span className="text-[15px] font-bold tracking-tight">WakiChat</span>
          </Link>
          <span className="text-[13px] text-ink-faint">/ new room</span>
        </div>
      </div>

      <form onSubmit={submit} className="mx-auto w-full max-w-[720px] px-4 py-6">
        <h1 className="text-xl font-bold tracking-tight">Start a room</h1>

        {/* Stepper rail: tappable for completed steps, worded — never dots-only. */}
        <ol data-gate="create-stepper" className="mb-6 mt-4 flex items-center gap-2" aria-label={`Step ${step} of 3`}>
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
                  className={`w-full rounded-lg px-1 py-1.5 text-center transition ${done ? 'cursor-pointer' : ''}`}
                >
                  <span className={`block h-1.5 rounded-full ${current || done ? 'bg-accent' : 'bg-border'}`} aria-hidden="true" />
                  <span className={`mt-1.5 block text-[12px] font-semibold ${current ? 'text-ink' : done ? 'text-accent' : 'text-ink-faint'}`}>
                    {done ? '✓ ' : ''}{s.label}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        {error && <div className="mb-4 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300">{error}</div>}

        {/* STEP 1 — the room TYPE leads (teaching moment): compact cards, the
            when-to-use line only where it's needed (the selected card), and
            the full preview folded beneath. Blank is demoted to a skip link —
            structure is the default posture. */}
        {step === 1 && (
          <section data-gate="step-type">
            <span className="mb-2 block text-sm font-semibold text-ink">What kind of room?</span>
            <div className="grid grid-cols-2 gap-2">
              {ROOM_TEMPLATES.filter(t => t.id !== 'blank').map(t => {
                const active = t.id === templateId;
                return (
                  <button
                    type="button"
                    key={t.id}
                    onClick={() => pickTemplate(t.id)}
                    aria-pressed={active}
                    className={`rounded-xl border px-3 py-2.5 text-left transition ${
                      active
                        ? 'border-accent bg-accent-tint'
                        : 'border-border bg-surface hover:border-accent/40'
                    }`}
                  >
                    <span className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                      <span aria-hidden="true">{t.emoji}</span>
                      <span>{t.label}</span>
                    </span>
                    {active && (
                      <span className="mt-1 block text-[12px] leading-snug text-ink-soft">{t.whenToUse}</span>
                    )}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => { pickTemplate('blank'); goTo(2); }}
              aria-pressed={templateId === 'blank'}
              className={`mt-3 text-[12px] font-semibold transition ${templateId === 'blank' ? 'text-accent' : 'text-ink-faint hover:text-ink'}`}
            >
              Skip — just a topic, no structure
            </button>
            {template && template.id !== 'blank' && (
              <div className="mt-3 rounded-xl border border-border-faint bg-surface p-3" data-gate="template-preview">
                <p className="text-[12px] leading-relaxed text-ink-soft">{template.description}</p>
                {template.suggestedRoleIds.length > 0 && (
                  <p className="mt-1 text-[12px] text-ink-faint">
                    Suggested crew: {template.suggestedRoleIds.map(roleLabelFor).join(' · ')}
                  </p>
                )}
                <p className="mt-1 text-[12px] text-ink-faint">
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
              <span className="mb-1.5 block text-sm font-semibold text-ink">Room name</span>
              <input value={topic} onChange={e => { setTopic(e.target.value); setError(null); }} required autoFocus
                aria-invalid={Boolean(topic && topicIssue)}
                placeholder={template?.topicSeed || 'What are we working on?'}
                className={fieldClass} />
              {template && template.id !== 'blank' && (
                <span className="mt-1 block text-[12px] text-ink-faint">
                  The example stays placeholder text—type the specific name you want people to see.
                </span>
              )}
            </label>
            {suggestion && (
              <button
                type="button"
                data-gate="template-suggestion"
                onClick={() => pickTemplate(suggestion.id)}
                className="mb-2 mt-1 inline-flex min-h-9 items-center gap-1.5 rounded-full border border-accent/40 bg-accent-tint px-3 text-[12px] font-semibold text-accent transition hover:border-accent"
              >
                <span aria-hidden="true">{suggestion.emoji}</span>
                Looks like a {suggestion.label} room — use that type?
              </button>
            )}
            <div className="mb-4" />

            {wsGroups.length > 0 && (
              <label className="mb-4 block">
                <span className="mb-1.5 block text-sm font-semibold text-ink">Workspace</span>
                <select value={workspace} onChange={e => setWorkspace(e.target.value)} className={fieldClass}>
                  {wsGroups.map(g => (
                    <optgroup key={g.group} label={g.group}>
                      {g.items.map(it => <option key={it.path} value={it.path}>{it.name}</option>)}
                    </optgroup>
                  ))}
                </select>
                <span className="mt-1 block text-[12px] text-ink-faint">
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
            <span className="mb-2 block text-sm font-semibold text-ink">Ready to go?</span>
            <div className="mb-4 divide-y divide-border-faint rounded-xl border border-border-faint bg-surface">
              {reviewRows.map(r => (
                <div key={r.label} className="flex items-center gap-3 px-3 py-2.5">
                  <span className="w-24 flex-shrink-0 text-[12px] font-semibold text-ink-faint">{r.label}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{r.value}</span>
                  <button type="button" onClick={() => goTo(r.step)} className="min-h-9 rounded-lg px-2 text-xs font-semibold text-accent transition hover:bg-accent-tint">
                    Edit
                  </button>
                </div>
              ))}
            </div>

            {identityKnown && !editIdentity ? (
              <div className="mb-5 flex items-center gap-2.5 rounded-xl border border-border-faint bg-surface p-3">
                <div
                  className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white"
                  style={{ backgroundColor: colorForName(name) }}
                  aria-hidden="true"
                >
                  {initialsFor(name)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">Creating as {name}</div>
                  <div className="text-[12px] text-ink-faint">{role || 'no role set'} · from your Google sign-in</div>
                </div>
                <button type="button" onClick={() => setEditIdentity(true)} className="min-h-11 rounded-lg px-3 text-xs font-semibold text-accent transition hover:bg-accent-tint">
                  Edit
                </button>
              </div>
            ) : (
              <div className="mb-5 grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold text-ink-muted">Your name</span>
                  <input value={name} onChange={e => setName(e.target.value)} required className={fieldClass} />
                </label>
                <RolePicker value={role} onChange={setRole} fieldClass={fieldClass} />
              </div>
            )}
          </section>
        )}

        {/* Footer nav: Back is quiet, forward is the single loud action. */}
        <div className="mt-6 flex items-center gap-3">
          {step > 1 && (
            <button type="button" onClick={() => goTo((step - 1) as StepN)} className="min-h-11 rounded-xl border border-border px-4 text-sm font-semibold text-ink-soft transition hover:border-border-strong hover:text-ink">
              ← Back
            </button>
          )}
          {step < 3 ? (
            <button
              type="button"
              onClick={() => goTo((step + 1) as StepN)}
              disabled={step === 2 && !detailsOk}
              className="min-h-11 flex-1 rounded-xl bg-accent py-2.5 text-sm font-bold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50"
            >
              Next →
            </button>
          ) : (
            <button disabled={busy || Boolean(topicIssue)} type="submit" className="min-h-11 flex-1 rounded-xl bg-accent py-2.5 text-sm font-bold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50">
              {busy ? 'Creating…' : 'Create room →'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
