import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { createClient, createRoom, summonWorkspaces, type SummonWorkspaceGroup } from '../lib/api.js';
import { normalizeRoomTopic, roomTopicIssue } from '@agent-room/shared';
import { ROOM_TEMPLATES, roleLabelFor, suggestTemplateForTopic, templateById } from '../lib/templates.js';
import { RolePicker } from '../components/RolePicker.js';
import { fetchIdentity, lastRole } from '../lib/identity.js';
import { colorForName, initialsFor } from '../lib/colors.js';

const TEMPLATE_KEY = 'room:pending-template:';

// T-22: the New-room screen wears the WakiChat shell, prefills the
// authenticated identity (the owner types no name/role), and puts
// Project + Topic front and center. Templates shrink to light chips.

export function CreateMeeting() {
  // A4: optional `?topic=...&from=<code>` query params let the report
  // page deep-link a reader straight into a new-room flow with the topic
  // pre-seeded. `from` is preserved purely for attribution/debugging.
  const [searchParams] = useSearchParams();
  const initialTopic = searchParams.get('topic') ?? '';
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

  function pickTemplate(id: string) {
    setTemplateId(id);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const topicIssue = roomTopicIssue(topic);
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
        <p className="mt-1 mb-5 text-[13px] text-ink-soft">A clear room name, the workspace it's based in, and you're live.</p>

        {error && <div className="mb-4 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300">{error}</div>}

        {/* The room TYPE leads (teaching moment): cards say when to pick each,
            and the choice seeds the name placeholder + agent briefs. Blank is
            demoted to a skip link — structure is the default posture. */}
        <div className="mb-5">
          <span className="mb-1.5 block text-xs font-semibold text-ink-muted">What kind of room?</span>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
                  <span className="mt-0.5 block text-[12px] leading-snug text-ink-soft">{t.whenToUse}</span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => pickTemplate('blank')}
            aria-pressed={templateId === 'blank'}
            className={`mt-2 text-[12px] font-semibold transition ${templateId === 'blank' ? 'text-accent' : 'text-ink-faint hover:text-ink'}`}
          >
            {templateId === 'blank' ? '✓ Starting blank — just a topic' : 'Skip — just a topic, no structure'}
          </button>
          {template && template.id !== 'blank' && (
            <div className="mt-2 rounded-xl border border-border-faint bg-surface p-3" data-gate="template-preview">
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
        </div>

        <label className="mb-1 block">
          <span className="mb-1.5 block text-xs font-semibold text-ink-muted">Room name</span>
          <input value={topic} onChange={e => { setTopic(e.target.value); setError(null); }} required
            aria-invalid={Boolean(topic && roomTopicIssue(topic))}
            placeholder={template?.topicSeed || 'What are we working on?'}
            className={fieldClass} />
          {template && template.id !== 'blank' && (
            <span className="mt-1 block text-[12px] text-ink-faint">
              The example stays placeholder text—type the specific name you want people to see.
            </span>
          )}
        </label>
        {templateId === 'blank' && suggestTemplateForTopic(topic) && (
          <button
            type="button"
            data-gate="template-suggestion"
            onClick={() => pickTemplate(suggestTemplateForTopic(topic)!.id)}
            className="mb-3 mt-1 inline-flex min-h-9 items-center gap-1.5 rounded-full border border-accent/40 bg-accent-tint px-3 text-[12px] font-semibold text-accent transition hover:border-accent"
          >
            <span aria-hidden="true">{suggestTemplateForTopic(topic)!.emoji}</span>
            Looks like a {suggestTemplateForTopic(topic)!.label} room — use that type?
          </button>
        )}
        <div className="mb-4" />

        {wsGroups.length > 0 && (
          <label className="mb-4 block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-muted">Workspace</span>
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

        <button disabled={busy || Boolean(roomTopicIssue(topic))} type="submit" className="min-h-11 w-full rounded-xl bg-accent py-2.5 text-sm font-bold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50">
          {busy ? 'Creating…' : 'Create room →'}
        </button>
      </form>
    </div>
  );
}
