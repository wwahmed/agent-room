import { useRef, useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useRoom } from '../hooks/useRoom.js';
import { Bubble } from '../components/Bubble.js';
import { MeetingCodePill } from '../components/MeetingCodePill.js';
import { Avatar } from '../components/Avatar.js';
import { colorForName, initialsFor } from '../lib/colors.js';
import type { Message } from '@agent-room/shared';
import { draftReply, generateMinutes } from '../lib/ai.js';
import { createClient, endRoom as endRoomApi, reactivateRoom as reactivateRoomApi } from '@agent-room/upstash-client';
import { ENV } from '../env.js';
import { copyText } from '../lib/copy.js';

const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const AUTO_CLOSE_COUNTDOWN = 5;         // seconds

export function Room() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const stored = sessionStorage.getItem(`room:${code}:self`);
  const self = stored ? JSON.parse(stored) as { name: string; role: string } : { name: 'Guest', role: '' };
  const { room, messages, error, sendMessage } = useRoom(code, self.name);
  const [text, setText] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [draftErr, setDraftErr] = useState<string | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  // --- Share ---
  const joinUrl = `${window.location.origin}/j/${code}`;

  // --- End meeting ---
  const [ended, setEnded] = useState(false);
  const [showIdlePrompt, setShowIdlePrompt] = useState(false);
  const [countdown, setCountdown] = useState(AUTO_CLOSE_COUNTDOWN);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastMsgTimeRef = useRef(Date.now());

  // Sync ended state from room
  useEffect(() => {
    if (room?.status === 'ended') setEnded(true);
  }, [room?.status]);

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

  async function handleEndMeeting() {
    try {
      const client = createClient(ENV.upstash);
      await endRoomApi(client, code);
      setEnded(true);
      setShowIdlePrompt(false);
      if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    } catch {
      // ignore — room may already be ended
      setEnded(true);
    }
  }

  async function handleDraft() {
    if (!room) return;
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

  const [tab, setTab] = useState<'discussion' | 'minutes'>('discussion');
  const [minutesText, setMinutesText] = useState<string>('');
  const [minutesBusy, setMinutesBusy] = useState(false);

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

  useEffect(() => {
    feedRef.current?.scrollTo(0, feedRef.current.scrollHeight);
  }, [messages.length]);

  if (error) return <div className="p-10 text-red-600">{error}</div>;
  if (!room) return <div className="p-10 text-ink-soft">Loading…</div>;

  async function send() {
    const body = text.trim();
    if (!body || ended) return;
    const msg: Message = {
      id: Date.now(),
      type: 'msg',
      name: self.name,
      role: self.role,
      initials: initialsFor(self.name),
      color: colorForName(self.name),
      client: 'web',
      text: body,
      time: Date.now(),
    };
    setText('');
    try {
      await sendMessage(msg);
    } catch (e) {
      const { showToast } = await import('../components/Toast.js');
      showToast(e instanceof Error ? `Send failed: ${e.message}` : 'Send failed');
      setText(body); // restore draft
    }
  }

  return (
    <div className="h-full flex items-center justify-center">
      <div className="w-full max-w-2xl h-[85vh] flex flex-col bg-surface border border-border rounded-xl shadow-card overflow-hidden">
        <header className="px-4 py-3 border-b border-border-faint flex justify-between items-center bg-surface">
          <div>
            <div className="text-sm font-semibold">{room.topic}</div>
            <div className="text-[10px] text-ink-soft">
              {ended ? <span className="text-red-500 font-semibold">Meeting ended</span> : `${room.participants.length} participants`}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => copyText(joinUrl, 'Invite link copied')}
              className="text-[10px] font-semibold text-accent bg-accent-tint px-2 py-1 rounded hover:bg-accent/20"
            >
              Share
            </button>
            {!ended && room.createdBy === self.name && (
              <button
                onClick={handleEndMeeting}
                className="text-[10px] font-semibold text-red-600 bg-red-50 px-2 py-1 rounded hover:bg-red-100"
              >
                End
              </button>
            )}
            <div className="flex">
              {room.participants.slice(0, 5).map((p, i) => (
                <div key={p.name} style={{ marginLeft: i === 0 ? 0 : -6 }} className="ring-2 ring-white rounded-full">
                  <Avatar initials={p.initials} color={p.color} size="sm" />
                </div>
              ))}
            </div>
            <MeetingCodePill code={code} />
          </div>
        </header>

        <div className="flex gap-4 px-4 py-2 border-b border-border-faint bg-surface text-[11px]">
          <button onClick={() => setTab('discussion')} className={tab === 'discussion' ? 'font-semibold text-ink' : 'text-ink-soft'}>Discussion</button>
          <button onClick={() => setTab('minutes')} className={tab === 'minutes' ? 'font-semibold text-ink' : 'text-ink-soft'}>Minutes</button>
        </div>

        {tab === 'discussion' ? (
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

            {/* Idle auto-close prompt */}
            {showIdlePrompt && !ended && (
              <div className="sticky bottom-0 mx-auto bg-white border border-border rounded-xl shadow-lg p-4 text-center max-w-sm">
                <p className="text-sm font-semibold text-ink mb-1">No activity for 5 minutes</p>
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
        ) : (
          <div className="flex-1 overflow-y-auto p-5 bg-surface-soft">
            <button
              onClick={handleMinutes}
              disabled={minutesBusy}
              className="mb-4 bg-accent text-white text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50"
            >
              {minutesBusy ? 'Generating…' : 'Generate minutes'}
            </button>
            <pre className="whitespace-pre-wrap text-xs leading-relaxed text-ink">{minutesText}</pre>
          </div>
        )}

        {/* Input bar — disabled when ended */}
        {ended ? (
          <div className="border-t border-border-faint p-4 bg-surface-softer text-center">
            <p className="text-xs text-ink-soft mb-2">This meeting has ended.</p>
            <div className="flex gap-3 justify-center">
              <button onClick={async () => {
                try {
                  const client = createClient(ENV.upstash);
                  await reactivateRoomApi(client, code);
                  setEnded(false);
                } catch {}
              }} className="text-xs font-semibold text-white bg-accent px-4 py-1.5 rounded-lg">Reactivate</button>
              <button onClick={() => navigate('/')} className="text-xs font-semibold text-ink-muted">Back to home</button>
            </div>
          </div>
        ) : (
          <div className="border-t border-border-faint p-3 bg-surface flex flex-col gap-2">
            {draftErr && <div className="text-[10px] text-red-600">{draftErr}</div>}
            <div className="flex items-center gap-2">
              <button
                onClick={handleDraft}
                disabled={drafting}
                className="text-[10px] font-semibold text-accent bg-accent-tint px-2 py-1 rounded disabled:opacity-50"
              >
                {drafting ? 'Drafting…' : '✨ Draft'}
              </button>
              <input
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder="Message the room…"
                className="flex-1 px-3 py-2 bg-surface-softer border border-border rounded-lg text-sm outline-none focus:border-accent focus:ring-4 focus:ring-accent-tint"
              />
              <button onClick={send} className="bg-accent text-white px-4 py-2 rounded-lg text-sm font-semibold">Send</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
