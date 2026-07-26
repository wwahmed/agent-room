import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { createClient, createRoom, summonWorkspaces, type SummonWorkspaceGroup } from '../lib/api.js';
import { normalizeRoomTopic, ROLE_PRESETS, roomTopicIssue } from '@agent-room/shared';
import { ROOM_TEMPLATES, roleLabelFor, templateById } from '../lib/templates.js';
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


        <label className="mb-4 block">
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

        <div className="mb-5">
          <span className="mb-1.5 block text-xs font-semibold text-ink-muted">Template <span className="font-medium text-ink-faint">optional</span></span>
          <div className="flex flex-wrap gap-1.5">
            {ROOM_TEMPLATES.map(t => {
              const active = t.id === templateId;
              return (
                <button
                  type="button"
                  key={t.id}
                  onClick={() => pickTemplate(t.id)}
                  title={`${t.description}${t.suggestedRoleIds.length ? ` · roles: ${t.suggestedRoleIds.map(roleLabelFor).join(', ')}` : ''}`}
                  className={`flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-semibold transition ${
                    active
                      ? 'border-accent bg-accent-tint text-accent'
                      : 'border-border bg-surface text-ink-muted hover:border-accent/40 hover:text-ink'
                  }`}
                >
                  <span aria-hidden="true">{t.emoji}</span>
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>
          {template && template.id !== 'blank' && (
            <p className="mt-1.5 text-[12px] leading-relaxed text-ink-faint">{template.description}</p>
          )}
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
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-ink-muted">Your role <span className="font-medium text-ink-faint">optional</span></span>
              <select
                value={ROLE_PRESETS.some(p => p.role === role) ? role : ''}
                onChange={e => setRole(e.target.value)}
                className={`${fieldClass} mb-2`}
              >
                <option value="">Custom role…</option>
                {ROLE_PRESETS.map(p => <option key={p.id} value={p.role}>{p.label}</option>)}
              </select>
              <input value={role} onChange={e => setRole(e.target.value)} placeholder="e.g. Frontend" className={fieldClass} />
            </label>
          </div>
        )}

        <button disabled={busy || Boolean(roomTopicIssue(topic))} type="submit" className="min-h-11 w-full rounded-xl bg-accent py-2.5 text-sm font-bold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50">
          {busy ? 'Creating…' : 'Create room →'}
        </button>
      </form>
    </div>
  );
}
