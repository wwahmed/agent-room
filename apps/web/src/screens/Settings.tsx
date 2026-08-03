import { Link, useNavigate } from 'react-router-dom';
import { AGENT_MODES, AGENT_MODE_COPY, defaultAgentMode, setDefaultAgentMode, type AgentMode } from '../lib/agentDefaults.js';
import { useEffect, useState } from 'react';
import { fetchIdentity, type WhoAmI } from '../lib/identity.js';
import { colorForName, initialsFor } from '../lib/colors.js';
import { AppearanceChoices, ReadingScaleChoices } from '../components/PreferenceControls.js';
import { NotificationSettings } from '../components/NotificationSettings.js';
import { getTranscribeModel, setTranscribeModel, type TranscribeModelOption } from '../lib/api.js';

// T-26/T-27: the app-level Settings destination behind the Home account
// menu's Settings row. Room-scoped settings stay on the room's Settings
// workspace surface; this page owns only what belongs to the PERSON —
// identity, appearance, reading scale, sign out. The preference controls
// are the same components the account-menu subpanels render, so the two
// surfaces cannot drift.

function sectionHead(label: string) {
  return <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-ink-faint">{label}</h2>;
}

function AgentPermissionChoices() {
  const [mode, setMode] = useState<AgentMode>(defaultAgentMode);
  return (
    <>
      <p className="mb-2 text-[13px] text-ink-soft">
        What a newly summoned agent may do before you change anything. Higher levels
        interrupt you less — a Build agent runs commands without asking, so it also has
        the widest reach in whatever workspace you point it at.
      </p>
      <div role="radiogroup" aria-label="Default agent permissions" className="grid grid-cols-3 gap-2">
        {AGENT_MODES.map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={mode === value}
            data-agent-mode={value}
            onClick={() => { setMode(value); setDefaultAgentMode(value); }}
            className={`min-h-11 rounded-xl border px-2 py-2 text-[13px] transition ${mode === value ? 'border-accent bg-accent/10 text-ink' : 'border-border text-ink-soft hover:border-border-strong'}`}
          >
            <div className="font-semibold">{AGENT_MODE_COPY[value].title}</div>
            <div className="text-[11px] text-ink-soft">{AGENT_MODE_COPY[value].short}</div>
          </button>
        ))}
      </div>
      <p className="mt-2 text-[12px] text-ink-soft">{AGENT_MODE_COPY[mode].detail}</p>
    </>
  );
}

export function Settings() {
  const navigate = useNavigate();
  const [identity, setIdentity] = useState<WhoAmI | null>(null);
  const [sttModels, setSttModels] = useState<TranscribeModelOption[]>([]);
  const [sttCurrent, setSttCurrent] = useState('');
  const [sttMsg, setSttMsg] = useState('');
  const [sttBusy, setSttBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchIdentity().then(me => { if (!cancelled) setIdentity(me); });
    void getTranscribeModel().then(r => { if (!cancelled) { setSttModels(r.available); setSttCurrent(r.current); } });
    return () => { cancelled = true; };
  }, []);

  async function onPickModel(id: string) {
    setSttMsg(''); setSttBusy(true);
    const prev = sttCurrent;
    setSttCurrent(id);
    try {
      await setTranscribeModel(id);
      setSttMsg('Saved — voice transcription now uses this model.');
    } catch (e) {
      setSttCurrent(prev);
      setSttMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSttBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-surface-sunken text-ink">
      <header className="border-b border-border-subtle">
        <div className="mx-auto flex h-14 max-w-xl items-center gap-1 px-2 sm:px-4">
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Back"
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl text-ink-soft transition hover:bg-surface-softer hover:text-ink"
          >
            <svg viewBox="0 0 16 16" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10.5 3 5.5 8l5 5" />
            </svg>
          </button>
          <h1 className="text-[17px] font-bold tracking-tight">Settings</h1>
        </div>
      </header>

      <main className="mx-auto max-w-xl space-y-4 px-4 py-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:px-6">
        {/* T-118 (host order): notification truth lives at the TOP. */}
        <NotificationSettings />
        <section aria-label="Account" className="rounded-xl border border-border-faint bg-surface p-4">
          {sectionHead('Account')}
          {identity ? (
            <div className="flex items-center gap-3">
              <span
                className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                style={{ backgroundColor: colorForName(identity.name) }}
                aria-hidden="true"
              >
                {initialsFor(identity.name)}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-semibold text-ink">{identity.name}</span>
                <span className="block truncate text-[13px] text-ink-faint">{identity.email}</span>
              </span>
            </div>
          ) : (
            <div className="text-sm text-ink-soft">
              Not signed in. <Link to="/" className="font-semibold text-accent">Back to Home</Link> to sign in.
            </div>
          )}
        </section>

        <section aria-label="Appearance" className="rounded-xl border border-border-faint bg-surface p-4">
          {sectionHead('Appearance')}
          <AppearanceChoices />
        </section>

        <section aria-label="Agent permissions" className="rounded-xl border border-border-faint bg-surface p-4">
          {sectionHead('Agent permissions')}
          <AgentPermissionChoices />
        </section>

        <section aria-label="Reading scale" className="rounded-xl border border-border-faint bg-surface p-4">
          {sectionHead('Reading scale')}
          <p className="mb-2 text-[13px] text-ink-soft">Message text size on phones. Comfortable is the default.</p>
          <ReadingScaleChoices />
        </section>

        {sttModels.length > 0 && (
          <section aria-label="Voice transcription" className="rounded-xl border border-border-faint bg-surface p-4">
            {sectionHead('Voice transcription')}
            <p className="mb-2 text-[13px] text-ink-soft">Local speech-to-text model for dictation. Bigger is more accurate, slightly slower. All run on-device.</p>
            <select
              value={sttCurrent}
              disabled={sttBusy}
              onChange={e => void onPickModel(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-ink disabled:opacity-50"
            >
              {sttModels.map(m => (
                <option key={m.id} value={m.id} disabled={!m.downloaded}>
                  {m.label} — {m.note}{m.downloaded ? '' : ' (not downloaded)'}
                </option>
              ))}
            </select>
            {sttMsg && <p className="mt-2 text-[12px] text-ink-soft">{sttMsg}</p>}
          </section>
        )}

        {identity && (
          <section aria-label="Sign out" className="rounded-xl border border-red-400/30 bg-red-500/5 p-4">
            <a
              href="/cdn-cgi/access/logout"
              className="flex min-h-11 w-fit items-center gap-3 rounded-lg px-3 text-[15px] font-medium text-red-400 transition hover:bg-red-500/10"
            >
              <svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M10 2.5H4.5A1 1 0 0 0 3.5 3.5v9a1 1 0 0 0 1 1H10" />
                <path d="M13.5 8H6.8M11 5.3 13.7 8 11 10.7" />
              </svg>
              Log out
            </a>
          </section>
        )}
      </main>
    </div>
  );
}
