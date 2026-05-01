import { useRef, useState, useEffect, useCallback, type ClipboardEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useRoom } from '../hooks/useRoom.js';
import { Bubble } from '../components/Bubble.js';
import { VoiceButton } from '../components/VoiceButton.js';
import { MeetingCodePill } from '../components/MeetingCodePill.js';
import { Avatar } from '../components/Avatar.js';
import { colorForName, initialsFor } from '../lib/colors.js';
import { PRESENCE_STALE_MS, artifactLabel, extractArtifacts, type ArtifactKind, type Message, type MessageAttachment, type Participant, type RoomArtifact } from '@agent-room/shared';
import { draftReply, generateMinutes } from '../lib/ai.js';
import { setMuted, createClient, createRoomReport, endRoom as endRoomApi, reactivateRoom as reactivateRoomApi, removeParticipant } from '@agent-room/upstash-client';
import { ENV } from '../env.js';
import { copyText } from '../lib/copy.js';
import { templateById } from '../lib/templates.js';
import { ALLOWED_ATTACHMENT_TYPES, MAX_ATTACHMENTS_PER_MESSAGE, deleteRoomBlobs, formatBytes, uploadAttachment } from '../lib/upload.js';

const IDLE_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour — long enough that humans + agents discussing intermittently don't trip it
const AUTO_CLOSE_COUNTDOWN = 5;          // seconds
interface SelfIdentity { name: string; role: string }

function readStoredSelf(code: string): SelfIdentity | null {
  const stored = sessionStorage.getItem(`room:${code}:self`);
  if (!stored) return null;
  try {
    return JSON.parse(stored) as SelfIdentity;
  } catch {
    return null;
  }
}

// Cap auto-grow at ~8 lines so the input never eats the whole feed.
const TEXTAREA_MAX_HEIGHT = 200;
const TEXTAREA_MIN_HEIGHT = 42;

export function Room() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  // Identity is whatever Join wrote into sessionStorage. If it's missing
  // (visiting /r/CODE without going through Join — e.g. an invite link
  // someone forwarded after pruning the path), we redirect to /j/CODE
  // below. We previously "recovered" by becoming room.createdBy, which
  // silently impersonated the host for any unknown visitor.
  const [self, _setSelf] = useState<SelfIdentity | null>(() => readStoredSelf(code));
  useEffect(() => {
    if (!self) navigate(`/j/${code}`, { replace: true });
  }, [self, code, navigate]);
  const { room, messages, error, sendMessage, refreshRoom } = useRoom(code, self?.name ?? '');
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [attachBusy, setAttachBusy] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [draftErr, setDraftErr] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const feedRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-grow the textarea: shrink to min, then expand to scrollHeight up to max.
  // Runs after every value change (typed, pasted, Draft injected, voice transcript).
  function autoGrow(el: HTMLTextAreaElement | null) {
    if (!el) return;
    el.style.height = 'auto';
    const next = Math.min(Math.max(el.scrollHeight, TEXTAREA_MIN_HEIGHT), TEXTAREA_MAX_HEIGHT);
    el.style.height = `${next}px`;
  }
  useEffect(() => {
    autoGrow(textareaRef.current);
  }, [text]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(interval);
  }, []);

  // --- Share ---
  const joinUrl = `${window.location.origin}/j/${code}`;

  // --- End meeting ---
  const [ended, setEnded] = useState(false);
  const [showIdlePrompt, setShowIdlePrompt] = useState(false);
  const [countdown, setCountdown] = useState(AUTO_CLOSE_COUNTDOWN);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastMsgTimeRef = useRef(Date.now());

  // Sync ended state from room — both directions, so a server-side reactivation
  // (or another client reactivating) flips us back to active too.
  useEffect(() => {
    if (room?.status === 'ended') setEnded(true);
    else if (room?.status === 'active') setEnded(false);
  }, [room?.status]);

  // Template opener: if CreateMeeting stashed a template id for this room and
  // the host is opening an empty room, post the template's opening message
  // once and clear the marker. Guarded by `messages.length === 0` so a host
  // re-entering an active room doesn't re-post the opener.
  const openerSentRef = useRef(false);
  useEffect(() => {
    if (!room || !self || ended || openerSentRef.current) return;
    if (room.createdBy !== self.name) return;
    if (messages.length !== 0) return;
    const key = `room:pending-template:${code}`;
    const tplId = sessionStorage.getItem(key);
    const tpl = templateById(tplId);
    if (!tpl || !tpl.openingMessage) return;
    openerSentRef.current = true;
    sessionStorage.removeItem(key);
    const msg: Message = {
      id: Date.now(),
      type: 'msg',
      name: self.name,
      role: self.role || 'host',
      initials: initialsFor(self.name),
      color: colorForName(self.name),
      client: 'web',
      text: tpl.openingMessage,
      time: Date.now(),
    };
    sendMessage(msg).catch(() => {
      // If sending fails, give the user another shot on next mount by
      // clearing our local guard. The sessionStorage key is already gone,
      // so they'd need to re-create the room — acceptable miss for v1.
      openerSentRef.current = false;
    });
  }, [room, self, ended, messages.length, code, sendMessage]);

  // Detect being kicked: once we've seen ourselves in the participants list
  // (so we know the room poll is working), if we then disappear from it we
  // were removed. Redirect to /j/CODE so the user can rejoin if they want,
  // and show a toast to make it not feel like a network glitch.
  const sawSelfRef = useRef(false);
  useEffect(() => {
    if (!room || !self || ended) return;
    const presentNow = room.participants.some(p => p.name === self.name && p.client === 'web');
    if (presentNow) {
      sawSelfRef.current = true;
      return;
    }
    if (sawSelfRef.current) {
      // We were here, now we're not — host kicked us.
      sessionStorage.removeItem(`room:${code}:self`);
      (async () => {
        const { showToast } = await import('../components/Toast.js');
        showToast('You were removed from the meeting by the host');
      })();
      navigate(`/j/${code}`, { replace: true });
    }
  }, [room, self, ended, code, navigate]);

  // Track last message time for idle detection
  useEffect(() => {
    if (messages.length > 0) {
      lastMsgTimeRef.current = Date.now();
      // Reset idle prompt if new message arrives
      if (showIdlePrompt) {
        setShowIdlePrompt(false);
        setCountdown(AUTO_CLOSE_COUNTDOWN);
        if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
      }
    }
  }, [messages.length]);

  // Idle timer: show prompt after 5 min of no messages
  useEffect(() => {
    if (ended) return;

    function resetIdle() {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        setShowIdlePrompt(true);
      }, IDLE_TIMEOUT_MS);
    }

    resetIdle();
    // Reset on new messages
    const interval = setInterval(() => {
      if (Date.now() - lastMsgTimeRef.current < IDLE_TIMEOUT_MS) return;
      if (!showIdlePrompt) setShowIdlePrompt(true);
    }, 10_000);

    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      clearInterval(interval);
    };
  }, [ended, messages.length]);

  // Auto-close countdown
  useEffect(() => {
    if (!showIdlePrompt || ended) return;

    setCountdown(AUTO_CLOSE_COUNTDOWN);
    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          handleEndMeeting();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    };
  }, [showIdlePrompt, ended]);

  const dismissIdlePrompt = useCallback(() => {
    setShowIdlePrompt(false);
    setCountdown(AUTO_CLOSE_COUNTDOWN);
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    lastMsgTimeRef.current = Date.now(); // reset idle clock
  }, []);

  // Host-only. Toggle mute on a participant. Muted participants stay in
  // the room (presence + read access intact) but room_send is rejected
  // server-side until they're unmuted.
  async function handleToggleMute(p: { name: string; client: 'web' | 'cc'; canSpeak?: boolean }) {
    if (!room || !self || room.createdBy !== self.name) return;
    const wantMuted = p.canSpeak !== false; // currently can speak → going to mute
    try {
      const client = createClient(ENV.upstash);
      await setMuted(client, code, self.name, p.name, p.client, wantMuted);
      await refreshRoom();
    } catch (e) {
      const { showToast } = await import('../components/Toast.js');
      showToast(e instanceof Error ? `Mute toggle failed: ${e.message}` : 'Mute toggle failed');
    }
  }

  // Host-only. Removes (name, client) from the room. The kicked client will
  // notice it's gone on its next room poll / room_listen and can be told to
  // leave by their UI. Reconnection is not blocked — they'd need to be re-joined.
  async function handleKick(p: { name: string; client: 'web' | 'cc' }) {
    if (!room || !self || room.createdBy !== self.name) return;
    if (p.name === self.name && p.client === 'web') return; // host can't kick themselves
    if (!confirm(`Remove ${p.name} (${p.client}) from the room?`)) return;
    try {
      const client = createClient(ENV.upstash);
      await removeParticipant(client, code, self.name, p.name, p.client);
      await refreshRoom();
    } catch (e) {
      const { showToast } = await import('../components/Toast.js');
      showToast(e instanceof Error ? `Kick failed: ${e.message}` : 'Kick failed');
    }
  }

  async function handleEndMeeting() {
    try {
      const client = createClient(ENV.upstash);
      await endRoomApi(client, code);
      setEnded(true);
      setShowIdlePrompt(false);
      if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
      // Per Robin: attachments shouldn't outlive the meeting. Fire-and-
      // forget so a Blob hiccup doesn't keep the user staring at a spinner.
      // Best-effort only — TTL expiry is handled by a cron sweep later.
      void deleteRoomBlobs(code);
    } catch {
      // ignore — room may already be ended
      setEnded(true);
    }
  }

  async function handleDraft() {
    if (!room || !self) return;
    setDrafting(true); setDraftErr(null);
    try {
      const suggestion = await draftReply({
        topic: room.topic,
        userName: self.name,
        userRole: self.role,
        history: messages,
      });
      setText(suggestion);
    } catch (e) {
      setDraftErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDrafting(false);
    }
  }

  const [mobilePanel, setMobilePanel] = useState<'chat' | 'people' | 'outputs'>('chat');
  const [minutesText, setMinutesText] = useState<string>('');
  const [minutesBusy, setMinutesBusy] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const artifacts = extractArtifacts(messages);

  // Hydrate cached minutes from Redis on mount (spec §3.3 — room-min:{code})
  useEffect(() => {
    const client = createClient(ENV.upstash);
    client.command<string | null>(['GET', `room-min:${code}`])
      .then(cached => { if (cached) setMinutesText(cached); })
      .catch(() => {});
  }, [code]);

  async function handleMinutes() {
    if (!room) return;
    setMinutesBusy(true);
    try {
      const text = await generateMinutes({ topic: room.topic, history: messages });
      setMinutesText(text);
      // Cache the minutes so other clients see the same version (spec §3.3)
      const client = createClient(ENV.upstash);
      await client.command(['SET', `room-min:${code}`, text, 'EX', 86400]);
    } catch (e) {
      setMinutesText(e instanceof Error ? `Error: ${e.message}` : String(e));
    } finally {
      setMinutesBusy(false);
    }
  }

  async function handleExportReport() {
    if (!room) return;
    setReportBusy(true);
    try {
      const client = createClient(ENV.upstash);
      await createRoomReport(client, room, messages);
      navigate(`/r/${code}/report`);
    } catch (e) {
      const { showToast } = await import('../components/Toast.js');
      showToast(e instanceof Error ? `Export failed: ${e.message}` : 'Export failed');
    } finally {
      setReportBusy(false);
    }
  }

  useEffect(() => {
    feedRef.current?.scrollTo(0, feedRef.current.scrollHeight);
  }, [messages.length]);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const resetOnDesktop = () => {
      if (mq.matches) setMobilePanel('chat');
    };
    resetOnDesktop();
    mq.addEventListener('change', resetOnDesktop);
    return () => mq.removeEventListener('change', resetOnDesktop);
  }, []);

  if (error) return <div className="p-10 text-red-600">{error}</div>;
  if (!self) return <div className="p-10 text-ink-soft">Redirecting to join…</div>;
  if (!room) return <div className="p-10 text-ink-soft">Loading…</div>;

  // From here down `self` is non-null (early-returned above). Capture it in a
  // narrowed const so closures inside JSX don't have to re-check.
  const me = self;

  // Speaking gate: the host is always allowed; other participants need the
  // Speaking gate: everyone joins able to speak. The host can mute via
  // setMuted() to suspend a specific participant. canSpeak === undefined
  // (legacy rooms before this field existed) is treated as approved so
  // already-running meetings don't break.
  const isHost = room.createdBy === me.name;
  const myParticipant = room.participants.find(p => p.name === me.name && p.client === 'web');
  const myCanSpeak = isHost || myParticipant?.canSpeak !== false;
  const mutedCount = room.participants.filter(p => p.canSpeak === false).length;

  async function send() {
    const body = text.trim();
    if ((!body && attachments.length === 0) || ended) return;
    const msg: Message = {
      id: Date.now(),
      type: 'msg',
      name: me.name,
      role: me.role,
      initials: initialsFor(me.name),
      color: colorForName(me.name),
      client: 'web',
      text: body,
      time: Date.now(),
      attachments: attachments.length ? attachments : undefined,
    };
    setText('');
    setAttachments([]);
    try {
      await sendMessage(msg);
    } catch (e) {
      const { showToast } = await import('../components/Toast.js');
      showToast(e instanceof Error ? `Send failed: ${e.message}` : 'Send failed');
      setText(body); // restore draft
      setAttachments(attachments);
    }
  }

  async function addFiles(files: FileList | File[]) {
    const incoming = Array.from(files);
    if (!incoming.length) return;
    setAttachBusy(true);
    try {
      const slots = Math.max(0, MAX_ATTACHMENTS_PER_MESSAGE - attachments.length);
      const selected = incoming.slice(0, slots);
      if (incoming.length > slots) {
        const { showToast } = await import('../components/Toast.js');
        showToast(`Only ${MAX_ATTACHMENTS_PER_MESSAGE} attachments per message`);
      }
      const prepared: MessageAttachment[] = [];
      for (const file of selected) {
        prepared.push(await uploadAttachment(file, code));
      }
      setAttachments(prev => [...prev, ...prepared].slice(0, MAX_ATTACHMENTS_PER_MESSAGE));
    } catch (e) {
      const { showToast } = await import('../components/Toast.js');
      showToast(e instanceof Error ? e.message : 'Attachment failed');
    } finally {
      setAttachBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData.files).filter(file => file.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    await addFiles(files);
  }

  return (
    <div className="h-full flex items-center justify-center px-3 py-4">
      <div className="w-full max-w-7xl h-[88vh] grid grid-rows-[auto_auto_1fr] bg-surface border border-border rounded-xl shadow-card overflow-hidden">
        <header className="px-4 py-3 border-b border-border-faint flex justify-between items-center bg-surface">
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{room.topic}</div>
            <div className="text-[10px] text-ink-soft">
              {ended ? <span className="text-red-500 font-semibold">Meeting ended</span> : `${room.participants.length} participants`}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex">
              {room.participants.slice(0, 5).map((p, i) => (
                <div key={p.name} style={{ marginLeft: i === 0 ? 0 : -6 }} className="ring-2 ring-white rounded-full">
                  <Avatar initials={p.initials} color={p.color} size="sm" />
                </div>
              ))}
            </div>
            <button
              onClick={() => copyText(joinUrl, 'Invite link copied')}
              className="text-[10px] font-semibold text-accent bg-accent-tint px-2 py-1 rounded hover:bg-accent/20"
            >
              Share
            </button>
            <MeetingCodePill code={code} />
          </div>
        </header>

        <div className="lg:hidden grid grid-cols-3 gap-1 border-b border-border-faint bg-surface p-2 text-[11px]">
          {[
            ['chat', 'Chat'],
            ['people', 'People'],
            ['outputs', 'Outputs'],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setMobilePanel(key as 'chat' | 'people' | 'outputs')}
              className={`rounded-lg px-2 py-1.5 font-semibold ${mobilePanel === key ? 'bg-accent text-white' : 'text-ink-soft bg-surface-softer'}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="min-h-0 grid lg:grid-cols-[260px_minmax(0,1fr)_300px] bg-surface-soft">
          <aside className={`${mobilePanel === 'people' ? 'flex' : 'hidden'} lg:flex min-h-0 flex-col border-r border-border-faint bg-surface`}>
            <div className="p-4 border-b border-border-faint">
              <div className="text-[10px] font-semibold uppercase text-ink-faint mb-2">Room</div>
              <h2 className="text-sm font-semibold leading-snug">{room.topic}</h2>
              <div className="mt-3">
                <MeetingCodePill code={code} />
              </div>
              <button
                onClick={() => copyText(joinUrl, 'Invite link copied')}
                className="mt-3 w-full text-[11px] font-semibold text-accent bg-accent-tint px-3 py-2 rounded-lg hover:bg-accent/20"
              >
                Copy invite link
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              <div className="text-[10px] font-semibold uppercase text-ink-faint mb-1">Participants</div>
              <p className="mb-3 text-[10px] leading-relaxed text-ink-soft">
                Listening means the agent is inside a current listen window. Other agent states may still depend on local hooks.
              </p>
              <div className="space-y-2">
                {room.participants.map(p => {
                  const isMeHost = room.createdBy === self.name;
                  const isSelf = p.name === self.name && p.client === 'web';
                  const canKick = isMeHost && !isSelf && !ended;
                  const isMuted = p.canSpeak === false;
                  const canMuteToggle = isMeHost && !isSelf && !ended;
                  const presence = participantPresence(p, now);
                  return (
                    <div key={`${p.name}-${p.client}`} className={`group flex items-center gap-2 rounded-lg border px-2.5 py-2 ${isMuted ? 'border-amber-300 bg-amber-50/60' : 'border-border-faint bg-surface-softer'}`}>
                      <div className={presence.kind === 'idle' ? 'opacity-45' : ''}>
                        <Avatar initials={p.initials} color={p.color} size="sm" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold truncate flex items-center gap-1 flex-wrap">
                          {p.name}
                          {p.name === room.createdBy && <span className="text-[9px] font-semibold text-accent bg-accent-tint px-1 py-px rounded">host</span>}
                          {isMuted && <span className="text-[9px] font-semibold text-amber-700 bg-amber-100 px-1 py-px rounded">muted</span>}
                        </div>
                        <div className="text-[10px] text-ink-soft truncate">
                          {[p.role, p.client].filter(Boolean).join(' · ')}
                        </div>
                        <div className={`mt-0.5 flex items-center gap-1 text-[9px] font-medium ${presence.className}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${presence.dotClassName}`} />
                          <span>{presence.label}</span>
                          {presence.detail && <span className="text-ink-faint">· {presence.detail}</span>}
                        </div>
                      </div>
                      {canMuteToggle && (
                        <button
                          onClick={() => handleToggleMute({ name: p.name, client: p.client, canSpeak: p.canSpeak })}
                          title={isMuted ? `Unmute ${p.name}` : `Mute ${p.name}`}
                          className={`text-[10px] font-semibold px-2 h-6 rounded transition ${isMuted
                            ? 'text-emerald-700 bg-emerald-100 hover:bg-emerald-200'
                            : 'opacity-0 group-hover:opacity-100 focus:opacity-100 text-amber-700 bg-amber-100 hover:bg-amber-200'}`}
                        >
                          {isMuted ? '🔊 Unmute' : '🔇 Mute'}
                        </button>
                      )}
                      {canKick && (
                        <button
                          onClick={() => handleKick({ name: p.name, client: p.client })}
                          title={`Remove ${p.name}`}
                          className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-[10px] font-semibold text-red-600 hover:bg-red-50 w-6 h-6 rounded transition"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="p-4 border-t border-border-faint flex gap-2">
              {!ended && room.createdBy === self.name && (
                <button
                  onClick={handleEndMeeting}
                  className="flex-1 text-[11px] font-semibold text-red-600 bg-red-50 px-3 py-2 rounded-lg hover:bg-red-100"
                >
                  End
                </button>
              )}
              <button onClick={() => navigate('/')} className="flex-1 text-[11px] font-semibold text-ink-muted bg-surface-softer px-3 py-2 rounded-lg">
                Home
              </button>
            </div>
          </aside>

          <section className={`${mobilePanel === 'chat' ? 'flex' : 'hidden'} lg:flex min-h-0 flex-col`}>
            <div className="px-5 py-3 border-b border-border-faint bg-surface flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">Discussion</div>
                <div className="text-[10px] text-ink-soft">Live room chat</div>
              </div>
              {ended && <span className="text-[10px] font-semibold text-red-500">Ended</span>}
            </div>

            <div ref={feedRef} className="flex-1 overflow-y-auto p-5 flex flex-col gap-3 bg-surface-soft relative">
              {(() => {
                // Names that appear with more than one client in the room get
                // disambiguated as "Name · web" / "Name · cc" in each bubble.
                const byName = new Map<string, Set<string>>();
                for (const p of room?.participants ?? []) {
                  if (!byName.has(p.name)) byName.set(p.name, new Set());
                  byName.get(p.name)!.add(p.client);
                }
                const ambiguousNames = new Set<string>();
                for (const [n, cs] of byName) if (cs.size > 1) ambiguousNames.add(n);
                return messages.map(m => (
                  <Bubble
                    key={m.id}
                    message={m}
                    self={m.name === self.name}
                    ambiguousNames={ambiguousNames}
                  />
                ));
              })()}

              {showIdlePrompt && !ended && (
                <div className="sticky bottom-0 mx-auto bg-white border border-border rounded-xl shadow-lg p-4 text-center max-w-sm">
                  <p className="text-sm font-semibold text-ink mb-1">No activity for 1 hour</p>
                  <p className="text-xs text-ink-soft mb-3">Meeting will close in <span className="font-bold text-red-600">{countdown}s</span></p>
                  <div className="flex gap-2 justify-center">
                    <button onClick={dismissIdlePrompt} className="px-4 py-1.5 bg-accent text-white text-xs font-semibold rounded-lg">
                      Keep open
                    </button>
                    <button onClick={handleEndMeeting} className="px-4 py-1.5 bg-red-50 text-red-600 text-xs font-semibold rounded-lg border border-red-200">
                      End now
                    </button>
                  </div>
                </div>
              )}
            </div>

            {ended ? (
              <div className="border-t border-border-faint p-4 bg-surface-softer text-center">
                <p className="text-xs text-ink-soft mb-2">This meeting has ended.</p>
                <div className="flex gap-3 justify-center">
                  <button
                    onClick={async () => {
                      try {
                        const client = createClient(ENV.upstash);
                        await reactivateRoomApi(client, code);
                        // Reset the full idle pipeline. Without these the idle timer
                        // would immediately re-fire (lastMsgTimeRef is still hours
                        // old, showIdlePrompt may still be true) and the room would
                        // close again 5 seconds later — the "reactivate → close →
                        // reactivate → close" loop users hit.
                        lastMsgTimeRef.current = Date.now();
                        setShowIdlePrompt(false);
                        setCountdown(AUTO_CLOSE_COUNTDOWN);
                        if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
                        if (idleTimerRef.current) { clearTimeout(idleTimerRef.current); idleTimerRef.current = null; }
                        setEnded(false);
                        await refreshRoom();
                      } catch {}
                    }}
                    className="text-xs font-semibold text-white bg-accent px-4 py-1.5 rounded-lg"
                  >
                    Reactivate
                  </button>
                  <button onClick={() => navigate('/')} className="text-xs font-semibold text-ink-muted">Back to home</button>
                </div>
              </div>
            ) : !myCanSpeak ? (
              <div className="border-t border-border-faint p-5 bg-amber-50 text-center">
                <div className="text-2xl mb-1">🔇</div>
                <p className="text-sm font-semibold text-amber-900 mb-1">You've been muted by the host</p>
                <p className="text-xs text-amber-800/80 max-w-xs mx-auto">
                  The host ({room.createdBy}) has muted your messages. You can still read the conversation — ask them to unmute (🔊) when you're ready to speak again.
                </p>
              </div>
            ) : (
              <div className="relative border-t border-border-faint p-3 bg-surface flex flex-col gap-2">
                {isHost && mutedCount > 0 && (
                  <div className="text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 flex items-center gap-2">
                    <span>🔇</span>
                    <span>{mutedCount} {mutedCount === 1 ? 'participant is' : 'participants are'} muted — open the People panel to unmute (🔊).</span>
                  </div>
                )}
                {draftErr && <div className="text-[10px] text-red-600">{draftErr}</div>}
                {attachments.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {attachments.map(attachment => (
                      <PendingAttachment
                        key={attachment.id}
                        attachment={attachment}
                        onRemove={() => setAttachments(prev => prev.filter(item => item.id !== attachment.id))}
                      />
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleDraft}
                    disabled={drafting}
                    className="text-[10px] font-semibold text-accent bg-accent-tint px-2 py-1 rounded disabled:opacity-50"
                  >
                    {drafting ? 'Drafting…' : 'Draft'}
                  </button>
                  <VoiceButton
                    onTranscript={(t) => setText(prev => prev.trim() ? `${prev.trim()} ${t}` : t)}
                    disabled={ended}
                  />
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    accept={Array.from(ALLOWED_ATTACHMENT_TYPES).join(',')}
                    onChange={e => { if (e.target.files) void addFiles(e.target.files); }}
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={attachBusy || attachments.length >= MAX_ATTACHMENTS_PER_MESSAGE}
                    title="Attach files"
                    className="h-9 rounded-lg bg-surface-softer border border-border px-2 text-xs font-semibold text-ink-muted disabled:opacity-50"
                  >
                    {attachBusy ? '...' : 'Attach'}
                  </button>
                  <textarea
                    ref={textareaRef}
                    value={text}
                    onChange={e => setText(e.target.value)}
                    onPaste={e => { void handlePaste(e); }}
                    onKeyDown={e => {
                      // Enter sends; Shift+Enter / IME composition lets newlines through.
                      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        send();
                      }
                    }}
                    placeholder="Message the room… (Enter to send, Shift+Enter for newline)"
                    rows={1}
                    style={{ height: TEXTAREA_MIN_HEIGHT, maxHeight: TEXTAREA_MAX_HEIGHT }}
                    className="flex-1 resize-none overflow-y-auto px-3 py-2 bg-surface-softer border border-border rounded-lg text-sm leading-relaxed outline-none focus:border-accent focus:ring-4 focus:ring-accent-tint"
                  />
                  <button
                    onClick={send}
                    disabled={!text.trim() && attachments.length === 0}
                    className="self-end bg-accent text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Send
                  </button>
                </div>
              </div>
            )}
          </section>

          <aside className={`${mobilePanel === 'outputs' ? 'flex' : 'hidden'} lg:flex min-h-0 flex-col border-l border-border-faint bg-surface`}>
            <div className="p-4 border-b border-border-faint">
              <div className="text-[10px] font-semibold uppercase text-ink-faint mb-2">Outputs</div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-surface-softer border border-border-faint p-2">
                  <div className="text-base font-semibold">{messages.length}</div>
                  <div className="text-[10px] text-ink-soft">Messages</div>
                </div>
                <div className="rounded-lg bg-surface-softer border border-border-faint p-2">
                  <div className="text-base font-semibold">{room.participants.length}</div>
                  <div className="text-[10px] text-ink-soft">People</div>
                </div>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-4">
              <div className="mb-5 rounded-xl border border-accent-tint-border bg-accent-tint p-4">
                <h2 className="text-sm font-semibold text-accent-deep mb-2">Report</h2>
                <p className="text-[11px] leading-relaxed text-accent-deep/80 mb-3">Freeze this room into a shareable delivery report.</p>
                <button
                  onClick={handleExportReport}
                  disabled={reportBusy || messages.length === 0}
                  className="w-full bg-accent text-white text-[11px] font-semibold px-3 py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {reportBusy ? 'Saving…' : 'Save & Share'}
                </button>
              </div>

              <div className="mb-5">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold">Artifacts</h2>
                  <span className="text-[10px] text-ink-soft">{artifacts.length}</span>
                </div>
                {artifacts.length ? (
                  <div className="space-y-2">
                    {artifacts.slice(-8).reverse().map(artifact => (
                      <ArtifactCard key={artifact.id} artifact={artifact} />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-border-faint bg-surface-softer p-3 text-[11px] leading-relaxed text-ink-soft">
                    Use [DECISION], [TODO], [STATUS], or [RESULT] in messages to build the delivery log.
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold">Minutes</h2>
                <button
                  onClick={handleMinutes}
                  disabled={minutesBusy}
                  className="bg-accent text-white text-[11px] font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50"
                >
                  {minutesBusy ? 'Generating…' : 'Generate'}
                </button>
              </div>
              <pre className="whitespace-pre-wrap text-xs leading-relaxed text-ink">{minutesText || 'No minutes yet.'}</pre>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function ArtifactCard({ artifact }: { artifact: RoomArtifact }) {
  return (
    <div className="rounded-lg border border-border-faint bg-surface-softer p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className={`text-[9px] font-semibold uppercase ${artifactTone(artifact.kind)}`}>
          {artifactLabel(artifact.kind)}
        </span>
        <span className="text-[9px] text-ink-faint">{artifact.author}</span>
      </div>
      <p className="text-[11px] leading-relaxed text-ink">{artifact.text}</p>
    </div>
  );
}

function PendingAttachment({ attachment, onRemove }: { attachment: MessageAttachment; onRemove: () => void }) {
  return (
    <div className="flex max-w-[220px] items-center gap-2 rounded-lg border border-border bg-surface-softer px-2 py-1.5">
      {attachment.type === 'image' && (
        <img src={attachment.url} alt="" className="h-8 w-8 rounded object-cover" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-semibold text-ink">{attachment.name}</div>
        <div className="text-[10px] text-ink-soft">{formatBytes(attachment.size)}</div>
      </div>
      <button
        onClick={onRemove}
        className="h-6 w-6 rounded text-xs font-bold text-ink-soft hover:bg-surface"
        title={`Remove ${attachment.name}`}
      >
        x
      </button>
    </div>
  );
}

function artifactTone(kind: ArtifactKind): string {
  switch (kind) {
    case 'decision':
      return 'text-emerald-700';
    case 'todo':
      return 'text-amber-700';
    case 'status':
      return 'text-blue-700';
    case 'result':
      return 'text-violet-700';
  }
}

function participantPresence(p: Participant, now: number) {
  if (p.listenUntil && p.listenUntil > now) {
    return {
      kind: 'listening',
      label: 'Listening now',
      detail: '',
      className: 'text-emerald-700',
      dotClassName: 'bg-emerald-500',
    };
  }

  if (now - p.lastSeenAt <= PRESENCE_STALE_MS) {
    return {
      kind: 'online',
      label: 'Online',
      detail: p.client === 'cc' ? 'hook unknown' : '',
      className: 'text-blue-700',
      dotClassName: 'bg-blue-500',
    };
  }

  return {
    kind: 'idle',
    label: 'Idle',
    detail: p.client === 'cc' ? 'not listening' : '',
    className: 'text-ink-faint',
    dotClassName: 'bg-slate-300',
  };
}
