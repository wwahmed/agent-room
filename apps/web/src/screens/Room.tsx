import { Fragment, useRef, useState, useEffect, useLayoutEffect, useMemo, useCallback, type ClipboardEvent, type DragEvent } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { OLDER_PAGE_SIZE, useRoom } from '../hooks/useRoom.js';
import { MessageRow, isSameGroup, hasRenderableContent } from '../components/MessageRow.js';
import { WorkspaceSwitcher } from '../components/WorkspaceSwitcher.js';
import { ActivityNote, ClampedNoteBody } from '../components/ActivityNote.js';
import { collapseStatusRuns } from '../lib/statusRuns.js';
import { chromeStep, initialChromeVis } from '../lib/chromeVisibility.js';
import { MessageDayDivider } from '../components/MessageDayDivider.js';
import { RoomHeader } from '../components/RoomHeader.js';
import { SummonAgentSheet } from '../components/SummonAgentSheet.js';
import { AgentDetailsSheet } from '../components/AgentDetailsSheet.js';
import { BriefCard } from '../components/BriefCard.js';
import { CommandPalette } from '../components/CommandPalette.js';
import { parseBriefCommand } from '../lib/briefCommand.js';
import { runBrief } from '../lib/runBrief.js';
import { filterSlashCommands, type SlashCommand } from '../lib/slashCommands.js';
import { CommandSearch } from '../components/CommandSearch.js';
import { Inspector, type InspectorTab } from '../components/Inspector.js';
import { RecoverHostButton } from '../components/RecoverHostButton.js';
import { RenameRoomControl } from '../components/RenameRoomControl.js';
import { WorkspaceRail } from '../components/WorkspaceRail.js';
import { RoomListPane } from '../components/RoomListPane.js';
import { ProjectPanel } from '../components/ProjectPanel.js';
import { QuestionArtifactCard } from '../components/QuestionArtifactCard.js';
import { QuestionArtifactSheet } from '../components/QuestionArtifactSheet.js';
import { VoiceButton, type VoiceButtonHandle } from '../components/VoiceButton.js';
import { AttachmentSheet } from '../components/AttachmentSheet.js';
import { MeetingCodePill } from '../components/MeetingCodePill.js';
import { Avatar } from '../components/Avatar.js';
import { AgentAvatar } from '../components/AgentAvatar.js';
import { brandForSender, participantKindLabel } from '../lib/agentBrand.js';
import { colorForName, initialsFor } from '../lib/colors.js';
import { filterMentionCandidates, insertMention, mentionQueryAt, mentionToken, textMentionsSelf } from '../lib/mentions.js';
import { composerEnterAction } from '../lib/composerKeys.js';
import { artifactLabel, type ArtifactKind, type Message, type MessageAttachment, type MessageReplyRef, type Participant, type ReplyMode, type ReplyModeConfig, type RoomArtifact, type RoomQuestion, type SystemEventType } from '@agent-room/shared';
import { appendSystemMessage, directInvoke, getRoom, getRoomArtifacts, getTaskBoard, getTurnState, hostSkipCurrent, joinRoom, listOwnerQuestions, reactToMessage, setMuted, setReplyMode, createClient, createRoomReport, endRoom as endRoomApi, reactivateRoom as reactivateRoomApi, removeParticipant, verifyHostKey, archiveRoomAction, listSummonedAgents, dismissSummonedAgent, type BoardTask, type TurnState } from '../lib/api.js';
import { copyText } from '../lib/copy.js';
import { templateById } from '../lib/templates.js';
import { ALLOWED_ATTACHMENT_TYPES, MAX_ATTACHMENTS_PER_MESSAGE, deleteRoomBlobs, formatBytes, uploadAttachment } from '../lib/upload.js';
import { fetchIdentity, lastRole, rememberRole } from '../lib/identity.js';
import {
  firstUnreadMessageIndex,
  getReadCount,
  isReactionEvent,
  isSelfAuthored,
  isStatusPing,
  markRoomRead,
  markSelfMessageSeen,
  unmarkSelfMessageSeen,
} from '../lib/unread.js';
import { withinAnchoredMutation } from '../lib/readingAnchor.js';
import { fetchHealth } from '../lib/api.js';
import { messageTime, relativeTime } from '../lib/relativeTime.js';
import { artifactsForRoom, hasLineMarker, focusRecoveryCard, isCurrentSeek, isFailedCard, nextFocusAction, outputsViewState, railSectionCount, seekExitRecovery, seekFailureReducer, seekPageBudget, seekStep, type ArtifactFetchState, type SeekRecovery } from '../lib/outputsState.js';
import { armArrivalFlash } from '../lib/arrivalFlash.js';
import { presenceView, canRecover, recoveryPrompt, indexHealth, healthKey, type ParticipantHealth } from '../lib/presence.js';
import { startsMessageDay } from '../lib/messageDays.js';

const IDLE_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour — long enough that humans + agents discussing intermittently don't trip it
const AUTO_CLOSE_COUNTDOWN = 5;          // seconds
interface SelfIdentity { name: string; role: string }
interface AttachmentUploadJob {
  id: string;
  file: File;
  state: 'uploading' | 'failed';
  error?: string;
}

function readStoredSelf(code: string): SelfIdentity | null {
  const stored = sessionStorage.getItem(`room:${code}:self`);
  if (!stored) return null;
  try {
    return JSON.parse(stored) as SelfIdentity;
  } catch {
    return null;
  }
}

// T-05 composer (host direction 2026-07-13): rest as ONE line so reading
// gets the screen back, auto-grow line-by-line while typing up to ~6
// lines, then scroll internally. An explicit expand control opens a
// larger writing surface for long drafting. Supersedes T-09's
// always-four-line resting height.
// T-64: Chat sits alongside the former Inspector tabs as an equal.
type MainTab = 'chat' | InspectorTab;
// T-42: every tab is icon + text label — the 16px/1.5-stroke line set from the
// T-38 charter. Icons disambiguate at a glance; the label is never dropped.
// T-71: the switcher holds FOUR workspace destinations. Room is now Settings,
// reached through the header overflow (and still addressable via ?panel=room)
// — a settings page is not a sibling of the work surfaces.
const MAIN_TABS: Array<{ key: MainTab; label: string; icon: React.ReactNode }> = [
  { key: 'chat', label: 'Chat', icon: <path d="M2 3.5h12v8H8.5L5 14v-2.5H2v-8Z" /> },
  { key: 'project', label: 'Project', icon: <><rect x="2" y="2.5" width="12" height="11" rx="1.5" /><path d="M6 2.5v11M2 6h12" /></> },
  { key: 'people', label: 'People', icon: <><circle cx="5.5" cy="5" r="2.25" /><path d="M1.75 13c.5-2.2 2-3.5 3.75-3.5S8.75 10.8 9.25 13" /><circle cx="11.5" cy="5.5" r="1.75" /><path d="M10.9 9.6c1.6.2 2.8 1.4 3.2 3.4" /></> },
  { key: 'outputs', label: 'Outputs', icon: <><path d="M8 1.75 14 4.5v7L8 14.25 2 11.5v-7L8 1.75Z" /><path d="M2 4.5 8 7.25l6-2.75M8 7.25v7" /></> },
  // T-71 rev (Waqas): room control lives in the CENTER cluster alongside the
  // work surfaces, not hidden in a right-side overflow.
  { key: 'room', label: 'Settings', icon: <><circle cx="8" cy="8" r="2" /><path d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4M12.6 12.6l-1.4-1.4M4.8 4.8 3.4 3.4" /></> },
];

// T-71 page anatomy (Notion-borrowed): every workspace destination is a PAGE
// — title, one-sentence purpose, compact live summary, one primary action —
// never a bare pane of rows.
function PageScaffold({ title, purpose, summary, action, children }: {
  title: string;
  purpose: string;
  summary?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="px-4 pb-8 pt-5 sm:px-6">
      <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[24px] font-bold leading-tight tracking-tight text-ink">{title}</h2>
          <p className="mt-1 text-[16px] leading-relaxed text-ink-soft sm:text-[15px]">{purpose}</p>
        </div>
        {action}
      </header>
      {summary && <div className="mb-4 flex flex-wrap items-center gap-2">{summary}</div>}
      {children}
    </section>
  );
}

// Solid tint tokens, never alpha washes: text sits on a KNOWN surface in
// both themes (VA-0051 — the wash rendered 4.44:1 under the floor).
const CHIP_TONES = {
  ok: 'border-success/40 bg-success-tint text-success',
  warn: 'border-warning/40 bg-warning-tint text-warning',
  quiet: 'border-border-faint bg-surface-softer text-ink-soft',
} as const;

function SummaryChip({ tone, children }: { tone: keyof typeof CHIP_TONES; children: React.ReactNode }) {
  return <span className={`rounded-full border px-2.5 py-1 text-[15px] font-semibold sm:text-[14px] ${CHIP_TONES[tone]}`}>{children}</span>;
}

// T-44: People shares the facepile's presence vocabulary — green = healthy
// (solid dot while a listen loop is armed, ring when merely heard recently),
// amber/red TRIANGLES for stale/disconnected, exactly the shapes the room
// cards use. Color + shape + row dimming + the worded label, never color
// alone. Labels keep the T-68 listening/online distinction.
const STATE_TONE_PRESENCE = {
  listening: { text: 'text-success', glyph: 'dot' },
  online: { text: 'text-success', glyph: 'ring' },
  stale: { text: 'text-warning', glyph: 'triangle' },
  disconnected: { text: 'text-danger', glyph: 'triangle' },
} as const;

function presenceGlyph(glyph: 'dot' | 'ring' | 'triangle') {
  if (glyph === 'dot') return <span className="h-2 w-2 rounded-full bg-current" aria-hidden="true" />;
  if (glyph === 'ring') return <span className="h-2 w-2 rounded-full border-[1.5px] border-current" aria-hidden="true" />;
  return (
    <svg viewBox="0 0 16 16" width="10" height="10" fill="currentColor" aria-hidden="true">
      <path d="M8 1.8 15.2 14H.8L8 1.8Z" />
    </svg>
  );
}

const TEXTAREA_MIN_HEIGHT = 44;
const TEXTAREA_MAX_HEIGHT = 180;
const TEXTAREA_EXPANDED_MIN = 240;
const TEXTAREA_EXPANDED_MAX = 360;
// T-128: the instant voice recording starts, the draft field opens already
// multi-line (~3 lines) so it reads as a live-transcription surface, visibly
// different from the single-line box you type into. It still grows with the
// words under the T-119/T-120 full-width and T-85 phone-cap rules.
const TEXTAREA_DICTATING_MIN = 96;
// Enter is a newline on every device (host direction); Cmd/Ctrl+Enter
// sends on hardware keyboards. IS_TOUCH only tunes the placeholder.
const IS_TOUCH = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

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
    if (self) return;
    // No stored identity for this tab. Before bouncing to the Join form,
    // try the Access-authenticated identity (/api/me): the single-user
    // self-host promise is that the authenticated owner never types a
    // name/role. Anonymous contexts fall through to /j/ as before.
    let cancelled = false;
    (async () => {
      const identity = await fetchIdentity();
      if (cancelled) return;
      if (!identity) {
        navigate(`/j/${code}`, { replace: true });
        return;
      }
      try {
        const client = createClient();
        const room = await getRoom(client, code);
        if (identity.name === room.createdBy) {
          const hostKey = localStorage.getItem(`room:${code}:hostKey`)
            ?? sessionStorage.getItem(`room:${code}:hostKey`)
            ?? undefined;
          await verifyHostKey(client, code, hostKey);
        }
        const role = identity.role || lastRole();
        const joined = await joinRoom(client, code, {
          name: identity.name,
          role,
          color: colorForName(identity.name),
          initials: initialsFor(identity.name),
          client: 'web' as const,
          joinedAt: Date.now(),
          lastSeenAt: Date.now(),
        }, { priorIdentity: { name: identity.name, client: 'web' } });
        if (cancelled) return;
        const assigned: SelfIdentity = { name: joined.participant.name, role };
        sessionStorage.setItem(`room:${code}:self`, JSON.stringify(assigned));
        rememberRole(role);
        _setSelf(assigned);
      } catch {
        if (!cancelled) navigate(`/j/${code}`, { replace: true });
      }
    })();
    return () => { cancelled = true; };
  }, [self, code, navigate]);
  const { room, messages, error, degraded, sendMessage, refreshRoom, forceRefresh, messageTotal, hasOlder, loadingOlder, loadOlder, patchMessageReactions } = useRoom(code, self?.name ?? '');
  const [text, setText] = useState('');
  // T-09: active @mention query in the composer — where the token starts, what
  // has been typed so far, and which candidate is keyboard-highlighted.
  const [mention, setMention] = useState<{ start: number; query: string; index: number } | null>(null);
  // T-18: prev/next navigation through messages that mention the signed-in
  // user. Cursor is a message ID (stable across older-page prepends, unlike a
  // position); seekingOlder drives the paged-out-history search.
  const [mentionCursorId, setMentionCursorId] = useState<number | null>(null);
  const [mentionSeeking, setMentionSeeking] = useState(false);
  // T-59: the composer draft captured when dictation starts, so live transcript
  // can stream in as `base + spoken` without clobbering what was already typed.
  const dictationBaseRef = useRef<string | null>(null);
  const dictationUndoRef = useRef('');
  const [dictationDraft, setDictationDraft] = useState(false);
  // T-138: the mic and keyboard must not fight for the draft. Typing while
  // recording pauses dictation (voiceRef.pause); the trigger then shows a
  // resume state and tapping it appends after the current draft.
  const voiceRef = useRef<VoiceButtonHandle>(null);
  const [dictationPaused, setDictationPaused] = useState(false);
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  // T-119: while dictation is ACTIVE the recording overlay carries every
  // control, so the trigger cluster yields its row slots and the draft
  // textarea takes the full composer width.
  const [dictating, setDictating] = useState(false);
  const [attachBusy, setAttachBusy] = useState(false);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  // T-80: the paperclip trigger — focus returns here on every sheet exit.
  // T-84: phones render the paperclip LEFT of the field (its own button),
  // so the sheet's focus return targets whichever trigger is visible.
  const attachTriggerRef = useRef<HTMLButtonElement>(null);
  // T-86: inert state-injection hook for the gate's voice-draft fixture —
  // headless capture has no microphone, and this is the state where send
  // controls historically left the screen. Explicit query param only;
  // for a real user it merely fills a local draft.
  useEffect(() => {
    // Non-production guard (design lead finding 3): the injection hook only
    // answers on loopback origins — the gate's staging server — never on the
    // public origin.
    const host = window.location.hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') return;
    if (new URLSearchParams(window.location.search).get('gateFixture') !== 'voice-draft') return;
    setText(`Voice transcript fixture: ${'the reader keeps dictating a long update without pausing so the field must cap and scroll internally '.repeat(6)}`);
    setDictationDraft(true);
  }, []);
  const [attachmentJobs, setAttachmentJobs] = useState<AttachmentUploadJob[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [modeBusy, setModeBusy] = useState(false);
  const [turnState, setTurnState] = useState<TurnState | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  // Resizable right "Room context" rail (house taste), persisted; drag left edge.
  const rightAsideRef = useRef<HTMLElement>(null);
  const rightDragRef = useRef(false);
  const [rightPaneWidth, setRightPaneWidth] = useState<number>(() => {
    try { const v = Number(localStorage.getItem('roomctx:width')); if (v >= 240 && v <= 520) return v; } catch { /* private mode */ }
    return 300;
  });
  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!rightDragRef.current || !rightAsideRef.current) return;
      const right = rightAsideRef.current.getBoundingClientRect().right;
      setRightPaneWidth(Math.min(520, Math.max(240, right - e.clientX)));
    };
    const up = () => {
      if (!rightDragRef.current) return;
      rightDragRef.current = false;
      document.body.style.userSelect = '';
      setRightPaneWidth(w => { try { localStorage.setItem('roomctx:width', String(Math.round(w))); } catch { /* ignore */ } return w; });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, []);
  // T-71: Offline people are collapsed out of the way by default.
  const [showOffline, setShowOffline] = useState(false);
  // T-71: light task pulse for the desktop contextual rail (60s cadence —
  // the rail is a summary, ProjectPanel owns the live board).
  const [taskPulse, setTaskPulse] = useState<BoardTask[] | null>(null);
  const [boardErrorRoom, setBoardErrorRoom] = useState<string | null>(null);
  const [boardNonce, setBoardNonce] = useState(0);
  // T-71 durable produced work: Outputs and the rail read the room-wide
  // server index, NEVER the paged transcript window (review-found
  // regression: old Decisions vanished as pagination advanced).
  const [artifactState, setArtifactState] = useState<ArtifactFetchState | null>(null);
  const [artifactsErrorRoom, setArtifactsErrorRoom] = useState<string | null>(null);
  const [artifactsNonce, setArtifactsNonce] = useState(0);
  // Stale data is unrenderable BY CONSTRUCTION: a fetch result only counts
  // for the room it was fetched for (rev15 review — a reset effect still
  // permitted one stale paint).
  const serverArtifacts = artifactsForRoom(artifactState, code);
  const artifactsError = artifactsErrorRoom === code;
  // Sweep 2 (T-46): Outputs artifact list can expand past the newest 8.
  const [showAllArtifacts, setShowAllArtifacts] = useState(false);
  // T-71: Outputs filter chips — deliverables/artifacts by kind.
  const [outputsFilter, setOutputsFilter] = useState<'all' | ArtifactKind>('all');
  const [ownerQuestions, setOwnerQuestions] = useState<RoomQuestion[]>([]);
  const [openQuestionId, setOpenQuestionId] = useState<string | null>(null);
  useEffect(() => {
    const isOwner = Boolean(room && self && room.createdBy === self.name);
    if (!isOwner) {
      setOwnerQuestions([]);
      return;
    }
    let cancelled = false;
    const pull = async () => {
      try {
        const questions = await listOwnerQuestions(createClient(), code);
        if (!cancelled) setOwnerQuestions(questions);
      } catch { /* the tab carries the actionable error; the badge stays quiet */ }
    };
    void pull();
    const timer = window.setInterval(() => { void pull(); }, 10_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [code, room?.createdBy, self?.name]);

  // T-42: DURABLE panel deep-links. /r/CODE?panel=<tab> is a real address for
  // every panel (people/project/outputs/room): landing on it opens that tab,
  // refreshing keeps it, and switching tabs rewrites the param in place
  // (replaceState — no history spam, so Back still leaves the room). T-34:
  // keyed on location.search so the pane facepile can target the room that is
  // ALREADY open, which changes only the query string, not `code`.
  const location = useLocation();
  useEffect(() => {
    const panel = new URLSearchParams(window.location.search).get('panel');
    // T-71: ?panel=room stays a durable address even though Settings left the
    // switcher — it now opens the Settings page.
    if (panel && (panel === 'room' || MAIN_TABS.some(t => t.key === panel))) setMainTab(panel as MainTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, location.search]);
  // T-71: Settings' Back returns to the destination the reader came from.
  const prevTabRef = useRef<MainTab>('chat');
  const selectTab = (tab: MainTab) => {
    // Opening Outputs refreshes the produced-work index immediately — a new
    // Decision must not wait for the minute poll.
    if (tab === 'outputs') setArtifactsNonce(n => n + 1);
    setMainTab(current => {
      if (tab === 'room' && current !== 'room') prevTabRef.current = current;
      return tab;
    });
    const params = new URLSearchParams(window.location.search);
    if (tab === 'chat') params.delete('panel');
    else params.set('panel', tab);
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  };
  // T-71 (rev16): real provenance jump — page history backward until the
  // source message is loaded, then scroll AND flash it; if Redis has
  // trimmed the source, say so honestly instead of doing nothing.
  const [sourceSeekId, setSourceSeekId] = useState<number | null>(null);
  const seekAttemptsRef = useRef(0);
  // rev19 item 1: a monotonically increasing seek generation. Every async
  // completion carries its ticket and no-ops unless it still matches the
  // current generation/room/target — state reset is not cancellation.
  const seekGenRef = useRef(0);
  const seekIdRef = useRef<number | null>(null);
  seekIdRef.current = sourceSeekId;
  const codeRef = useRef(code);
  codeRef.current = code;
  // rev20b: ONE recovery state keyed to the originating source. Both
  // recoverable exits (failed page, budget exhaustion) land here; the card
  // itself renders the inline error + Retry source jump.
  const [seekFailure, setSeekFailure] = useState<SeekRecovery | null>(null);
  // The ARTIFACT the user activated — failure identity is the card, not the
  // source message (one message can yield several cards).
  const seekArtifactIdRef = useRef<string | null>(null);
  const enterSeekExit = (exit: 'failed-page' | 'give-up-trimmed' | 'give-up-error', sourceMessageId: number) => {
    seekGenRef.current += 1;
    seekAttemptsRef.current = 0;
    setSourceSeekId(null);
    const artifactId = seekArtifactIdRef.current;
    if (!artifactId && exit !== 'give-up-trimmed') {
      // Invariant breach (a recoverable jump always starts from a card):
      // fail SAFELY with an honest toast, never a fabricated card id.
      void import('../components/Toast.js').then(({ showToast }) =>
        showToast('Couldn\u2019t reach the source message. Try again from Outputs.', 'error'));
      return;
    }
    const { terminalToast } = seekExitRecovery(exit, artifactId ?? '', sourceMessageId);
    const recovery = artifactId ? seekFailureReducer(null, { type: 'exit', exit, artifactId, sourceMessageId }) : null;
    setSeekFailure(recovery);
    if (recovery) selectTab('outputs');
    if (terminalToast) {
      void import('../components/Toast.js').then(({ showToast }) => showToast(terminalToast, 'error'));
    }
  };
  // Room change must not spill an interrupted seek's paging state into the
  // next room (rev18 review); bumping the generation makes any in-flight
  // completion from the old room inert.
  useEffect(() => { seekGenRef.current += 1; setSourceSeekId(null); setSeekFailure(f => seekFailureReducer(f, { type: 'room-change' })); seekAttemptsRef.current = 0; }, [code]);
  useEffect(() => {
    if (sourceSeekId == null) return;
    const action = seekStep(
      messages.some(m => m.id === sourceSeekId),
      hasOlder,
      loadingOlder,
      seekAttemptsRef.current,
      seekPageBudget(messageTotal, OLDER_PAGE_SIZE),
    );
    if (action === 'found') {
      setSourceSeekId(null);
      setSeekFailure(f => seekFailureReducer(f, { type: 'found' }));
      seekAttemptsRef.current = 0;
      window.setTimeout(() => {
        const el = document.getElementById(`msg-${sourceSeekId}`);
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Flash AFTER the scroll lands — exactly once: scrollend clears the
        // fallback timer, the fallback removes the listener (rev19 item 2,
        // proven with fake timers in lib/arrivalFlash.test.ts).
        armArrivalFlash(el, feedRef.current, 'onscrollend' in window);
      }, 60);
    } else if (action === 'give-up-trimmed' || action === 'give-up-error') {
      enterSeekExit(action, sourceSeekId);
    } else if (action === 'load-more') {
      seekAttemptsRef.current += 1;
      const ticket = { generation: seekGenRef.current, code, target: sourceSeekId };
      void loadOlder().then(result => {
        if (result !== -1) return;
        // A FAILED page stops the seek — but ONLY if this completion still
        // speaks for the current seek (generation + room + target). A stale
        // resolution after a room switch or superseding seek is inert.
        if (!isCurrentSeek(ticket, { generation: seekGenRef.current, code: codeRef.current, target: seekIdRef.current })) return;
        enterSeekExit('failed-page', ticket.target as number);
      });
    } // 'wait': a page is already in flight
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceSeekId, messages, hasOlder, loadingOlder]);

  // T-71: poll the board lightly for the rail's project pulse.
  // Board and artifacts refresh INDEPENDENTLY (review item 2): a Project
  // retry must never churn Outputs state, and vice versa.
  useEffect(() => {
    let cancelled = false;
    const pull = () => {
      getTaskBoard(createClient(), code)
        .then(b => { if (!cancelled) { setTaskPulse(b.tasks); setBoardErrorRoom(null); } })
        .catch(() => { if (!cancelled) { setTaskPulse(null); setBoardErrorRoom(code); } });
    };
    pull();
    const id = window.setInterval(pull, 60_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [code, boardNonce]);
  useEffect(() => {
    let cancelled = false;
    const pull = () => {
      getRoomArtifacts(createClient(), code)
        .then(r => {
          if (cancelled) return;
          if (r.backfillPending) {
            // Another caller is rebuilding the index: stay in Loading and
            // check back shortly — never a false zero (rev16 item 2).
            window.setTimeout(() => { if (!cancelled) setArtifactsNonce(n => n + 1); }, 1500);
            return;
          }
          setArtifactState({ room: code, artifacts: r.artifacts });
          setArtifactsErrorRoom(null);
        })
        .catch(() => { if (!cancelled) setArtifactsErrorRoom(code); });
    };
    pull();
    const id = window.setInterval(pull, 60_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [code, artifactsNonce]);
  // T-64: on desktop the panels are peers of the chat rather than a side column.
  const [mainTab, setMainTab] = useState<MainTab>('chat');
  // Focus handoff is a RENDER-KEYED effect, not a timer: it runs when the
  // live recovery card exists in the Outputs render, and clearing the
  // failure (retry / success / room change) invalidates it — no stale
  // window in which the wrong card can be focused.
  const focusHandledRef = useRef<string | null>(null);
  useEffect(() => {
    // VA-0041 latch: focus ONCE per failure identity, on the first render
    // where the card exists — later polls/filter/pagination churn must not
    // yank the reader back. A new failure focuses once; clearing resets.
    const mounted = seekFailure != null && mainTab === 'outputs'
      && document.querySelector(`[data-artifact-card="${seekFailure.artifactId.replace(/"/g, '')}"]`) != null;
    const next = nextFocusAction(focusHandledRef.current, seekFailure, mounted);
    if (next.focus && seekFailure) focusRecoveryCard(seekFailure.artifactId, document);
    focusHandledRef.current = next.handled;
  }, [seekFailure, mainTab, serverArtifacts, outputsFilter, showAllArtifacts]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [summonOpen, setSummonOpen] = useState(false);
  const [detailsFor, setDetailsFor] = useState<Participant | null>(null);
  useEffect(() => {
    const openSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener('keydown', openSearch);
    return () => document.removeEventListener('keydown', openSearch);
  }, []);
  // T-68: the SERVER's listen-loop verdict (T-66 `health`). The web no longer
  // classifies presence itself — two definitions of "dead" is the bug class that
  // let presence lie in the first place.
  const [health, setHealth] = useState<ParticipantHealth[]>([]);
  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    const client = createClient();
    const pull = async () => {
      try {
        const rows = await fetchHealth(client, code);
        if (!cancelled) setHealth(rows);
      } catch { /* health is advisory; never break the room over it */ }
    };
    void pull();
    const id = window.setInterval(() => { void pull(); }, 15000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [code]);
  const [composerExpanded, setComposerExpanded] = useState(false);
  // T-53/T-54: the message being quote-replied to (composer chip + send payload).
  const [replyingTo, setReplyingTo] = useState<MessageReplyRef | null>(null);
  const [now, setNow] = useState(Date.now());
  const feedRef = useRef<HTMLDivElement>(null);
  // T-48 scroll-anchoring: only auto-stick to the bottom when the reader is
  // already there; if they've scrolled up, hold their spot and count arrivals.
  const atBottomRef = useRef(true);
  const prevLenRef = useRef(0);
  // T-140: the first-unread landing rides on the account read marker, which can
  // resolve a beat AFTER the chat renders. We land immediately, then re-fire the
  // divider landing once the marker settles — but ONLY if the reader has not
  // touched the feed since open (T-112: a late re-fire must never yank someone
  // who already scrolled up to read history).
  const landedRef = useRef(false);
  const openInteractedRef = useRef(false);
  // T-141: slash-command palette. Open when the composer holds a leading "/",
  // dismissed on Esc or after a completion until the text changes again.
  const [paletteDismissed, setPaletteDismissed] = useState(false);
  const [paletteIndex, setPaletteIndex] = useState(0);
  // T-141 rev2: a bare Enter (no arrow navigation) always SENDS/RUNS the command;
  // the palette only completes on explicit arrow-navigation or a single-partial
  // match. Tracks whether the user has moved the highlight this open.
  const [paletteNavigated, setPaletteNavigated] = useState(false);
  const completedCmdRef = useRef<string | null>(null);
  // T-04: previous LAST message id — distinguishes appended messages from a
  // prepended history page — and the scroll geometry captured just before a
  // prepend so the reader's position survives it.
  const prevLastIdRef = useRef<number | null>(null);
  const prependAnchorRef = useRef<{ heightBefore: number; topBefore: number } | null>(null);
  const [unseenCount, setUnseenCount] = useState(0);
  // T-140: bumped when the account read marker resolves after open, forcing the
  // arrival snapshot + first-unread landing to recompute against the real marker.
  const [markerNonce, setMarkerNonce] = useState(0);
  // T-18 rev2 (UX): the navigator earns screen space only for UNSEEN mentions
  // that arrived while scrolled up — never a lifetime count.
  const [unseenMentions, setUnseenMentions] = useState(0);
  // T-65: is the reader parked at the bottom? (ref drives logic, state drives the
  // jump-to-bottom button's visibility.)
  const [atBottom, setAtBottom] = useState(true);

  // T-82: contextual phone chrome. Reading deeper slides the command bar and
  // idle composer out of the viewport; a deliberate reverse gesture, the
  // history top, the newest message, or any pinned state restores them.
  const [chromeHidden, setChromeHidden] = useState(false);
  const chromeVisRef = useRef(initialChromeVis());
  const chromeRafRef = useRef(0);
  const chromePinnedRef = useRef(false);
  const [composerFocused, setComposerFocused] = useState(false);
  // Measured bottom-chrome height feeds the floating Latest pill offset and
  // the feed's collision padding (CSS var --composer-h on the chat column).
  const [composerH, setComposerH] = useState(0);
  const composerWrapRef = useRef<HTMLDivElement>(null);
  const [isPhone, setIsPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const onChange = () => setIsPhone(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  // Gate finding (T-83 aftermath): on a COLD load this effect first runs
  // during bootstrap, when the chat column (and wrapper) does not exist yet;
  // keyed on mainTab alone it never re-attached after the room arrived, so
  // --composer-h stayed 0 and the floating pill overlapped the composer.
  // roomReady re-arms it the moment the wrapper can render.
  const roomReady = Boolean(room && self);
  useEffect(() => {
    const el = composerWrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setComposerH(el.offsetHeight));
    ro.observe(el);
    setComposerH(el.offsetHeight);
    return () => ro.disconnect();
    // The wrapper element persists across ended/muted/composer swaps.
  }, [mainTab, roomReady]);
  // T-84: when the bottom stack GROWS while the reader sits at the newest
  // message (reply chip added, attachment chip lands, voice draft expands),
  // re-anchor so the final line moves fully above the stack instead of
  // disappearing behind it. Reading away from the bottom never jumps.
  const prevComposerHRef = useRef(0);
  useEffect(() => {
    const grew = composerH > prevComposerHRef.current;
    prevComposerHRef.current = composerH;
    if (grew && atBottomRef.current) {
      const feed = feedRef.current;
      if (feed) feed.scrollTop = feed.scrollHeight;
    }
  }, [composerH]);

  // T-65: the read marker AS IT WAS when we arrived. The mark-read effect below
  // advances the stored marker the moment we're at the bottom, so we have to
  // snapshot it first or "first unread" would always resolve to "nothing".
  const arrivalReadRef = useRef<number | null>(null);
  // T-22: opening a room acknowledges the badge once, after the arrival marker
  // above has been snapshotted for first-unread positioning. Later arrivals are
  // only acknowledged while the reader is actually at the bottom.
  const arrivalMarkedRef = useRef(false);
  // T-140: the account read marker can resolve a beat AFTER the first render.
  // Capturing `messageTotal` (all-read) before it lands is what dropped the
  // reader at the bottom instead of the first-unread divider. So capture only
  // once the marker is actually known; if it never resolves within the grace
  // window, fall back to messageTotal (a genuine first visit reads as caught-up).
  const markerGaveUpRef = useRef(false);
  if (arrivalReadRef.current === null && messageTotal > 0) {
    const known = getReadCount(code);
    if (known !== null) arrivalReadRef.current = known;
    else if (markerGaveUpRef.current) arrivalReadRef.current = messageTotal;
  }
  // The absolute marker locates the unread tail within the bounded message
  // page. Skip messages authored by this browser identity so they never create
  // a misleading "new messages" divider for their own sender.
  const firstUnreadIdx = firstUnreadMessageIndex(
    messages,
    messageTotal,
    arrivalReadRef.current ?? messageTotal,
    self?.name,
  );
  const firstUnreadId = firstUnreadIdx >= 0 ? messages[firstUnreadIdx]?.id ?? null : null;
  const firstUnreadIdRef = useRef<number | null>(null);
  if (firstUnreadIdRef.current === null && firstUnreadId != null) firstUnreadIdRef.current = firstUnreadId;

  // T-22: opening the room clears its home-card badge, but only after the old
  // marker was captured above so first-unread navigation remains stable. From
  // then on, new traffic advances the marker only while parked at the bottom.
  useEffect(() => {
    if (messageTotal <= 0) return;
    if (!arrivalMarkedRef.current) {
      // T-140: hold the first acknowledgement until the arrival marker has
      // actually been snapshotted. Marking read here advances the stored
      // marker to messageTotal, and doing that before a late-resolving marker
      // lands would poison the snapshot (line ~598) into reading "all-read",
      // dropping the reader at the bottom instead of the first-unread divider.
      if (arrivalReadRef.current === null) return;
      arrivalMarkedRef.current = true;
      markRoomRead(code, messageTotal, self?.name);
    } else if (atBottomRef.current) {
      markRoomRead(code, messageTotal, self?.name);
    }
  }, [messageTotal, code, self?.name, markerNonce]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sendingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);

  // Auto-grow the textarea: shrink to min, then expand to scrollHeight up to max.
  // Runs after every value change (typed, pasted, Draft injected, voice transcript).
  function autoGrow(el: HTMLTextAreaElement | null) {
    if (!el) return;
    // T-128: while recording, the field opens at (and never drops below) the
    // multi-line dictating height so it is obviously a transcription surface
    // from the first moment, before any words arrive.
    const min = dictating ? TEXTAREA_DICTATING_MIN : composerExpanded ? TEXTAREA_EXPANDED_MIN : TEXTAREA_MIN_HEIGHT;
    let max = composerExpanded ? TEXTAREA_EXPANDED_MAX : TEXTAREA_MAX_HEIGHT;
    // T-85: on phones the transcript/draft region is CAPPED and scrolls
    // internally — a long dictation must never push Stop/Send off-screen.
    if (isPhone) max = Math.min(max, Math.round(window.innerHeight * 0.28));
    // Empty draft: snap to the resting height. Measuring scrollHeight here
    // would pick up a WRAPPED placeholder (narrow viewports) and leave the
    // box two lines tall after clearing.
    if (!el.value) {
      el.style.height = `${min}px`;
      return;
    }
    el.style.height = 'auto';
    const next = Math.min(Math.max(el.scrollHeight, min), max);
    el.style.height = `${next}px`;
  }
  useEffect(() => {
    autoGrow(textareaRef.current);
    // composerExpanded changes the min/max window, so re-measure on toggle.
    // T-128: dictating raises the min, so re-measure when it flips too.
  }, [text, composerExpanded, dictating]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(interval);
  }, []);

  // --- T-09: @mention autocomplete ---
  // Re-derive the active query from the REAL textarea value + caret (state can
  // lag the DOM by a keystroke). Keeps the highlight index across keystrokes
  // within the same token, resets it when a new token starts.
  function syncMention() {
    const el = textareaRef.current;
    if (!el) { setMention(null); return; }
    const q = mentionQueryAt(el.value, el.selectionStart ?? el.value.length);
    setMention(prev => q
      ? { start: q.start, query: q.query, index: prev && prev.start === q.start ? prev.index : 0 }
      : null);
  }

  const mentionCandidates = mention
    ? filterMentionCandidates((room?.participants ?? []).map(p => p.name), mention.query).slice(0, 6)
    : [];

  function pickMention(name: string) {
    if (!mention) return;
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? text.length;
    const out = insertMention(el?.value ?? text, caret, mention.start, name);
    setText(out.text);
    setMention(null);
    requestAnimationFrame(() => {
      const el2 = textareaRef.current;
      if (el2) { el2.focus(); el2.setSelectionRange(out.caret, out.caret); autoGrow(el2); }
    });
  }

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

  useEffect(() => {
    if (!room || (room.replyMode ?? 'open') === 'open') {
      setTurnState(null);
      return;
    }
    let cancelled = false;
    async function pullTurnState() {
      try {
        const client = createClient();
        const next = await getTurnState(client, code);
        if (!cancelled) setTurnState(next);
      } catch {
        if (!cancelled) setTurnState(null);
      }
    }
    void pullTurnState();
    const id = window.setInterval(() => void pullTurnState(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [code, room?.replyMode, messages.length, room?.version]);

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
        showToast('You were removed from the meeting by the host', 'error');
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
      const client = createClient();
      await setMuted(client, code, self.name, p.name, p.client, wantMuted);
      await refreshRoom();
    } catch (e) {
      const { showToast } = await import('../components/Toast.js');
      showToast(e instanceof Error ? `Mute toggle failed: ${e.message}` : 'Mute toggle failed', 'error');
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
      const client = createClient();
      await removeParticipant(client, code, self.name, p.name, p.client);
      await refreshRoom();
    } catch (e) {
      const { showToast } = await import('../components/Toast.js');
      showToast(e instanceof Error ? `Kick failed: ${e.message}` : 'Kick failed', 'error');
    }
  }

  async function handleArchiveRoom() {
    try {
      let agentIds: string[] = [];
      try {
        agentIds = (await listSummonedAgents())
          .filter(a => a.room === code && a.status === 'active').map(a => a.agentId);
      } catch { /* summoner may be down; archive anyway */ }
      if (agentIds.length > 0 && window.confirm(`Also stop & archive ${agentIds.length} agent(s) attached to this room?`)) {
        for (const id of agentIds) { try { await dismissSummonedAgent(id, true); } catch { /* best-effort */ } }
      }
      await archiveRoomAction(createClient(), code);
      navigate('/');
    } catch (e) {
      window.alert(`Could not archive: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function handleEndMeeting() {
    try {
      const client = createClient();
      await endRoomApi(client, code, { requesterName: self?.name });
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

  const [reportBusy, setReportBusy] = useState(false);
  const artifacts = serverArtifacts ?? [];
  // T-71 content-model ruling: STATUS is process exhaust, not produced work
  // — it lives in Chat (as Activity Notes), never on the Outputs page.
  const producedWork = artifacts.filter(a => a.kind !== 'status');

  async function handleExportReport() {
    if (!room) return;
    setReportBusy(true);
    try {
      const client = createClient();
      await createRoomReport(client, room, messages);
      // A1: copy the permanent share link to clipboard alongside navigating.
      // The report key is stored without TTL (see apps/server: reports are stored without TTL),
      // so the link survives past the 24h room TTL — that's exactly the "Save"
      // half of "Save & Share". Copy first so the toast lives across the
      // route change (ToastHost is mounted at router level).
      const reportUrl = `${window.location.origin}/r/${code}/report`;
      await copyText(reportUrl, 'Saved — share link copied to clipboard');
      navigate(`/r/${code}/report`);
    } catch (e) {
      const { showToast } = await import('../components/Toast.js');
      showToast(e instanceof Error ? `Export failed: ${e.message}` : 'Export failed', 'error');
    } finally {
      setReportBusy(false);
    }
  }

  function scrollToBottom() {
    const el = feedRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight });
    // T-140: don't advance the marker until the arrival snapshot is locked, or
    // the provisional bottom-land would mark everything read before a
    // late-resolving account marker can position the first-unread divider.
    if (arrivalReadRef.current !== null) markRoomRead(code, messageTotal, self?.name);
    setUnseenCount(0);
    setUnseenMentions(0);
  }

  function onFeedScroll() {
    const el = feedRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottomRef.current = distanceFromBottom < 80;
    setAtBottom(atBottomRef.current);
    if (atBottomRef.current) {
      // messageTotal does not change when the reader scrolls, so the effect
      // above cannot observe this transition. Persist it here immediately.
      // T-140: but only after the arrival snapshot is locked — the provisional
      // bottom-land on open fires a scroll event, and marking read here would
      // poison the snapshot into all-read before a late marker can resolve.
      if (arrivalReadRef.current !== null) markRoomRead(code, messageTotal, self?.name);
      setUnseenCount(0);
      setUnseenMentions(0);
    }
    // T-82: one rAF per frame samples direction for the contextual chrome.
    if (!chromeRafRef.current) {
      chromeRafRef.current = requestAnimationFrame(() => {
        chromeRafRef.current = 0;
        const feed = feedRef.current;
        if (!feed) return;
        const next = chromeStep(chromeVisRef.current, feed.scrollTop, chromePinnedRef.current, atBottomRef.current);
        chromeVisRef.current = next;
        setChromeHidden(prev => (prev === next.hidden ? prev : next.hidden));
      });
    }
    // T-04: nearing the top pulls the previous history page. Anchor the current
    // scroll geometry first so the prepend adjustment below can hold the
    // reader's place instead of letting content jump down under them.
    if (el.scrollTop < 150 && hasOlder && !loadingOlder) {
      prependAnchorRef.current = { heightBefore: el.scrollHeight, topBefore: el.scrollTop };
      void loadOlder();
    }
  }

  // T-48: on new messages, stick to the bottom only for the initial load or when
  // the reader is already at the bottom; otherwise preserve their scroll position
  // and surface a "↓ N new" pill (below) instead of yanking them down.
  //
  // T-65 (host: "make sure I always scroll down to the first unread"): on the
  // FIRST render of a room we land on the first unread message instead of the
  // bottom, so catching up starts where he stopped reading rather than at the
  // end of a conversation he hasn't seen.
  // T-04 refactor: length deltas alone can't tell "new at the bottom" from "an
  // older page prepended at the top", and the two need OPPOSITE scroll
  // behavior. Appends are counted from the previous LAST message id; anything
  // beyond that is a prepend, which restores the anchored scroll geometry
  // captured by onFeedScroll instead of yanking to the bottom / inflating the
  // unread pill. useLayoutEffect so the prepend adjustment lands before paint.
  useLayoutEffect(() => {
    const len = messages.length;
    const prevLastId = prevLastIdRef.current;
    let appended: number;
    if (prevLenRef.current === 0 || prevLastId == null) {
      appended = len;
    } else {
      const idx = messages.findIndex(m => m.id === prevLastId);
      appended = idx === -1 ? Math.max(0, len - prevLenRef.current) : len - idx - 1;
    }
    const prepended = len - prevLenRef.current - appended;

    if (prepended > 0 && prependAnchorRef.current) {
      const el = feedRef.current;
      const anchor = prependAnchorRef.current;
      prependAnchorRef.current = null;
      if (el) el.scrollTop = el.scrollHeight - anchor.heightBefore + anchor.topBefore;
    }

    // T-16 excludes your own messages; T-20 also excludes stamped status pings
    // so heartbeat noise never inflates the "N new messages" pill.
    const appendedTail = appended > 0
      ? messages.slice(len - appended).filter(message => !isSelfAuthored(message, self?.name) && !isStatusPing(message) && !isReactionEvent(message))
      : [];
    // T-125 (host-critical): posting IS declaring you are at the conversation
    // tail — transaction-commit navigation, T-116 family. Before this, a
    // self-authored send from a scrolled-up position (the T-65 first-unread
    // landing put Waqas a day back) fell through BOTH branches below: filtered
    // out of the pill accounting, and not at the bottom, so his own message
    // landed off-screen while the viewport stayed on yesterday.
    const appendedSelf = appended > 0
      && messages.slice(len - appended).some(message => isSelfAuthored(message, self?.name));
    const appendedUnread = appendedTail.length;
    // T-18 rev2: mentions among the unseen tail drive the navigator.
    const appendedMentions = appendedTail.filter(message => textMentionsSelf(message.text ?? '', self?.name)).length;

    if (prevLenRef.current === 0 && len > 0) {
      const target = firstUnreadIdRef.current;
      const el = target != null ? document.getElementById(`msg-${target}`) : null;
      if (el) {
        el.scrollIntoView({ block: 'start' });
        // Landing above the bottom means there IS unread below — reflect that
        // rather than silently claiming he's caught up.
        onFeedScroll();
        landedRef.current = true;
      } else {
        feedRef.current?.scrollTo(0, feedRef.current.scrollHeight);
        setUnseenCount(0);
        // T-140: only "done" when the marker actually resolved (genuinely caught
        // up). If it is still pending, leave landedRef false so the re-fire
        // effect lands us on the divider the moment the marker arrives.
        if (arrivalReadRef.current !== null) landedRef.current = true;
      }
    } else if (appended > 0 && (atBottomRef.current || appendedSelf)) {
      feedRef.current?.scrollTo(0, feedRef.current.scrollHeight);
      setUnseenCount(0);
      setUnseenMentions(0);
      // T-125: following your own send to the tail means everything above it
      // has been scrolled past — the at-bottom state must reflect that so the
      // next OTHER-sender message keeps sticking instead of pilling.
      if (appendedSelf) atBottomRef.current = true;
    } else if (appendedUnread > 0) {
      setUnseenCount((n) => n + appendedUnread);
      if (appendedMentions > 0) setUnseenMentions((n) => n + appendedMentions);
    }
    // T-71: a freshly arrived marker-bearing message refreshes the durable
    // index promptly instead of waiting out the minute poll.
    if (hasLineMarker(appendedTail.map(m => m.text))) {
      setArtifactsNonce(n => n + 1);
    }
    prevLenRef.current = len;
    prevLastIdRef.current = len > 0 ? messages[len - 1]!.id : null;
  }, [messages]);

  // T-140: on open, reset the landing state, listen for the reader taking over
  // the scroll (so a late re-fire respects their place — T-112), and poll for
  // the account read marker to resolve; bump markerNonce when it does (or after
  // a short grace) so the first-unread landing recomputes against the real marker.
  useEffect(() => {
    landedRef.current = false;
    openInteractedRef.current = false;
    markerGaveUpRef.current = false;
    const el = feedRef.current;
    const mark = () => { openInteractedRef.current = true; };
    if (el) {
      el.addEventListener('wheel', mark, { passive: true });
      el.addEventListener('touchstart', mark, { passive: true });
      el.addEventListener('pointerdown', mark, { passive: true });
      el.addEventListener('keydown', mark);
    }
    let tries = 0;
    const poll = window.setInterval(() => {
      if (getReadCount(code) !== null) {
        window.clearInterval(poll);
        setMarkerNonce((n) => n + 1);
      } else if (++tries >= 20) {
        // ~4s grace. The provisional bottom-land is already on screen, so a
        // generous window only helps a slow marker re-fire to the divider; a
        // genuine first visit with no marker simply stays at Latest.
        window.clearInterval(poll);
        markerGaveUpRef.current = true;
        setMarkerNonce((n) => n + 1);
      }
    }, 200);
    return () => {
      window.clearInterval(poll);
      if (el) {
        el.removeEventListener('wheel', mark);
        el.removeEventListener('touchstart', mark);
        el.removeEventListener('pointerdown', mark);
        el.removeEventListener('keydown', mark);
      }
    };
  }, [code]);

  // T-140: once the marker resolves after open, land on the first-unread divider
  // — but ONLY if the reader has not moved since open. Two signals, either one
  // vetoes the yank (READING-ANCHOR RULE, T-112): an explicit interaction
  // (wheel/touch/key), OR the feed no longer sitting where the provisional
  // bottom-land left it (they scrolled away, e.g. flick/trackpad momentum that
  // never fires a discrete interaction event). A one-time commit via landedRef.
  useEffect(() => {
    if (markerNonce === 0 || landedRef.current || openInteractedRef.current) return;
    if (!atBottomRef.current) { landedRef.current = true; return; }
    const target = firstUnreadIdRef.current;
    if (target == null) { if (arrivalReadRef.current !== null) landedRef.current = true; return; }
    const el = document.getElementById(`msg-${target}`);
    if (!el) return;
    el.scrollIntoView({ block: 'start' });
    onFeedScroll();
    landedRef.current = true;
  }, [markerNonce]);

  // T-72: content that measures itself in AFTER the initial scroll (clamp
  // toggles, fonts, previews) grows the feed below the landed position,
  // stranding the view short of bottom with the Latest pill covering the
  // newest note. While the reader is at bottom, stay pinned through late
  // layout growth; the moment they scroll up, atBottomRef releases the pin.
  useEffect(() => {
    const el = feedRef.current;
    const content = el?.firstElementChild;
    if (!el || !content || !('ResizeObserver' in window)) return;
    const ro = new ResizeObserver(() => {
      // T-112: a user-initiated expansion (Show more/less) compensates its own
      // scroll position to keep the tapped control anchored; re-pinning to
      // bottom here would yank the view past the expanded text — exactly the
      // lost-my-place jump the READING-ANCHOR RULE forbids.
      if (withinAnchoredMutation()) return;
      if (atBottomRef.current && el.scrollHeight - el.scrollTop - el.clientHeight > 1) {
        el.scrollTop = el.scrollHeight;
      }
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, [room != null]);

  // --- T-18: mentions of the signed-in user among loaded messages (IDs are
  // stable across older-page prepends, unlike positions). Hook lives ABOVE the
  // early returns; gotoMention below the guards drives it. ---
  const selfMentionIds = useMemo(
    () => messages
      .filter(m => m.type !== 'sys' && m.name !== self?.name && textMentionsSelf(m.text ?? '', self?.name))
      .map(m => m.id),
    [messages, self?.name],
  );

  // Continues a backward mention-seek across older pages: each prepend re-runs
  // this; jump as soon as an earlier mention exists, keep paging while there is
  // history left, and give up quietly when it is exhausted or trimmed.
  useEffect(() => {
    if (!mentionSeeking) return;
    const pos = mentionCursorId != null ? selfMentionIds.indexOf(mentionCursorId) : -1;
    const target = pos > 0 ? selfMentionIds[pos - 1] : (pos === -1 ? selfMentionIds[selfMentionIds.length - 1] : undefined);
    if (target != null) {
      setMentionSeeking(false);
      setMentionCursorId(target);
      const el = document.getElementById(`msg-${target}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('reply-flash');
        window.setTimeout(() => el.classList.remove('reply-flash'), 1200);
      }
    } else if (!hasOlder) {
      setMentionSeeking(false);
    } else if (!loadingOlder) {
      void loadOlder();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mentionSeeking, selfMentionIds, hasOlder, loadingOlder]);

  // T-82: hook topology must remain stable through bootstrap/error/join
  // transitions. Derive the pinning state defensively before every early
  // return, then run the restoring effect unconditionally. Keeping this hook
  // below the guards makes loading -> loaded render one additional hook and
  // crashes production with React invariant #310.
  const preGuardIsHost = Boolean(room && self && room.createdBy === self.name);
  const preGuardParticipant = room && self
    ? room.participants.find(p => p.name === self.name && p.client === 'web')
    : undefined;
  const preGuardCanSpeak = Boolean(
    room && self && (preGuardIsHost || preGuardParticipant?.canSpeak !== false),
  );
  const chromePinned = Boolean(
    !room || !self || text.trim() || composerFocused || replyingTo || attachments.length > 0 ||
    attachmentJobs.length > 0 || attachmentMenuOpen || dictationDraft || ended || !preGuardCanSpeak,
  );
  useEffect(() => {
    chromePinnedRef.current = chromePinned;
    if (chromePinned && chromeVisRef.current.hidden) {
      chromeVisRef.current = { ...chromeVisRef.current, hidden: false, accum: 0 };
      setChromeHidden(false);
    }
  }, [chromePinned]);

  // T-07: `error` is only ever set when the room has NOT loaded (mid-session
  // blips set `degraded` instead), so this branch is the bootstrap-failure
  // state: actionable copy + retry, not a raw exception filling the screen.
  // Polling keeps running underneath, so it also self-heals without a tap.
  if (error) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-10 text-center">
        <div className="text-3xl" aria-hidden="true">📡</div>
        <h2 className="text-lg font-semibold text-ink">Can't reach the room</h2>
        <p className="max-w-sm text-sm text-ink-soft">{error}</p>
        <button
          onClick={() => { void forceRefresh(); }}
          className="rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
        >
          Retry now
        </button>
      </div>
    );
  }
  if (!self) return <div className="p-10 text-ink-soft">Redirecting to join…</div>;
  if (!room) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-10 text-ink-soft" aria-live="polite">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-accent" aria-hidden="true" />
        <span className="text-sm">Loading the room…</span>
      </div>
    );
  }

  // From here down `self` is non-null (early-returned above). Capture it in a
  // narrowed const so closures inside JSX don't have to re-check.
  const me = self;
  const activeRoom = room;

  // Speaking gate: the host is always allowed; other participants need the
  // Speaking gate: everyone joins able to speak. The host can mute via
  // setMuted() to suspend a specific participant. canSpeak === undefined
  // (legacy rooms before this field existed) is treated as approved so
  // already-running meetings don't break.
  const isHost = room.createdBy === me.name;
  const myParticipant = room.participants.find(p => p.name === me.name && p.client === 'web');
  const myCanSpeak = isHost || myParticipant?.canSpeak !== false;

  const mutedCount = room.participants.filter(p => p.canSpeak === false).length;
  const replyMode = activeRoom.replyMode ?? 'open';
  const replyModeConfig = activeRoom.modeConfig;
  const canConfigureReplyMode = isHost && !ended;
  const roomAgents = activeRoom.participants.filter(p => p.client === 'cc');
  const activeRoomAgents = roomAgents.filter(p => p.canSpeak !== false);
  const fallbackAgent = activeRoomAgents[0] ?? roomAgents[0];
  const selectedLeadAgentName = replyModeConfig?.leadAgentName ?? fallbackAgent?.name ?? '';
  const selectedModeratorAgentName = replyModeConfig?.moderatorAgentName ?? fallbackAgent?.name ?? '';
  const currentSpeaker = turnState?.currentName && turnState.currentClient
    ? activeRoom.participants.find(p => p.name === turnState.currentName && p.client === turnState.currentClient)
    : undefined;
  const currentDeadlineMs = turnState?.deadline ? Math.max(0, turnState.deadline - now) : null;

  function modeLabel(mode: ReplyMode): string {
    if (mode === 'sequential') return 'Sequential';
    if (mode === 'moderator') return 'Moderator';
    return 'Open';
  }

  function buildModeConfig(mode: ReplyMode, overrides: Partial<ReplyModeConfig> = {}): ReplyModeConfig | undefined {
    const timeoutMs = replyModeConfig?.timeoutMs;
    if (mode === 'open') return timeoutMs ? { timeoutMs } : undefined;

    const base: ReplyModeConfig = { ...(replyModeConfig ?? {}), ...overrides };
    if (mode === 'sequential') {
      const leadName = overrides.leadAgentName ?? base.leadAgentName ?? fallbackAgent?.name;
      return {
        ...base,
        ...(timeoutMs ? { timeoutMs } : {}),
        leadAgentName: leadName,
        leadAgentClient: leadName ? 'cc' : undefined,
      };
    }

    const moderatorName = overrides.moderatorAgentName ?? base.moderatorAgentName ?? fallbackAgent?.name;
    return {
      ...base,
      ...(timeoutMs ? { timeoutMs } : {}),
      moderatorAgentName: moderatorName,
      moderatorAgentClient: moderatorName ? 'cc' : undefined,
    };
  }

  async function updateReplyMode(mode: ReplyMode, overrides: Partial<ReplyModeConfig> = {}) {
    if (!canConfigureReplyMode) return;
    const nextConfig = buildModeConfig(mode, overrides);
    if (mode !== 'open' && !fallbackAgent) {
      const { showToast } = await import('../components/Toast.js');
      showToast('Add an agent before enabling Sequential or Moderator mode.');
      return;
    }
    setModeBusy(true);
    try {
      const client = createClient();
      await setReplyMode(client, code, me.name, mode, nextConfig);
      await refreshRoom();
      const { showToast } = await import('../components/Toast.js');
      showToast(`Reply mode set to ${modeLabel(mode)}.`);
    } catch (e) {
      const { showToast } = await import('../components/Toast.js');
      showToast(e instanceof Error ? `Mode change failed: ${e.message}` : 'Mode change failed', 'error');
    } finally {
      setModeBusy(false);
    }
  }

  async function refreshTurnAndMessages() {
    try {
      const client = createClient();
      setTurnState(await getTurnState(client, code));
    } catch {
      setTurnState(null);
    }
    await forceRefresh();
  }

  async function emitTurnSystemMessage(
    textValue: string,
    eventType: SystemEventType,
    target: { name: string; client: 'web' | 'cc' },
    extra: Partial<NonNullable<Message['metadata']>> = {},
  ) {
    const client = createClient();
    const nowMs = Date.now();
    const msg: Message = {
      id: nowMs,
      type: 'sys',
      name: 'system',
      role: '',
      initials: 'AR',
      color: '#5B6AFF',
      client: 'cc',
      text: textValue,
      time: nowMs,
      metadata: {
        eventType,
        modeAtSend: replyMode,
        targetAgentName: target.name,
        targetAgentClient: target.client,
        ...extra,
      },
    };
    await appendSystemMessage(client, code, msg);
  }

  async function handleAskAgent(p: Participant) {
    if (!canConfigureReplyMode || p.client !== 'cc') return;
    if (replyMode === 'open') {
      appendText(`@${p.name} `);
      return;
    }
    if (!turnState) {
      const { showToast } = await import('../components/Toast.js');
      showToast('Send a message first, then ask an agent inside that turn.');
      return;
    }
    setModeBusy(true);
    try {
      const client = createClient();
      const added = await directInvoke(client, code, { name: p.name, client: p.client }, 'host', { requesterName: self?.name });
      if (!added) {
        const { showToast } = await import('../components/Toast.js');
        showToast(`${p.name} is already queued for a direct reply.`);
        return;
      }
      await emitTurnSystemMessage(
        `Host directly invoked @${p.name}.`,
        'host_invoked',
        { name: p.name, client: p.client },
        { invocationType: 'host_directed' },
      );
      await refreshTurnAndMessages();
    } catch (e) {
      const { showToast } = await import('../components/Toast.js');
      showToast(e instanceof Error ? `Ask failed: ${e.message}` : 'Ask failed', 'error');
    } finally {
      setModeBusy(false);
    }
  }

  async function handleSkipCurrent() {
    if (!canConfigureReplyMode || !currentSpeaker) return;
    setModeBusy(true);
    try {
      const client = createClient();
      const skipped = await hostSkipCurrent(client, code, activeRoom, { requesterName: self?.name });
      if (!skipped) {
        const { showToast } = await import('../components/Toast.js');
        showToast('No active agent to skip.');
        return;
      }
      await emitTurnSystemMessage(
        `Host skipped @${skipped.name}'s ${skipped.role} slot.`,
        'skipped_by_host',
        { name: skipped.name, client: skipped.client },
        { roleAtSend: skipped.role, skippedBy: 'host' },
      );
      await refreshTurnAndMessages();
    } catch (e) {
      const { showToast } = await import('../components/Toast.js');
      showToast(e instanceof Error ? `Skip failed: ${e.message}` : 'Skip failed', 'error');
    } finally {
      setModeBusy(false);
    }
  }

  function fillPrompt(kind: 'minutes' | 'reply') {
    const agent = activeRoom.participants.find(p => p.client !== 'web' && p.canSpeak !== false)?.name ?? 'Claude';
    const target = `@${agent}`;
    const prompt = kind === 'minutes'
      ? `${target} Please generate concise meeting minutes for this room. Include topic, participants, key decisions, open questions, and action items. Use markdown.`
      : `${target} Please draft a concise reply to the latest message in this room. Keep it practical and mention any assumptions.`;
    setText(prompt);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      autoGrow(textareaRef.current);
    });
  }

  // T-54: begin a quote-reply to a message (from the ⋯ menu or a swipe).
  function startReply(m: Message) {
    setReplyingTo({ id: m.id, name: m.name, text: (m.text ?? '').slice(0, 240) });
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  // T-121: toggle an acknowledge/reject reaction. The server response patches
  // the rendered message immediately; the sys event row it appends carries the
  // same snapshot to every other client (and to listening agents as text).
  async function reactTo(m: Message, kind: 'ack' | 'reject') {
    if (!self) return;
    try {
      const out = await reactToMessage(createClient(), code, m.id, kind, self.name);
      patchMessageReactions(m.id, out.reactions);
    } catch (e) {
      void import('../components/Toast.js').then(({ showToast }) =>
        showToast(e instanceof Error ? e.message : 'Reaction failed', 'error'));
    }
  }

  // T-54: jump to (and briefly highlight) the quoted original by id.
  function jumpToMessage(id: number) {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return; // original may be paged out; the denormalized quote still shows
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('reply-flash');
    window.setTimeout(() => el.classList.remove('reply-flash'), 1200);
  }

  function gotoMention(dir: -1 | 1) {
    const pos = mentionCursorId != null ? selfMentionIds.indexOf(mentionCursorId) : -1;
    // No cursor yet: both directions start at the LATEST mention (what you
    // most likely came to find), then prev walks backward from there.
    const target = pos === -1
      ? selfMentionIds[selfMentionIds.length - 1]
      : selfMentionIds[pos + dir];
    if (target != null) {
      setMentionCursorId(target);
      jumpToMessage(target);
      return;
    }
    if (dir === -1 && hasOlder) {
      // Earlier mentions may live in paged-out history: keep loading older
      // pages until one appears or history is exhausted (effect above the
      // early returns continues the seek on every prepend).
      setMentionSeeking(true);
      void loadOlder();
    }
  }

  async function send() {
    // T-142: read the LIVE composer value so a fast type+Enter parses exactly
    // what is in the box, never a React state that has not committed yet.
    const body = (textareaRef.current?.value ?? text).trim();
    if ((!body && attachments.length === 0) || ended || sendingRef.current) return;

    // T-139: the /brief command family. A brief COMPOSES a room artifact from
    // real board+message state (server-side, honest by construction) and posts
    // it as an EXECUTIVE BRIEF card instead of sending the "/brief" text. Only
    // when there are no attachments — an image caption of "/brief" is a caption.
    const briefCmd = attachments.length === 0 ? parseBriefCommand(body) : null;
    if (briefCmd) {
      setText('');
      setDictationDraft(false);
      setDictationPaused(false);
      setReplyingTo(null);
      const result = await runBrief(code, me.name, briefCmd);
      if (result.posted) {
        // T-141: the brief posts as a message; force a message re-fetch NOW so
        // the card lands immediately instead of on the next background poll
        // (refreshRoom only pulls room metadata, not messages).
        void forceRefresh();
      } else {
        const { showToast } = await import('../components/Toast.js');
        showToast(result.error ?? 'Could not build your brief.', 'error');
        setText(body); // restore so they can retry
      }
      return;
    }

    sendingRef.current = true;
    // T-131: the app send-chime. Waqas asked for a cue at record-start and at
    // send, nothing in between — so it fires only for a dictated message, the
    // subtle app tone that replaces the OS one.
    const wasDictation = dictationDraft;
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
      // T-54: quote-reply reference; the server sanitizes/truncates name+snippet.
      replyTo: replyingTo ?? undefined,
    };
    setText('');
    setDictationDraft(false);
    setDictationPaused(false);
    setAttachments([]);
    setReplyingTo(null);
    // The server's absolute count lands on the next poll. Record the successful
    // intent now so navigating home during that gap cannot badge our own send.
    markSelfMessageSeen(code, me.name);
    try {
      await sendMessage(msg);
      if (wasDictation) void import('../lib/audioCue.js').then((m) => m.playSendCue()).catch(() => {});
    } catch (e) {
      unmarkSelfMessageSeen(code, me.name);
      const { showToast } = await import('../components/Toast.js');
      showToast(e instanceof Error ? `Send failed: ${e.message}` : 'Send failed', 'error');
      setText(body); // restore draft
      setAttachments(attachments);
    } finally {
      sendingRef.current = false;
    }
  }

  // T-141: complete a slash command into the composer without sending. A trailing
  // space (the /brief <topic> form) leaves the caret ready for the argument.
  function completeCommand(command: SlashCommand) {
    setText(command.insert);
    completedCmdRef.current = command.insert;
    setPaletteDismissed(true);
    setPaletteNavigated(false);
    const el = textareaRef.current;
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const n = command.insert.length;
      el.setSelectionRange(n, n);
      autoGrow(el);
    });
  }

  async function addFiles(files: FileList | File[]) {
    const incoming = Array.from(files);
    if (!incoming.length) return;
    setAttachBusy(true);
    setAttachmentMenuOpen(false);
    try {
      const slots = Math.max(0, MAX_ATTACHMENTS_PER_MESSAGE - attachments.length);
      const selected = incoming.slice(0, slots);
      if (incoming.length > slots) {
        const { showToast } = await import('../components/Toast.js');
        showToast(`Only ${MAX_ATTACHMENTS_PER_MESSAGE} attachments per message`);
      }
      const jobs = selected.map((file, index): AttachmentUploadJob => ({
        id: `${Date.now()}-${index}-${file.name}`,
        file,
        state: 'uploading',
      }));
      setAttachmentJobs(prev => [...prev, ...jobs]);
      for (const job of jobs) {
        try {
          const uploaded = await uploadAttachment(job.file, code);
          setAttachments(prev => [...prev, uploaded].slice(0, MAX_ATTACHMENTS_PER_MESSAGE));
          setAttachmentJobs(prev => prev.filter(item => item.id !== job.id));
        } catch (e) {
          const message = e instanceof Error ? e.message : 'Upload failed';
          setAttachmentJobs(prev => prev.map(item => item.id === job.id ? { ...item, state: 'failed', error: message } : item));
        }
      }
    } finally {
      setAttachBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  }

  async function retryAttachment(job: AttachmentUploadJob) {
    setAttachBusy(true);
    setAttachmentJobs(prev => prev.map(item => item.id === job.id ? { ...item, state: 'uploading', error: undefined } : item));
    try {
      const uploaded = await uploadAttachment(job.file, code);
      setAttachments(prev => [...prev, uploaded].slice(0, MAX_ATTACHMENTS_PER_MESSAGE));
      setAttachmentJobs(prev => prev.filter(item => item.id !== job.id));
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Upload failed';
      setAttachmentJobs(prev => prev.map(item => item.id === job.id ? { ...item, state: 'failed', error: message } : item));
    } finally {
      setAttachBusy(false);
    }
  }

  function appendText(value: string) {
    setText(prev => {
      if (!prev.trim()) return value;
      return `${prev}\n${value}`;
    });
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      autoGrow(textareaRef.current);
    });
  }

  async function fileFromUrl(url: string): Promise<File | null> {
    try {
      const parsed = new URL(url);
      const resp = await fetch(parsed.toString());
      if (!resp.ok) return null;
      const blob = await resp.blob();
      if (!ALLOWED_ATTACHMENT_TYPES.has(blob.type)) return null;
      const pathName = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() ?? 'attachment');
      const fallbackName = blob.type.startsWith('image/') ? 'image' : 'attachment';
      const name = pathName.includes('.') ? pathName : `${fallbackName}.${blob.type.split('/')[1] ?? 'bin'}`;
      return new File([blob], name, { type: blob.type });
    } catch {
      return null;
    }
  }

  async function filesFromDrop(dataTransfer: DataTransfer, uri: string): Promise<File[]> {
    const droppedFiles = Array.from(dataTransfer.files);
    if (droppedFiles.length > 0) return droppedFiles;
    if (!uri) return [];
    const file = await fileFromUrl(uri);
    return file ? [file] : [];
  }

  function handleDragEnter(e: DragEvent<HTMLElement>) {
    if (ended) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current += 1;
    setDragActive(true);
  }

  function handleDragOver(e: DragEvent<HTMLElement>) {
    if (ended) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  }

  function handleDragLeave(e: DragEvent<HTMLElement>) {
    if (ended) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  }

  async function handleDrop(e: DragEvent<HTMLElement>) {
    if (ended) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = 0;
    setDragActive(false);

    const uri = e.dataTransfer.getData('text/uri-list').split('\n').find(line => line && !line.startsWith('#')) ?? '';
    const plainText = e.dataTransfer.getData('text/plain');
    const files = await filesFromDrop(e.dataTransfer, uri);
    if (files.length > 0) {
      await addFiles(files);
      return;
    }

    const textValue = plainText || uri;
    if (textValue.trim()) appendText(textValue.trim());
  }

  async function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData.files).filter(file => file.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    await addFiles(files);
  }

  const listeningCount = activeRoom.participants.filter(p => (p.listenUntil ?? 0) > now).length;

  // Inspector tab contents. These reuse the pre-T-05 side-panel blocks
  // verbatim; only the responsive chrome around them changed (permanent
  // columns + mobile tab bar became one toggleable Inspector).
  // T-71 (design lead pixel review): Settings is a composed PAGE — Identity,
  // Access, Collaboration, Lifecycle, and a separated Danger section. One
  // primary action (Invite, in the page header); recovery is deliberately
  // quiet and cannot visually equal it.
  const settingsSectionHead = (label: string, tone = 'text-ink-faint') => (
    <h3 className={`mb-3 text-[14px] font-semibold uppercase tracking-wide ${tone}`}>{label}</h3>
  );
  const roomInfoPanel = (
    <div className="flex flex-col gap-4">
      <section aria-label="Identity" className="rounded-xl border border-border-faint bg-surface p-4">
        {settingsSectionHead('Identity')}
        <h4 className="text-[16px] font-semibold leading-snug text-ink">{room.topic}</h4>
        <RenameRoomControl room={room} isHost={isHost} onRenamed={() => { void refreshRoom(); }} />
        {!isHost && (
          <p className="mt-1 text-[15px] leading-relaxed text-ink-soft sm:text-[14px]">Renaming is a host control.</p>
        )}
      </section>
      <section aria-label="Access" className="rounded-xl border border-border-faint bg-surface p-4">
        {settingsSectionHead('Access')}
        <MeetingCodePill code={code} />
        <p className="mt-2 text-[15px] leading-relaxed text-ink-soft sm:text-[14px]">
          Anyone with this code or the invite link can join. Invite lives at the top of this page.
        </p>
      </section>
      <section aria-label="Collaboration" className="rounded-xl border border-border-faint bg-surface p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          {settingsSectionHead('Reply mode')}
          <span className="rounded bg-surface-softer px-1.5 py-0.5 text-[13px] font-semibold text-ink-soft">
            {modeLabel(replyMode)}
          </span>
        </div>
                {canConfigureReplyMode ? (
                  <div className="space-y-2">
                    <select
                      value={replyMode}
                      onChange={e => { void updateReplyMode(e.target.value as ReplyMode); }}
                      disabled={modeBusy}
                      className="h-11 w-full rounded-md border border-border bg-surface px-2 text-sm font-semibold text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent-tint disabled:opacity-60 lg:h-9 lg:text-xs"
                    >
                      <option value="open">Open</option>
                      <option value="sequential">Sequential</option>
                      <option value="moderator">Moderator</option>
                    </select>
                    {replyMode === 'sequential' && (
                      <select
                        value={selectedLeadAgentName}
                        onChange={e => { void updateReplyMode('sequential', { leadAgentName: e.target.value, leadAgentClient: 'cc' }); }}
                        disabled={modeBusy || activeRoomAgents.length === 0}
                        className="h-11 w-full rounded-md border border-border bg-surface px-2 text-sm font-semibold text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent-tint disabled:opacity-60 lg:h-9 lg:text-xs"
                        aria-label="Lead agent"
                      >
                        {activeRoomAgents.length === 0 ? (
                          <option value="">No agents</option>
                        ) : activeRoomAgents.map(agent => (
                          <option key={`${agent.name}-${agent.client}`} value={agent.name}>Lead: {agent.name}</option>
                        ))}
                      </select>
                    )}
                    {replyMode === 'moderator' && (
                      <select
                        value={selectedModeratorAgentName}
                        onChange={e => { void updateReplyMode('moderator', { moderatorAgentName: e.target.value, moderatorAgentClient: 'cc' }); }}
                        disabled={modeBusy || activeRoomAgents.length === 0}
                        className="h-11 w-full rounded-md border border-border bg-surface px-2 text-sm font-semibold text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent-tint disabled:opacity-60 lg:h-9 lg:text-xs"
                        aria-label="Moderator agent"
                      >
                        {activeRoomAgents.length === 0 ? (
                          <option value="">No agents</option>
                        ) : activeRoomAgents.map(agent => (
                          <option key={`${agent.name}-${agent.client}`} value={agent.name}>Moderator: {agent.name}</option>
                        ))}
                      </select>
                    )}
                    {replyMode !== 'open' && (
                      <div className="rounded-md border border-border-faint bg-surface px-2 py-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-ink">
                              {currentSpeaker ? `Now: ${currentSpeaker.name}` : 'No active turn'}
                            </div>
                            <div className="text-xs text-ink-soft">
                              {currentSpeaker && currentDeadlineMs !== null
                                ? `${Math.ceil(currentDeadlineMs / 1000)}s left`
                                : 'Waiting'}
                            </div>
                          </div>
                          {currentSpeaker && (
                            <button
                              type="button"
                              onClick={() => { void handleSkipCurrent(); }}
                              disabled={modeBusy}
                              className="min-h-11 rounded-md border border-amber-400/30 bg-amber-500/10 px-3 text-sm font-semibold text-amber-300 transition hover:bg-amber-500/20 disabled:opacity-60 lg:min-h-7 lg:px-2"
                            >
                              Skip
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-xs font-semibold text-ink-muted">{modeLabel(replyMode)}</div>
                )}
      </section>
      <section aria-label="Lifecycle" className="rounded-xl border border-border-faint bg-surface p-4">
        {settingsSectionHead('Lifecycle')}
        {/* State object (design lead ruling): explicit state, ONE consequence
            sentence, then conditional compact secondary actions. */}
        {(() => {
          const lifecycle = ended
            ? { label: 'Room ended', tone: 'text-red-400', dot: 'bg-red-400', consequence: 'The meeting is over. Messages are preserved; the room can be reactivated from Home.' }
            : listeningCount === 0
              ? { label: 'Custodian absent', tone: 'text-amber-400', dot: 'bg-amber-400', consequence: 'No agent is listening right now. Messages will wait until one returns or is recovered below.' }
              : { label: 'Room active', tone: 'text-emerald-400', dot: 'bg-emerald-400', consequence: `${listeningCount} agent${listeningCount === 1 ? ' is' : 's are'} listening; messages are delivered live.` };
          return (
            <>
              <div className={`flex items-center gap-2 text-[15px] font-semibold ${lifecycle.tone}`}>
                <span className={`h-2 w-2 rounded-full ${lifecycle.dot}`} aria-hidden="true" />
                {lifecycle.label}
              </div>
              <p className="mt-1 text-[15px] leading-relaxed text-ink-soft sm:text-[14px]">{lifecycle.consequence}</p>
              {!ended && (
                <div className="mt-3">
                  <RecoverHostButton code={code} />
                </div>
              )}
            </>
          );
        })()}
      </section>
      {room.createdBy === self.name && (
        <section aria-label="Archive" className="rounded-xl border border-border-faint bg-surface p-4">
          {settingsSectionHead('Archive')}
          <p className="mb-3 text-[15px] leading-relaxed text-ink-soft sm:text-[14px]">
            Hide this room from Active/Ended into the Archived list. Reversible — restore it from Home’s Archived tab. Any summoned agents can be stopped at the same time.
          </p>
          <button
            type="button"
            onClick={handleArchiveRoom}
            className="flex min-h-11 items-center justify-center rounded-lg border border-border px-4 text-sm font-semibold text-ink-soft transition hover:border-border-strong hover:text-ink"
          >
            Archive room
          </button>
        </section>
      )}
      {!ended && room.createdBy === self.name && (
        <section aria-label="Danger zone" className="rounded-xl border border-red-400/30 bg-red-500/5 p-4">
          {settingsSectionHead('Danger', 'text-red-400')}
          <p className="mb-3 text-[15px] leading-relaxed text-ink-soft sm:text-[14px]">
            Ending the room stops the meeting for everyone. Agents are disconnected and the room moves to Ended.
          </p>
          <button
            type="button"
            onClick={handleEndMeeting}
            className="flex min-h-11 items-center justify-center rounded-lg border border-red-400/40 px-4 text-sm font-semibold text-red-400 transition hover:bg-red-500/10"
          >
            End room
          </button>
        </section>
      )}
      {/* Subdued page footer: navigation is not lifecycle management. */}
      <div className="flex justify-center pt-1">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="flex min-h-11 items-center px-4 text-[15px] font-semibold text-ink-soft transition hover:text-ink sm:text-[14px]"
        >
          Leave to Home
        </button>
      </div>
    </div>
  );

  // T-68: derive the lookup before constructing peoplePanel. Declaring this
  // below the panel left the render-time participant map inside JavaScript's
  // temporal dead zone and crashed rooms with participants in production.
  const healthById = indexHealth(health);

  // T-71: People rows grouped by liveness — Active first, Needs attention
  // (stale) next, Offline (disconnected) collapsed behind a disclosure.
  const renderPersonRow = (p: (typeof room.participants)[number]) => {
                  const isMeHost = room.createdBy === self.name;
                  const isSelf = p.name === self.name && p.client === 'web';
                  const canKick = isMeHost && !isSelf && !ended;
                  const isMuted = p.canSpeak === false;
                  const canMuteToggle = isMeHost && !isSelf && !ended;
                  const canAsk = canConfigureReplyMode && p.client === 'cc' && !isMuted;
                  const h = healthById.get(healthKey(p.name, p.client));
                  const presence = h ? presenceView(h) : null;
                  // Whole-row visual fade for participants who haven't been
                  // seen in a while — keeps the row legible but signals
                  // "probably gone" without screaming about it.
                  const rowFade = presence?.state === 'stale'
                    ? 'opacity-65'
                    : presence?.state === 'disconnected'
                      ? 'opacity-50'
                      : '';
                  // T-44: full identity + state for assistive tech in ONE
                  // accessible name — avatar color and glyphs are decoration.
                  // "web session", never "human": a browser row could be an
                  // agent driving automation; the panel must not assert what
                  // it cannot verify (UX reject 2 on T-44 rev1).
                  const kindLabel = participantKindLabel(p);
                  const rowLabel = [
                    p.name,
                    kindLabel,
                    p.role || null,
                    p.name === room.createdBy ? 'host' : null,
                    isMuted ? 'muted' : null,
                    presence ? presence.label : null,
                  ].filter(Boolean).join(', ');
                  return (
                    <div
                      key={`${p.name}-${p.client}`}
                      role="group"
                      aria-label={rowLabel}
                      className={`flex items-center gap-2.5 rounded-lg border px-2.5 py-2 transition ${rowFade} ${isMuted ? 'border-amber-400/40 bg-amber-500/10' : 'border-border-faint bg-surface-softer'}`}
                    >
                      <AgentAvatar participant={p} size="lg" />
                      <div className="min-w-0 flex-1">
                        <div className="msg-author flex flex-wrap items-center gap-1 truncate">
                          {p.name}
                          {p.name === room.createdBy && <span className="rounded bg-accent-tint px-1 py-px text-[12px] font-semibold text-accent">host</span>}
                          {isMuted && <span className="rounded bg-amber-500/15 px-1 py-px text-[12px] font-semibold text-amber-300">muted</span>}
                        </div>
                        <div className="msg-meta truncate">
                          {[p.role, kindLabel].filter(Boolean).join(' · ')}
                        </div>
                        {/* T-68: the state is the SERVER's verdict (T-66), not a
                            second classification computed here. `listening` proves a
                            loop is armed; `online` only means we heard from them
                            recently — they stay distinct, because collapsing them is
                            what let presence lie. */}
                        {presence && (
                          <div className={`msg-meta mt-0.5 flex items-center gap-1 font-medium ${STATE_TONE_PRESENCE[presence.state].text}`}>
                            {presenceGlyph(STATE_TONE_PRESENCE[presence.state].glyph)}
                            <span>{presence.label}</span>
                            {presence.detail && <span className="text-ink-faint">· {presence.detail}</span>}
                            {presence.state !== 'listening' && h && (
                              // T-143: lastSeenAgoMs < 0 means "no timestamp" —
                              // render "unknown", never a wall-clock (which would
                              // print the epoch, "1969", for a null row).
                              h.lastSeenAgoMs < 0 ? (
                                <span className="text-ink-faint">· last heard: unknown</span>
                              ) : (
                                <span className="text-ink-faint" title={new Date(Date.now() - h.lastSeenAgoMs).toLocaleString()}>
                                  · last heard {relativeTime(Date.now() - h.lastSeenAgoMs)}
                                </span>
                              )
                            )}
                          </div>
                        )}
                        {h && canRecover(h, ended) && (
                          <button
                            type="button"
                            onClick={() => copyText(
                              recoveryPrompt(code, p.name, p.role),
                              'Recovery prompt copied — paste it into that agent\'s terminal',
                            )}
                            aria-label={`Copy the prompt to bring ${p.name} back into the room`}
                            title={`${p.name} is not listening. Copy a prompt to paste into its terminal.`}
                            className="mt-1.5 flex min-h-11 w-full items-center justify-center rounded-lg border border-border px-3 text-[13px] font-semibold text-ink-soft transition hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                          >
                            Copy recovery prompt
                          </button>
                        )}
                      </div>
                      {/*
                        Host controls — always visible (no hover-to-reveal).
                        Hover-only buttons hid the kick action so badly that
                        a user reported "the delete agent button isn't
                        obvious" and "the mute button feels cramped". Keep
                        them quiet visually (low contrast, neutral border)
                        but always discoverable, and only render at all when
                        the viewer is actually the host.
                      */}
                      {/* Details (ⓘ) is always available; host controls (Ask/
                          Mute/Remove) render only for the host. */}
                      <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => setDetailsFor(p)}
                            title={`Details for ${p.name}`}
                            aria-label={`Details for ${p.name}`}
                            className="flex min-h-11 min-w-11 items-center justify-center"
                          >
                            <span className="flex h-9 w-9 items-center justify-center rounded-md border border-border-faint bg-surface text-ink-soft transition hover:border-accent/40 hover:bg-accent/10 hover:text-accent lg:h-7 lg:w-7">
                              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <circle cx="8" cy="8" r="6.25" /><path d="M8 7v3.4M8 5.15v.05" />
                              </svg>
                            </span>
                          </button>
                          {canAsk && (
                            <button
                              onClick={() => { void handleAskAgent(p); }}
                              title={`Ask ${p.name}`}
                              aria-label={`Ask ${p.name}`}
                              disabled={modeBusy}
                              className="flex min-h-11 min-w-11 items-center justify-center disabled:opacity-60"
                            >
                              <span className="flex h-9 min-w-9 items-center justify-center rounded-md border border-accent-tint-border bg-accent-tint px-1.5 text-[12px] font-semibold text-accent transition hover:bg-accent-tint-border lg:h-7 lg:min-w-7">
                                Ask
                              </span>
                            </button>
                          )}
                          {canMuteToggle && (
                            <button
                              onClick={() => handleToggleMute({ name: p.name, client: p.client, canSpeak: p.canSpeak })}
                              title={isMuted ? `Unmute ${p.name}` : `Mute ${p.name}`}
                              aria-label={isMuted ? `Unmute ${p.name}` : `Mute ${p.name}`}
                              className="flex min-h-11 min-w-11 items-center justify-center"
                            >
                              <span className={`flex h-9 w-9 items-center justify-center rounded-md border text-[12px] transition lg:h-7 lg:w-7 ${isMuted
                                ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
                                : 'border-border-faint bg-surface text-ink-soft hover:border-amber-400/40 hover:bg-amber-500/10 hover:text-amber-300'}`}>
                              {/* Speaker glyph: solid when can speak, slashed when muted. */}
                              {isMuted ? (
                                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <path d="M8 3.5 4.5 6.25H2.5v3.5h2L8 12.5z" />
                                  <path d="m11 6 3 4M14 6l-3 4" />
                                </svg>
                              ) : (
                                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <path d="M8 3.5 4.5 6.25H2.5v3.5h2L8 12.5z" />
                                  <path d="M11 5.75c.75.6 1.25 1.4 1.25 2.25s-.5 1.65-1.25 2.25" />
                                </svg>
                              )}
                              </span>
                            </button>
                          )}
                          {canKick && (
                            <button
                              onClick={() => handleKick({ name: p.name, client: p.client })}
                              title={`Remove ${p.name} (asks to confirm)`}
                              aria-label={`Remove ${p.name} from the room`}
                              className="ml-1 flex min-h-11 min-w-11 items-center justify-center"
                            >
                              <span className="flex h-9 w-9 items-center justify-center rounded-md border border-border-faint bg-surface text-ink-soft transition hover:border-red-400/40 hover:bg-red-500/10 hover:text-red-300 lg:h-7 lg:w-7">
                                <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
                                  <path d="m4 4 8 8M12 4l-8 8" />
                                </svg>
                              </span>
                            </button>
                          )}
                      </div>
                    </div>
                  );
  };

  const personGroupOf = (p: (typeof room.participants)[number]) => {
    const h = healthById.get(healthKey(p.name, p.client));
    const s = h ? presenceView(h).state : null;
    return s === 'stale' ? 'attention' as const : s === 'disconnected' ? 'offline' as const : 'active' as const;
  };
  const peopleGroups = {
    active: room.participants.filter(p => personGroupOf(p) === 'active'),
    attention: room.participants.filter(p => personGroupOf(p) === 'attention'),
    offline: room.participants.filter(p => personGroupOf(p) === 'offline'),
  };
  const peoplePanel = (
    <div>
      {peopleGroups.active.length > 0 && (
        <section aria-label="Active participants" className="mb-5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">Active · {peopleGroups.active.length}</h3>
          <div className="space-y-2">{peopleGroups.active.map(renderPersonRow)}</div>
        </section>
      )}
      {peopleGroups.attention.length > 0 && (
        <section aria-label="Participants needing attention" className="mb-5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-warning">Needs attention · {peopleGroups.attention.length}</h3>
          <div className="space-y-2">{peopleGroups.attention.map(renderPersonRow)}</div>
        </section>
      )}
      {peopleGroups.offline.length > 0 && (
        <section aria-label="Offline participants">
          <button
            type="button"
            onClick={() => setShowOffline(v => !v)}
            aria-expanded={showOffline}
            className="mb-2 flex min-h-11 items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint transition hover:text-ink"
          >
            <span aria-hidden="true" className={`transition-transform ${showOffline ? 'rotate-90' : ''}`}>›</span>
            Offline · {peopleGroups.offline.length}
          </button>
          {showOffline && <div className="space-y-2">{peopleGroups.offline.map(renderPersonRow)}</div>}
        </section>
      )}
    </div>
  );


  // T-71: every destination renders through the shared page anatomy.
  const renderPanel = (tab: InspectorTab) =>
    tab === 'people' ? (
      <PageScaffold
        title="People"
        purpose="Everyone in the room and how alive their connection is."
        summary={<>
          <SummaryChip tone="ok">{peopleGroups.active.length} active</SummaryChip>
          {peopleGroups.attention.length > 0 && <SummaryChip tone="warn">{peopleGroups.attention.length} need attention</SummaryChip>}
          {peopleGroups.offline.length > 0 && <SummaryChip tone="quiet">{peopleGroups.offline.length} offline</SummaryChip>}
        </>}
        action={(
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSummonOpen(true)}
              className="flex min-h-11 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-semibold text-ink-soft transition hover:border-border-strong hover:text-ink"
            >
              <span aria-hidden="true">＋</span> Summon
            </button>
            <button
              type="button"
              onClick={() => copyText(joinUrl, 'Invite link copied')}
              className="flex min-h-11 items-center rounded-lg bg-accent px-4 text-sm font-bold text-white transition hover:opacity-90"
            >
              Invite
            </button>
          </div>
        )}
      >
        {peoplePanel}
      </PageScaffold>
    ) : tab === 'project' ? (
      <PageScaffold
        title="Project"
        purpose="The evidence-gated task board: claimed, built, submitted, verified."
        summary={activeRoom.projectId && taskPulse && taskPulse.length > 0 ? (() => {
          const done = taskPulse.filter(t => t.state === 'done').length;
          const review = taskPulse.filter(t => t.state === 'awaiting_review').length;
          const pending = taskPulse.length - done - review;
          return (
            <>
              <SummaryChip tone="quiet">{pending} active</SummaryChip>
              {review > 0 && <SummaryChip tone="warn">{review} awaiting review</SummaryChip>}
              {/* Done means VERIFIER-CONFIRMED only — the board's done state
                  is only reachable through room_task_verify. */}
              <SummaryChip tone="ok">{done} verified done</SummaryChip>
            </>
          );
        })() : undefined}
      >
        <ProjectPanel
          room={activeRoom}
          isHost={isHost}
          selfName={me.name}
          board={taskPulse}
          boardError={boardErrorRoom === code}
          onRetryBoard={() => setBoardNonce(n => n + 1)}
          onAttached={() => { void refreshRoom(); }}
        />
      </PageScaffold>
    ) : tab === 'room' ? (
      <PageScaffold
        title="Settings"
        purpose="Room identity, access, reply mode, and lifecycle."
        action={(
          /* One Back path: the command-bar chevron returns to the prior
             destination while Settings is open (backOverride). */
          <button
            type="button"
            onClick={() => copyText(joinUrl, 'Invite link copied')}
            className="flex min-h-11 items-center rounded-lg bg-accent px-4 text-sm font-bold text-white transition hover:opacity-90"
          >
            Invite
          </button>
        )}
      >
        {roomInfoPanel}
      </PageScaffold>
    ) : (
      <PageScaffold
        title="Outputs"
        purpose="Deliverables, artifacts, and minutes this room has produced. Share report freezes them into a permanent link for people outside the room."
        summary={producedWork.length === 0 ? undefined : (
          <>
            {(['decision', 'todo', 'result'] as const).map(kind => {
              const count = producedWork.filter(a => a.kind === kind).length;
              const noun = kind === 'decision' ? 'decision' : kind === 'todo' ? 'action' : 'result';
              return count > 0
                ? <SummaryChip key={kind} tone="ok">{count} {noun}{count === 1 ? '' : 's'}</SummaryChip>
                : null;
            })}
            <SummaryChip tone="quiet">Last produced {messageTime(producedWork[producedWork.length - 1]!.time, now)}</SummaryChip>
          </>
        )}
        action={outputsViewState(serverArtifacts, artifactsError) === 'ready' && producedWork.length > 0 ? (
          /* Hidden while the work set is unknown (loading/error) and at true
             zero — a report of unverified or absent work must not be one tap
             away (rev16 item 7). */
          <button
            type="button"
            onClick={handleExportReport}
            disabled={reportBusy}
            aria-label="Create a shareable delivery report of this room and copy its link"
            className="flex min-h-11 items-center rounded-lg bg-accent px-4 text-sm font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {reportBusy ? 'Saving…' : 'Share report'}
          </button>
        ) : undefined}
      >
        {renderOutputs()}
      </PageScaffold>
    );

  const headerAgents = activeRoom.participants
    .filter(participant => participant.client === 'cc')
    .map(participant => ({
      name: participant.name,
      color: participant.color,
      initials: participant.initials,
      harness: participant.harness,
      participant,
      state: healthById.get(healthKey(participant.name, participant.client))?.state
        ?? ((participant.listenUntil ?? 0) > now ? 'listening' as const : 'online' as const),
    }));
  const headerAgentStaleCount = headerAgents.filter(agent => agent.state === 'stale' || agent.state === 'disconnected').length;

  // T-71 (rev16 item 6): the contextual rail is a WORKSPACE surface — it
  // pairs with chat AND the destination pages at >=1440, earning its column
  // via the two-populated-sections rule.
  const contextRail = railSectionCount(headerAgents.length, taskPulse?.length ?? 0, serverArtifacts) >= 2 ? (

        <aside ref={rightAsideRef} style={{ width: rightPaneWidth }} aria-label="Room context" className="modern-scrollbar relative hidden flex-shrink-0 flex-col gap-5 overflow-y-auto border-l border-border-faint bg-surface px-4 py-5 min-[1440px]:flex">
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize room context"
            onPointerDown={(e) => { rightDragRef.current = true; document.body.style.userSelect = 'none'; (e.currentTarget as HTMLElement).classList.add('dragging'); }}
            onPointerUp={(e) => (e.currentTarget as HTMLElement).classList.remove('dragging')}
            onDoubleClick={() => { setRightPaneWidth(300); try { localStorage.setItem('roomctx:width', '300'); } catch { /* ignore */ } }}
            className="pane-resize-handle absolute -left-1 top-0 z-20 h-full w-2"
          />
          <section aria-label="Active agents">
            <h3 className="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/70" aria-hidden="true" />Agents
            </h3>
            <div className="space-y-1">
              {headerAgents.slice(0, 6).map(a => (
                <button
                  key={a.name}
                  type="button"
                  onClick={() => selectTab('people')}
                  aria-label={`${a.name}, ${a.state} — open People`}
                  className="flex min-h-11 w-full items-center gap-2 rounded-lg px-1.5 text-left transition hover:bg-surface-softer"
                >
                  {/* Same avatar vocabulary as People/facepile (assessor
                      residual): the shared AgentAvatar, not a bespoke chip. */}
                  <span aria-hidden="true" className="flex-shrink-0"><AgentAvatar participant={a.participant} size="md" /></span>
                  <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink">{a.name}</span>
                  {/* Visible worded state — a bare glyph fails without color
                      or icon comprehension (red-team finding). */}
                  <span className={`flex flex-shrink-0 items-center gap-1 text-[14px] font-medium ${STATE_TONE_PRESENCE[a.state].text}`}>
                    {presenceGlyph(STATE_TONE_PRESENCE[a.state].glyph)}
                    {a.state === 'listening' || a.state === 'online' ? 'Active' : a.state === 'stale' ? 'Needs attention' : 'Offline'}
                  </span>
                </button>
              ))}
              {headerAgents.length === 0 && <p className="text-[14px] text-ink-soft">No agents connected yet.</p>}
            </div>
          </section>
          {taskPulse && taskPulse.length > 0 && (() => {
            const doneCount = taskPulse.filter(t => t.state === 'done').length;
            const reviewCount = taskPulse.filter(t => t.state === 'awaiting_review').length;
            return (
              <section aria-label="Project pulse" className="border-t border-border-faint pt-4">
                <h3 className="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent/70" aria-hidden="true" />Project pulse
                </h3>
                <button
                  type="button"
                  onClick={() => selectTab('project')}
                  aria-label={`Project: ${doneCount} of ${taskPulse.length} verified — open Project`}
                  className="w-full rounded-lg border border-border-faint bg-surface-softer p-3 text-left transition hover:border-accent/40"
                >
                  <div className="text-[14px] font-semibold text-ink">{doneCount} of {taskPulse.length} verified</div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border-faint">
                    <div className="h-full rounded-full bg-success transition-all" style={{ width: `${Math.round((doneCount / taskPulse.length) * 100)}%` }} />
                  </div>
                  <p className="mt-2 text-[14px] text-ink-soft">{taskPulse.length - doneCount} open · {reviewCount} awaiting review</p>
                </button>
              </section>
            );
          })()}
          <section aria-label="Recent outputs" className="border-t border-border-faint pt-4">
            <h3 className="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint">
              <span className="h-1.5 w-1.5 rounded-full bg-ink-faint" aria-hidden="true" />Recent outputs
            </h3>
            {producedWork.length > 0 ? (
              <ul className="space-y-1">
                {producedWork.slice(-3).reverse().map(a => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => selectTab('outputs')}
                      aria-label={`Output from ${a.author} — open Outputs`}
                      className="flex min-h-11 w-full items-center rounded-lg px-1.5 text-left transition hover:bg-surface-softer"
                    >
                      <span className="truncate text-[14px] text-ink-soft" title={a.text}>
                        <span className="font-semibold text-ink">{a.author}</span> · {a.text.slice(0, 60)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[14px] text-ink-soft">Nothing produced yet.</p>
            )}
          </section>
        </aside>
  ) : null;

  // T-141: the slash-command palette is open when the composer holds a leading
  // "/" and we are not dictating; dismissed after Esc / a completion. paletteIndex
  // is clamped to the current match count.
  const paletteCommands = !paletteDismissed && !dictating && !dictationDraft ? filterSlashCommands(text) : [];
  const paletteActive = paletteCommands.length > 0 ? paletteIndex % paletteCommands.length : 0;

  return (
    // T-82: on phones the CHAT tab is full-bleed (pt-0) — the feed's top
    // clearance lives inside its scroll content, so hiding chrome reveals
    // feed pixels instead of a blank placeholder strip.
    <div className={`flex h-[100dvh] w-full overflow-hidden bg-surface-sunken lg:pt-14 ${mainTab === 'chat' ? 'pt-0 sm:pt-[96px]' : 'pt-[96px]'} ${chromeHidden && mainTab === 'chat' ? 'chrome-hidden' : ''}`}>
      <WorkspaceRail />
      <RoomListPane activeCode={code} selfName={me.name} />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-soft">
        <RoomHeader
          room={activeRoom}
          ended={ended}
          workspaceNav={(
            /* T-71: navigation lives IN the command bar. Search is a control
               INSIDE the center cluster (Waqas) — it opens the palette as a
               vertical dropdown, so the center cluster stays centered and the
               right cluster is global/you only. */
            <div className="flex items-center gap-1.5">
              <WorkspaceSwitcher
                destinations={MAIN_TABS}
                active={mainTab}
                onSelect={key => selectTab(key as MainTab)}
              />
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                aria-label="Search rooms, messages, and tasks"
                title="Search (⌘K)"
                className="header-glass-control flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl text-ink-soft transition hover:text-ink"
              >
                <svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                  <circle cx="7" cy="7" r="4.25" /><path d="m10.2 10.2 3 3" />
                </svg>
              </button>
            </div>
          )}
          mobileNavHidden={false}
          backOverride={mainTab === 'room' ? {
            label: `Back to ${MAIN_TABS.find(t => t.key === prevTabRef.current)?.label ?? 'Chat'}`,
            onBack: () => selectTab(prevTabRef.current),
          } : undefined}
          listeningCount={listeningCount}
          inspectorOpen={inspectorOpen}
          onShare={() => copyText(joinUrl, 'Invite link copied')}
          onToggleInspector={() => setInspectorOpen(v => !v)}
          onSearch={() => setSearchOpen(true)}
          onOpenRoom={() => selectTab('room')}
          onEndRoom={handleEndMeeting}
          canEndRoom={!ended && activeRoom.createdBy === self.name}
          selfName={self.name}
          agents={headerAgents}
          agentStaleCount={headerAgentStaleCount}
          mentionNav={selfMentionIds.length > 0 ? (
            // T-18 rev2 + T-42 (UX: "@↑ 29 @↓ is cryptic"): the counter now
            // SAYS what it counts — "3 mentions" / "1/3 mentions" — and the
            // steppers are chevron icons with full accessible names. Quiet by
            // default; amber only while unseen mentions exist. 44px targets.
            (() => {
              const pos = mentionCursorId != null ? selfMentionIds.indexOf(mentionCursorId) : -1;
              // UX T-60 review item 3: the n/m fraction carries information
              // only MID-SEEK; caught up collapses to a quiet "@ N".
              const seeking = mentionSeeking || (pos !== -1 && pos < selfMentionIds.length - 1) || unseenMentions > 0;
              const tone = unseenMentions > 0 ? 'text-amber-500' : seeking ? 'text-ink-soft' : 'text-ink-faint';
              const counter = pos === -1
                ? `${selfMentionIds.length} mention${selfMentionIds.length === 1 ? '' : 's'}`
                : `${pos + 1}/${selfMentionIds.length} mentions`;
              return (
                // Waqas's crowding capture: inside the T-58 right cluster the
                // long "@ 14/14 mentions" label jammed the agents object, and
                // the steppers' bare title tooltips broke the no-bare-title
                // rule. The counter is now compact everywhere ("@ 14/14"), the
                // full wording lives on the group's accessible name, and the
                // cluster keeps an 8px gap to its neighbors.
                <span
                  role="group"
                  aria-label={`Mentions of you: ${counter}`}
                  className="mx-1 flex flex-shrink-0 items-center gap-0.5"
                >
                  <button
                    type="button"
                    onClick={() => gotoMention(-1)}
                    disabled={mentionSeeking}
                    aria-label="Previous mention of you"
                    className={`header-glass-control flex min-h-11 min-w-11 items-center justify-center rounded-lg transition disabled:opacity-50 ${tone}`}
                  >
                    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m3.5 10 4.5-5 4.5 5" />
                    </svg>
                  </button>
                  <span className={`whitespace-nowrap text-[12px] font-semibold tabular-nums ${tone}`} aria-hidden="true">
                    @ {seeking && pos !== -1 ? `${pos + 1}/${selfMentionIds.length}` : selfMentionIds.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => gotoMention(1)}
                    disabled={mentionSeeking}
                    aria-label="Next mention of you"
                    className={`header-glass-control flex min-h-11 min-w-11 items-center justify-center rounded-lg transition disabled:opacity-50 ${tone}`}
                  >
                    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m3.5 6 4.5 5 4.5-5" />
                    </svg>
                  </button>
                </span>
              );
            })()
          ) : undefined}
        />

        {/* T-07: mid-session poll failures surface as this quiet strip while the
            interval retries underneath — never as a screen-replacing error. */}
        {degraded && (
          <div
            role="status"
            className="flex flex-shrink-0 items-center justify-center gap-2 border-b border-amber-400/30 bg-amber-500/10 px-3 py-1.5 text-[12px] font-semibold text-amber-500"
          >
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-amber-400/40 border-t-amber-500" aria-hidden="true" />
            Connection hiccup — reconnecting…
          </div>
        )}

        {/* T-30: a non-chat tab owns the pane at EVERY width now, not just lg. */}
        {mainTab !== 'chat' && (
          <div className="flex min-h-0 flex-1">
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
              <div className="mx-auto w-full max-w-[860px]">{renderPanel(mainTab)}</div>
            </div>
            {contextRail}
          </div>
        )}

        {/* T-71: on xl+ the chat pairs with a contextual rail — the reading
            measure stays deliberate while the canvas carries live context. */}
        <div className={`min-h-0 flex-1 ${mainTab === 'chat' ? 'flex' : 'hidden'}`}>
        <div
          className="relative flex min-h-0 min-w-0 flex-1 flex-col"
          style={{ '--composer-h': `${composerH}px` } as React.CSSProperties}
        >

            <div ref={feedRef} onScroll={onFeedScroll} data-gate="feed" className="relative flex-1 overflow-y-auto max-sm:py-0 sm:py-4">
              {/* T-48: center a generous conversation rail on wide desktops.
                  MessageRow caps prose at 80ch while images/artifacts can use
                  the extra canvas without creating edge-to-edge text.
                  T-82: on phones the top/bottom clearances are CONTENT
                  padding — the fixed bar and overlay composer sit above feed
                  pixels, and hiding them exposes reading canvas, no reflow. */}
              <div
                className="mx-auto w-full max-w-[1280px]"
                style={isPhone ? { paddingTop: 104, paddingBottom: composerH + 16 + (unseenCount > 0 || !atBottom || unseenMentions > 0 || mentionSeeking ? 56 : 0) } : { paddingBottom: composerH + 16 }}
              >
              {/* T-04: history is windowed; this strip marks the top of the
                  loaded window and doubles as the fetch indicator. */}
              {hasOlder && (
                <div className="flex items-center justify-center gap-2 py-2 text-[12px] font-semibold text-ink-faint" aria-live="polite">
                  {loadingOlder && <span className="h-3 w-3 animate-spin rounded-full border-2 border-border border-t-accent" aria-hidden="true" />}
                  {loadingOlder ? 'Loading earlier messages…' : 'Scroll up for earlier messages'}
                </div>
              )}
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
                // T-111: malformed agent sends stored zero-content rows that
                // render as a wall of blank bubbles; drop them BEFORE day
                // dividers and grouping so the visible feed reads coherently.
                // T-121: reaction event rows are transport for the chip patch,
                // not reading material — the chips on the target message are the UI.
                const visibleMessages = messages.filter(m => hasRenderableContent(m) && !isReactionEvent(m));
                // T-72: consecutive same-agent heartbeats render as ONE
                // Activity Note ("N updates") anchored at the newest ping.
                const statusView = collapseStatusRuns(visibleMessages);
                return (
                <>
                {visibleMessages.map((m, i) => (
                  // T-113: 95 stored rows in leap-lip-mule carry no id at all —
                  // undefined keys collapse React reconciliation; fall back to
                  // time or position so one bad envelope cannot blank a room.
                  <Fragment key={m.id ?? `envelope-${m.time ?? 'x'}-${i}`}>
                  {startsMessageDay(visibleMessages[i - 1], m) && <MessageDayDivider time={m.time} now={now} />}
                  {/* T-65: the line he stopped reading at, so catching up has a
                      visible starting point instead of guesswork. */}
                  {m.id === firstUnreadIdRef.current && (
                    <div className="my-3 flex items-center gap-3 px-4" aria-label="New messages">
                      <div className="h-px flex-1 bg-accent/40" />
                      <span className="flex-shrink-0 text-[12px] font-bold uppercase tracking-wide text-accent">New messages</span>
                      <div className="h-px flex-1 bg-accent/40" />
                    </div>
                  )}
                  {m.metadata?.brief ? (
                    <BriefCard
                      text={m.text ?? ''}
                      speech={m.metadata.briefSpeech}
                      scope={m.metadata.briefScope}
                      selfName={self.name}
                    />
                  ) : m.metadata?.eventType === 'question_created' && m.metadata.questionId ? (
                    <QuestionArtifactCard
                      message={m}
                      question={ownerQuestions.find(question => question.id === m.metadata?.questionId)}
                      isOwner={isHost}
                      onOpen={() => setOpenQuestionId(m.metadata!.questionId!)}
                    />
                  ) : isStatusPing(m) ? (
                    statusView.hidden.has(m.id)
                      ? null
                      : <ActivityNote message={m} run={statusView.runs.get(m.id)} now={now} />
                  ) : (
                    <MessageRow
                      key={m.id ?? `envelope-${m.time ?? 'x'}-${i}`}
                      message={m}
                      self={m.name === self.name && m.client === 'web'}
                      grouped={isSameGroup(visibleMessages[i - 1], m)}
                      ambiguousNames={ambiguousNames}
                      now={now}
                      onReply={startReply}
                      onJumpToQuote={jumpToMessage}
                      onReact={reactTo}
                      selfName={self.name}
                      senderBrand={brandForSender(m, activeRoom.participants)}
                    />
                  )}
                  </Fragment>
                ))}
                {/* T-23: a quiet end-of-conversation cap. It is the LAST feed
                    element, so it only comes into view once every message above
                    it has been scrolled past — reaching it IS being caught up,
                    which keeps the claim honest without tracking read-state
                    here. Suppressed for empty rooms and for ended meetings
                    (their own closed-state banner is the end-cap there). */}
                {visibleMessages.length > 0 && !ended && (
                  <div
                    data-gate="caught-up"
                    className="my-4 flex items-center justify-center gap-2 px-4 text-ink-faint"
                    aria-label="You're all caught up"
                  >
                    <div className="h-px w-8 bg-border" />
                    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m3 8.5 3.1 3.1L13 4.7" />
                    </svg>
                    <span className="text-[12px] font-semibold">You're all caught up</span>
                    <div className="h-px w-8 bg-border" />
                  </div>
                )}
                </>
                );
              })()}

              {showIdlePrompt && !ended && (
                <div className="sticky bottom-0 mx-auto bg-surface border border-border rounded-xl shadow-lg p-4 text-center max-w-sm">
                  <p className="text-sm font-semibold text-ink mb-1">No activity for 1 hour</p>
                  <p className="text-xs text-ink-soft mb-3">Meeting will close in <span className="font-bold text-red-600">{countdown}s</span></p>
                  <div className="flex gap-2 justify-center">
                    <button onClick={dismissIdlePrompt} className="px-4 py-1.5 bg-accent text-white text-xs font-semibold rounded-lg">
                      Keep open
                    </button>
                    <button onClick={handleEndMeeting} className="px-4 py-1.5 bg-red-500/10 text-red-300 text-xs font-semibold rounded-lg border border-red-400/30">
                      End now
                    </button>
                  </div>
                </div>
              )}
              </div>

            </div>

              {/* T-48/T-65: jump-to-latest, one tap back to live whenever he's
                  scrolled up, with the count when there's something new. */}
              {/* T-72 ruling (>=sm): a dedicated layout LANE between feed and
                  composer — a message structurally cannot sit behind these
                  controls. T-82 (phone): the lane leaves the layout and the
                  pill floats bottom-right above the measured composer, with
                  the feed reserving collision padding only while it exists;
                  it stays visible as the way back to now even with chrome
                  hidden (it drops to the safe-area edge). */}
              {/* T-45 (owner ruling): on >=sm the lane no longer reserves a
                  band — it OVERLAYS the canvas just above the floating
                  composer, so its appearance reflows nothing. The wrapper is
                  click-transparent; only the pills take pointer events. */}
              {(unseenCount > 0 || !atBottom || selfMentionIds.length > 0) && (
                <div
                  data-gate="floating"
                  className="room-latest-lane flex w-full items-center justify-center gap-2 px-4 py-1.5 sm:pointer-events-none sm:absolute sm:inset-x-0 sm:z-[25] sm:py-0"
                  style={!isPhone ? { bottom: composerH + 12 } : undefined}
                >
                  {(unseenCount > 0 || !atBottom) && (
                    <button
                      type="button"
                      onClick={scrollToBottom}
                      aria-label={unseenCount > 0 ? `Jump to ${unseenCount} new messages` : 'Jump to latest messages'}
                      className="pointer-events-auto flex min-h-11 w-fit items-center gap-1.5 rounded-full bg-accent px-4 text-[12px] font-semibold text-white shadow-lg transition hover:opacity-90"
                    >
                      <span aria-hidden="true">↓</span>
                      {unseenCount > 0
                        ? `${unseenCount} new message${unseenCount === 1 ? '' : 's'}`
                        : 'Latest'}
                    </button>
                  )}
                  {/* T-18 rev2 per UX: the mention pill appears ONLY when
                      unseen mentions exist or a seek is running, labels its
                      count as "new", uses 44px targets, and removes itself the
                      moment the reader catches up. The standing entry point
                      lives in the header next to the room title. */}
                  {(unseenMentions > 0 || mentionSeeking) && (
                    <div role="group" aria-label="Unseen mentions of you" className="pointer-events-auto flex items-center gap-1 rounded-full border border-amber-400/50 bg-surface px-2 py-0.5 shadow-lg">
                      {mentionSeeking ? (
                        <span className="flex min-h-11 items-center gap-2 px-1.5 text-[12px] font-semibold text-ink-soft">
                          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-amber-400/40 border-t-amber-500 motion-reduce:animate-none" aria-hidden="true" />
                          Finding earlier mention…
                        </span>
                      ) : (
                        <>
                          <span className="px-1 text-[12px] font-bold tabular-nums text-amber-500">
                            @ {unseenMentions} new
                          </span>
                          <button
                            type="button"
                            onClick={() => { gotoMention(1); setUnseenMentions(0); }}
                            aria-label={`Jump to ${unseenMentions} new mention${unseenMentions === 1 ? '' : 's'} of you`}
                            title="Jump to the new mention of you"
                            className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-[12px] font-semibold text-amber-500 transition hover:bg-amber-500/10"
                          >
                            Go
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

            {/* T-82: the whole bottom block overlays the feed on phones and
                slides below the viewport in immersive reading (pinned states
                keep it up); >=sm it stays in flow exactly as before. */}
            <div ref={composerWrapRef} className="room-bottom-chrome sm:absolute sm:inset-x-0 sm:bottom-0 sm:z-20">
            {ended ? (
              // A1: ended-room CTA pivots from "Reactivate-only" to a primary
              // "Save & Share" call-to-action. Once the meeting wraps, the most
              // valuable next step is to freeze it into a permanent shareable
              // report (creates the asset + copies the link to clipboard);
              // Reactivate stays available as a secondary option, Back-to-home
              // tertiary. This makes share-link generation a one-click move
              // and feeds the viral loop: every shared link is also a demo of
              // the product.
              <div className="border-t border-border-faint p-4 bg-surface-softer">
                <p className="text-xs text-ink-soft mb-3 text-center">
                  This meeting has ended. Save it as a permanent report you can share with your team or client.
                </p>
                <div className="flex flex-wrap gap-3 justify-center items-center">
                  <button
                    onClick={handleExportReport}
                    disabled={reportBusy || messages.length === 0}
                    className="text-xs font-semibold text-white bg-accent px-4 py-1.5 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {reportBusy ? 'Saving…' : 'Save & Share'}
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        const client = createClient();
                        await reactivateRoomApi(client, code, { requesterName: self?.name });
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
                    className="text-xs font-semibold text-ink-muted bg-surface border border-border px-4 py-1.5 rounded-lg hover:border-accent/40 hover:text-accent transition"
                  >
                    Reactivate
                  </button>
                  <button onClick={() => navigate('/')} className="text-xs font-semibold text-ink-faint hover:text-ink-muted">Back to home</button>
                </div>
              </div>
            ) : !myCanSpeak ? (
              <div className="border-t border-border-faint p-5 bg-amber-500/10 text-center">
                <div className="text-2xl mb-1">🔇</div>
                <p className="text-sm font-semibold text-amber-900 mb-1">You've been muted by the host</p>
                <p className="text-xs text-amber-800/80 max-w-xs mx-auto">
                  The host ({room.createdBy}) has muted your messages. You can still read the conversation — ask them to unmute (🔊) when you're ready to speak again.
                </p>
              </div>
            ) : (
              <div
                className={`relative border-t border-border-faint p-3 max-sm:p-2 bg-surface transition ${dragActive ? 'ring-2 ring-inset ring-accent bg-accent-tint/40' : ''}`}
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={e => { void handleDrop(e); }}
              >
                {dragActive && (
                  <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-accent bg-surface/90 text-sm font-semibold text-accent shadow-sm">
                    Release to attach
                  </div>
                )}
                {/* T-48: composer aligns to the wider conversation canvas. */}
                <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-2">
                {isHost && mutedCount > 0 && (
                  <div className="text-[12px] font-semibold text-amber-200 bg-amber-500/10 border border-amber-400/30 rounded-md px-2 py-1.5 flex items-center gap-2">
                    <span>🔇</span>
                    <span>{mutedCount} {mutedCount === 1 ? 'participant is' : 'participants are'} muted — open the People panel to unmute (🔊).</span>
                  </div>
                )}
                {replyingTo && (
                  <div className="flex items-center gap-2 rounded-lg border-l-2 border-accent bg-surface-softer px-3 py-1.5">
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] font-semibold text-accent-deep">Replying to {replyingTo.name}</div>
                      <div className="truncate text-[12px] text-ink-faint">{replyingTo.text || '…'}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setReplyingTo(null)}
                      aria-label="Cancel reply"
                      className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-ink-soft transition hover:bg-surface hover:text-ink"
                    >
                      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg>
                    </button>
                  </div>
                )}
                {attachments.length > 0 && (
                  /* T-84/T-85: chip stacks CAP and scroll on phones — the
                     bottom stack may never climb toward mid-screen. */
                  <div className="flex flex-wrap gap-2 max-sm:max-h-28 max-sm:overflow-y-auto">
                    {attachments.map(attachment => (
                      <PendingAttachment
                        key={attachment.id}
                        attachment={attachment}
                        onRemove={() => setAttachments(prev => prev.filter(item => item.id !== attachment.id))}
                      />
                    ))}
                  </div>
                )}
                {attachmentJobs.length > 0 && (
                  <div className="flex flex-wrap gap-2 max-sm:max-h-28 max-sm:overflow-y-auto" aria-live="polite" aria-label="Attachment upload status">
                    {attachmentJobs.map(job => (
                      <div key={job.id} className={`flex max-w-[280px] items-center gap-2 rounded-lg border px-2.5 py-2 text-[12px] ${job.state === 'failed' ? 'border-amber-400/40 bg-amber-500/10' : 'border-accent-tint-border bg-accent-tint'}`}>
                        {job.state === 'uploading' ? (
                          <span className="h-4 w-4 flex-shrink-0 animate-spin rounded-full border-2 border-accent/20 border-t-accent motion-reduce:animate-none" aria-hidden="true" />
                        ) : (
                          <span className="flex-shrink-0 font-bold text-amber-400" aria-hidden="true">!</span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold text-ink">{job.file.name}</span>
                          <span className="block truncate text-ink-soft">{job.state === 'uploading' ? 'Uploading…' : job.error || 'Upload failed'}</span>
                        </span>
                        {job.state === 'failed' && (
                          <>
                            <button type="button" onClick={() => { void retryAttachment(job); }} className="min-h-8 rounded-md px-2 font-semibold text-accent hover:bg-surface">Retry</button>
                            <button type="button" onClick={() => setAttachmentJobs(prev => prev.filter(item => item.id !== job.id))} aria-label={`Dismiss failed upload ${job.file.name}`} className="h-8 w-8 rounded-md font-bold text-ink-soft hover:bg-surface">×</button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {/* T-63 (host: "this persistent big panel across the bottom …
                    you are wasting so much space; notice how Teams does it").
                    The chips were a permanent row of chrome. Teams floats its
                    suggestions above the box and only when they're relevant — so
                    these now appear only while the draft is empty and vanish the
                    moment you type, giving the space back to the conversation. */}
                {!text.trim() && composerFocused && (
                  <div className="hidden lg:flex flex-wrap items-center gap-2 text-[12px]">
                    <button
                      type="button"
                      onMouseDown={e => { e.preventDefault(); fillPrompt('minutes'); }}
                      className="min-h-11 rounded-full border border-accent-tint-border bg-accent-tint px-3 font-semibold text-accent hover:bg-accent-tint-border transition"
                    >
                      Ask for minutes
                    </button>
                    <button
                      type="button"
                      onMouseDown={e => { e.preventDefault(); fillPrompt('reply'); }}
                      className="min-h-11 rounded-full border border-border bg-surface-softer px-3 font-semibold text-ink-muted hover:border-accent/40 hover:text-accent transition"
                    >
                      Ask for reply draft
                    </button>
                  </div>
                )}
                {/* Host direction 2026-07-20 (supersedes the T-63 one-row layout):
                    the input keeps its full width; the tools live on their own
                    compact row below it inside the same bordered surface, so the
                    typing area is never squeezed by active buttons on mobile. */}
                {/* T-128: while recording, the whole field carries an always-on
                    accent (not just the on-focus ring a typed box gets), so it
                    reads as an active live-transcription surface. */}
                <div data-gate="composer" data-recording={dictating ? 'true' : undefined} className={`relative rounded-2xl border bg-surface-softer px-1 py-1 transition ${dictating ? 'border-accent ring-4 ring-accent-tint' : 'border-border focus-within:border-accent focus-within:ring-4 focus-within:ring-accent-tint'}`}>
                {/* T-09: Slack/Teams-style in-place participant picker. Opens
                    while the caret sits in an @token; mouse uses onMouseDown so
                    the textarea never blurs before the pick lands. */}
                {mention && mentionCandidates.length > 0 && (
                  <div
                    role="listbox"
                    aria-label="Mention a participant"
                    className="absolute bottom-full left-0 right-0 z-20 mb-2 overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
                  >
                    {mentionCandidates.map((name, i) => {
                      const active = i === mention.index % mentionCandidates.length;
                      return (
                        <button
                          key={name}
                          type="button"
                          role="option"
                          aria-selected={active}
                          onMouseDown={e => { e.preventDefault(); pickMention(name); }}
                          className={`flex min-h-11 w-full items-center gap-2.5 px-3 py-2 text-left text-sm font-semibold transition ${active ? 'bg-accent-tint text-accent' : 'text-ink hover:bg-surface-softer'}`}
                        >
                          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white" style={{ backgroundColor: colorForName(name) }}>{initialsFor(name)}</span>
                          <span className="truncate">{name}</span>
                          <span className="ml-auto flex-shrink-0 text-[12px] font-normal text-ink-faint">@{mentionToken(name)}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {/* T-128: a labeled, gently pulsing indicator while recording so
                    it is unmistakably a live-transcription surface, distinct from
                    a box you are typing into. Sits above the field; the field is
                    already multi-line tall from the moment recording starts. */}
                {dictating && (
                  <div data-gate="transcribing" className="mx-1 mb-1 flex items-center gap-2 rounded-lg bg-accent/10 px-2.5 py-1 text-[12px] font-semibold text-accent">
                    <span className="relative flex h-2 w-2" aria-hidden="true">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
                    </span>
                    <span>Transcribing your voice…</span>
                  </div>
                )}
                {dictationDraft && text.trim() && (
                  <div className="mx-1 mt-1 flex items-center gap-2 rounded-lg border border-accent-tint-border bg-accent-tint px-2.5 py-1.5 text-[12px]">
                    <span className="min-w-0 flex-1 font-semibold text-accent-deep">Voice draft: editable. Type to revise, then Send.</span>
                    <button
                      type="button"
                      onClick={() => { voiceRef.current?.pause(); setText(dictationUndoRef.current); setDictationDraft(false); setDictationPaused(false); requestAnimationFrame(() => textareaRef.current?.focus()); }}
                      className="min-h-8 rounded-md px-2 font-semibold text-accent hover:bg-surface"
                    >
                      Undo
                    </button>
                    <button
                      type="button"
                      onClick={() => { voiceRef.current?.pause(); setText(''); setDictationDraft(false); setDictationPaused(false); requestAnimationFrame(() => textareaRef.current?.focus()); }}
                      className="min-h-8 rounded-md px-2 font-semibold text-red-300 hover:bg-red-500/10"
                    >
                      Clear
                    </button>
                  </div>
                )}
                {/* T-120 FULL-WIDTH FIELD RULE (host order, supersedes the
                    T-45 one-row layout and the T-84 phone swap): the text box
                    owns the entire composer width at every moment; controls
                    live on their own compact row BELOW. While dictating the
                    tools row goes INVISIBLE (not hidden) so it keeps its
                    height as the recording bar's cover zone — the live
                    transcript stays visible above the bar. */}
                <div className="relative">
                {!dictating && (
                  <CommandPalette
                    commands={paletteCommands}
                    activeIndex={paletteActive}
                    onPick={completeCommand}
                    onHover={setPaletteIndex}
                  />
                )}
                <textarea
                  ref={textareaRef}
                  value={text}
                  onChange={e => {
                    const v = e.target.value;
                    setText(v);
                    syncMention();
                    // T-141: any real edit that departs from the just-completed
                    // command re-opens the palette (so filtering resumes) and
                    // resets the highlight to the top.
                    if (v !== completedCmdRef.current) {
                      completedCmdRef.current = null;
                      setPaletteDismissed(false);
                      setPaletteIndex(0);
                      setPaletteNavigated(false);
                    }
                    // T-138: onChange fires only for real user input (programmatic
                    // setText from the live transcript does NOT), so a keystroke
                    // while recording means the user is taking over — pause the mic
                    // and re-anchor so resume appends after these edits.
                    if (dictating) {
                      voiceRef.current?.pause();
                      dictationBaseRef.current = v;
                      setDictating(false);
                      setDictationPaused(true);
                    }
                  }}
                  onSelect={syncMention}
                  onFocus={() => setComposerFocused(true)}
                  onBlur={() => { setComposerFocused(false); window.setTimeout(() => setMention(null), 150); }}
                  onPaste={e => { void handlePaste(e); }}
                  onKeyDown={e => {
                    // Confirming an IME candidate is text entry, never a send
                    // or mention-pick command. WebKit may expose it as 229.
                    const isComposing = e.nativeEvent.isComposing || e.keyCode === 229;
                    if (isComposing) return;
                    // T-09: while the mention picker is open it owns the keys.
                    if (mention && mentionCandidates.length > 0) {
                      if (e.key === 'ArrowDown') { e.preventDefault(); setMention(m => m && { ...m, index: (m.index + 1) % mentionCandidates.length }); return; }
                      if (e.key === 'ArrowUp') { e.preventDefault(); setMention(m => m && { ...m, index: (m.index - 1 + mentionCandidates.length) % mentionCandidates.length }); return; }
                      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(mentionCandidates[mention.index % mentionCandidates.length]!); return; }
                      if (e.key === 'Escape') { e.preventDefault(); setMention(null); return; }
                    }
                    // T-141 rev2: while the command palette is open, arrows move
                    // the highlight, Tab always completes, Esc dismisses. Enter is
                    // deliberate: it only COMPLETES when the user has arrow-picked a
                    // choice OR narrowed to a single partial match (e.g. "/brief-w").
                    // Otherwise Enter falls through and SENDS/RUNS the typed command
                    // — so "type /brief, press Enter" just works. (The earlier build
                    // ate every Enter into a completion and never ran the command.)
                    // T-142: derive the palette decision from the LIVE composer
                    // value (the DOM), not the last-rendered React state — a fast
                    // Enter within ~300ms of a keystroke would otherwise read stale
                    // `text`/`paletteCommands` and clear the command without running.
                    const liveValue = textareaRef.current?.value ?? text;
                    const liveCmds = paletteDismissed || dictating || dictationDraft ? [] : filterSlashCommands(liveValue);
                    if (liveCmds.length > 0) {
                      const len = liveCmds.length;
                      const active = Math.min(paletteActive, len - 1);
                      if (e.key === 'ArrowDown') { e.preventDefault(); setPaletteNavigated(true); setPaletteIndex(i => (i + 1) % len); return; }
                      if (e.key === 'ArrowUp') { e.preventDefault(); setPaletteNavigated(true); setPaletteIndex(i => (i - 1 + len) % len); return; }
                      if (e.key === 'Escape') { e.preventDefault(); setPaletteDismissed(true); return; }
                      if (e.key === 'Tab') { e.preventDefault(); completeCommand(liveCmds[active]!); return; }
                      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
                        const target = liveCmds[active]!;
                        const typed = liveValue.trim();
                        const targetInsert = target.insert.trim();
                        const differs = targetInsert !== typed;
                        const isExtension = differs && targetInsert.toLowerCase().startsWith(typed.toLowerCase());
                        // Only SEND when the typed text is itself a runnable command
                        // (so a bare "/" or partial never sends garbage). Otherwise
                        // complete: on explicit navigation, when not-yet-runnable, or
                        // when narrowed to a single partial like "/brief-w".
                        const runnable = parseBriefCommand(typed) != null;
                        if (differs && (paletteNavigated || !runnable || (len === 1 && isExtension))) {
                          e.preventDefault();
                          completeCommand(target);
                          return;
                        }
                        // else: a complete runnable command — fall through and send/run.
                      }
                    }
                    const enterAction = composerEnterAction({
                      key: e.key,
                      shiftKey: e.shiftKey,
                      ctrlKey: e.ctrlKey,
                      metaKey: e.metaKey,
                      altKey: e.altKey,
                      isComposing,
                    });
                    if (enterAction === 'send') {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  aria-label="Message the room. Enter sends; Shift or Control plus Enter adds a new line."
                  placeholder="Message…"
                  rows={1}
                  style={{
                    height: dictating ? TEXTAREA_DICTATING_MIN : composerExpanded ? TEXTAREA_EXPANDED_MIN : TEXTAREA_MIN_HEIGHT,
                    // T-85 phone cap mirrors autoGrow: long transcripts scroll
                    // inside the field instead of displacing the controls.
                    maxHeight: isPhone
                      ? Math.min(composerExpanded ? TEXTAREA_EXPANDED_MAX : TEXTAREA_MAX_HEIGHT, Math.round(window.innerHeight * 0.28))
                      : composerExpanded ? TEXTAREA_EXPANDED_MAX : TEXTAREA_MAX_HEIGHT,
                  }}
                  /* T-74: the semantic composer role keeps typed and placeholder
                     text readable at physical phone scale. Borderless — the
                     wrapper owns the border and focus ring. */
                  className="msg-composer w-full resize-none overflow-y-auto border-0 bg-transparent px-2 py-2 outline-none focus:ring-0"
                />
                {/* T-85 hotfix: NOT position:relative - the recording overlay
                    inside VoiceButton is absolute inset-x-0 and must anchor to
                    the full-width composer wrapper above, not this tool row.
                    T-120: `invisible` (not hidden) while dictating keeps the
                    row's height as the overlay's cover zone; the overlay
                    itself is `visible` so it escapes the inherited hiding. */}
                <div className={`flex items-center gap-0.5 ${dictating ? 'invisible' : ''}`}>
                  <input
                    ref={imageInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    accept={Array.from(ALLOWED_ATTACHMENT_TYPES).filter(type => type.startsWith('image/')).join(',')}
                    onChange={e => { if (e.target.files) void addFiles(e.target.files); }}
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
                    ref={attachTriggerRef}
                    type="button"
                    onClick={() => setAttachmentMenuOpen(open => !open)}
                    disabled={attachBusy || attachments.length >= MAX_ATTACHMENTS_PER_MESSAGE}
                    title="Add photos or files"
                    aria-label="Add photos or files"
                    aria-haspopup="dialog"
                    aria-expanded={attachmentMenuOpen}
                    className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl text-ink-soft transition hover:bg-surface-softer hover:text-ink disabled:opacity-50"
                  >
                    {attachBusy ? (
                      <span className="text-xs font-semibold">…</span>
                    ) : (
                      <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="m13 7.5-4.9 4.9a3.1 3.1 0 0 1-4.4-4.4l5.3-5.3a2.1 2.1 0 0 1 3 3l-5.3 5.3a1.1 1.1 0 0 1-1.6-1.6L9.8 4.7" />
                      </svg>
                    )}
                  </button>
                  {/* T-80: every exit path is real (Cancel/backdrop/Escape/
                      Back), and the sheet closes BEFORE the native picker
                      opens, so an OS cancel can never strand it. */}
                  <AttachmentSheet
                    open={attachmentMenuOpen}
                    onClose={() => setAttachmentMenuOpen(false)}
                    onPickImages={() => imageInputRef.current?.click()}
                    onPickFiles={() => fileInputRef.current?.click()}
                    returnFocusRef={attachTriggerRef}
                  />
                  {/* T-120: the mic is ALWAYS present — its own row means no
                      width contention, which is what the old T-84 swap and the
                      T-79/T-119 visibility rules existed to manage. */}
                  <span className="contents">
                  <VoiceButton
                    ref={voiceRef}
                    resumeMode={dictationPaused}
                    onStart={() => {
                      // Re-anchor to whatever is in the draft NOW (typed edits
                      // included) so a resume appends after them (T-138).
                      dictationBaseRef.current = text;
                      if (!dictationPaused) dictationUndoRef.current = text;
                      setDictationDraft(true);
                      setDictating(true);
                      setDictationPaused(false);
                    }}
                    onLiveTranscript={(live) => {
                      const base = (dictationBaseRef.current ?? '').trim();
                      setText(base && live ? `${base} ${live}` : live || dictationBaseRef.current || '');
                      setDictationDraft(true);
                      // T-120 (c): the live stream keeps the box scrolled to
                      // the NEWEST words — programmatic setText leaves
                      // scrollTop at the oldest line once the draft passes
                      // the field's cap.
                      requestAnimationFrame(() => {
                        const ta = textareaRef.current;
                        if (ta) ta.scrollTop = ta.scrollHeight;
                      });
                    }}
                    onTranscript={(t) => {
                      const base = (dictationBaseRef.current ?? '').trim();
                      setText(base && t ? `${base} ${t}` : t || base);
                      dictationBaseRef.current = null;
                      setDictationDraft(true);
                      setDictating(false);
                      setDictationPaused(false);
                      requestAnimationFrame(() => textareaRef.current?.focus());
                    }}
                    onCancel={() => {
                      if (dictationBaseRef.current !== null) setText(dictationBaseRef.current);
                      dictationBaseRef.current = null;
                      setDictationDraft(false);
                      setDictating(false);
                      setDictationPaused(false);
                    }}
                    hideTriggerWhileActive
                    disabled={ended}
                  />
                  </span>
                  <span className="flex-1" aria-hidden="true" />
                  <button
                    onClick={() => setComposerExpanded(v => !v)}
                    title={composerExpanded ? 'Collapse writing surface' : 'Expand writing surface'}
                    aria-label={composerExpanded ? 'Collapse writing surface' : 'Expand writing surface'}
                    className={`hidden h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl transition sm:flex ${composerExpanded ? 'bg-accent-tint text-accent' : 'text-ink-soft hover:bg-surface-softer hover:text-ink'}`}
                  >
                    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      {composerExpanded
                        ? <path d="M5.5 2.5h-3v3M13.5 10.5v3h-3M2.5 5.5 6 9M13.5 13.5 10 10" transform="rotate(90 8 8)" />
                        : <path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9.25 6.75M2.5 13.5l4.25-4.25" />}
                    </svg>
                  </button>
                  {/* Icon-only send (Teams parity). Stays 44px — a big tap target,
                      just not a wide labelled slab eating the row. */}
                  <button
                    onClick={send}
                    disabled={!text.trim() && attachments.length === 0}
                    title="Send"
                    aria-label="Send message"
                    className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-accent text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <svg viewBox="0 0 16 16" width="17" height="17" fill="currentColor" aria-hidden="true">
                      <path d="M1.7 7.3 13.6 2a.6.6 0 0 1 .8.8L9.1 14.7a.6.6 0 0 1-1.1 0L6.2 10.5a.6.6 0 0 0-.3-.3L1.7 8.4a.6.6 0 0 1 0-1.1Z" transform="rotate(-8 8 8)" />
                    </svg>
                  </button>
                </div>
                </div>
                </div>
                </div>
              </div>
            )}
            </div>
        </div>
        {/* T-71 rail rules (locked): preview only, ONE shared board source
            (Room owns the poll, ProjectPanel consumes the same data), every
            item deep-links to its owning page, no duplicate actions, no
            independent scroll, >=1440 only. */}
        {contextRail}
        </div>
      </main>

      {/* Mobile keeps the slide-over sheet — a phone has no room for peer tabs.
          On desktop the same panels are peers of the chat inside <main>, so the
          Inspector's desktop column is gone (T-64). */}
      <Inspector open={inspectorOpen} onClose={() => setInspectorOpen(false)} renderTab={renderPanel} />
      {summonOpen && <SummonAgentSheet code={code} onClose={() => setSummonOpen(false)} />}
      {detailsFor && <AgentDetailsSheet code={code} participant={detailsFor} onClose={() => setDetailsFor(null)} />}
      <CommandSearch
        open={searchOpen}
        room={activeRoom}
        onClose={() => setSearchOpen(false)}
        onTask={taskId => {
          selectTab('project');
          if (taskId) {
            const params = new URLSearchParams(window.location.search);
            params.set('panel', 'project');
            params.set('task', taskId);
            window.history.replaceState(null, '', `${window.location.pathname}?${params}`);
            window.dispatchEvent(new PopStateEvent('popstate'));
          }
        }}
        onMessage={messageId => {
          selectTab('chat');
          window.setTimeout(() => document.getElementById(`msg-${messageId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
        }}
      />
      {openQuestionId && (
        <QuestionArtifactSheet
          code={code}
          questionId={openQuestionId}
          isOwner={isHost}
          onClose={() => setOpenQuestionId(null)}
          onAnswered={(answered) => setOwnerQuestions(current => current.map(question => question.id === answered.id ? answered : question))}
        />
      )}
    </div>
  );

  // Hoisted below the return on purpose: keeps the Outputs JSX in its
  // pre-T-05 source position (smaller diff) while the Inspector calls it
  // lazily per open tab.
  function renderOutputs() {
    // T-71: the page anatomy owns title/summary/primary; this is the CONTENT
    // — filter chips over work-object cards, then the Minutes object.
    const kinds: Array<{ key: 'all' | ArtifactKind; label: string }> = [
      { key: 'all', label: 'All' },
      { key: 'decision', label: 'Decisions' },
      { key: 'todo', label: 'Actions' },
      { key: 'result', label: 'Results' },
    ];
    const filtered = outputsFilter === 'all' ? producedWork : producedWork.filter(a => a.kind === outputsFilter);
    if (outputsViewState(serverArtifacts, artifactsError) === 'loading') {
      // Initial load: never flash a false zero while the index is in flight.
      return (
        <div role="status" aria-live="polite" className="flex items-center gap-2 rounded-xl border border-border-faint bg-surface-softer p-4 text-[15px] text-ink-soft sm:text-[14px]">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-accent motion-reduce:animate-none" aria-hidden="true" />
          Loading produced work…
        </div>
      );
    }
    if (outputsViewState(serverArtifacts, artifactsError) === 'error') {
      // Never convert a fetch failure into a false empty state.
      return (
        <div role="alert" className="rounded-xl border border-red-400/30 bg-red-500/5 p-4">
          <p className="text-[15px] font-semibold text-red-400 sm:text-[14px]">Couldn't load produced work</p>
          <p className="mt-1 text-[15px] leading-relaxed text-ink-soft sm:text-[14px]">The output index didn't respond, so this room's work can't be shown or verified right now.</p>
          <button
            type="button"
            onClick={() => setArtifactsNonce(n => n + 1)}
            className="mt-3 flex min-h-11 w-fit items-center rounded-lg border border-border px-4 text-sm font-semibold text-ink-soft transition hover:border-accent hover:text-accent"
          >
            Retry
          </button>
        </div>
      );
    }
    return (
      <div>
        <div role="group" aria-label="Filter outputs" className="mb-4 flex flex-wrap gap-1.5">
          {kinds.map(k => (
            <button
              key={k.key}
              type="button"
              aria-pressed={outputsFilter === k.key}
              onClick={() => { setOutputsFilter(k.key); setShowAllArtifacts(false); }}
              className={`flex min-h-11 min-w-11 items-center justify-center rounded-lg px-3 text-[15px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:text-[14px] ${
                outputsFilter === k.key ? 'workspace-active' : 'workspace-idle hover:bg-surface-softer'
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>
        {filtered.length ? (
          <div className="space-y-2">
            {(showAllArtifacts ? filtered.slice().reverse() : filtered.slice(-8).reverse()).map(artifact => (
              <ArtifactCard
                key={artifact.id}
                artifact={artifact}
                now={now}
                failed={isFailedCard(seekFailure, artifact.id)}
                onOpenSource={messageId => {
                  setSeekFailure(f => seekFailureReducer(f, { type: 'retry' }));
                  seekArtifactIdRef.current = artifact.id;
                  selectTab('chat');
                  seekGenRef.current += 1;
                  seekAttemptsRef.current = 0;
                  setSourceSeekId(messageId);
                }}
              />
            ))}
            {filtered.length > 8 && (
              <button
                type="button"
                onClick={() => setShowAllArtifacts(v => !v)}
                className="flex min-h-11 w-full items-center justify-center rounded-lg text-[15px] font-semibold text-ink-soft transition hover:bg-surface-softer hover:text-ink sm:text-[14px]"
              >
                {showAllArtifacts ? 'Show fewer' : `Show all ${filtered.length}`}
              </button>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-border-faint bg-surface-softer p-4 text-[15px] leading-relaxed text-ink-soft sm:text-[14px]">
            {outputsFilter === 'all'
              ? 'Nothing produced yet. Decisions, actions, and results from this room will appear here as the work lands.'
              : `No ${kinds.find(k => k.key === outputsFilter)?.label.toLowerCase()} produced yet — switch to All to see everything the room has produced.`}
          </div>
        )}
        <div className="mt-6">
          <h3 className="mb-2 text-[14px] font-semibold uppercase tracking-wide text-ink-faint">Minutes</h3>
          {/* Explicitly an EMPTY STATE + prompt, never dressed as produced
              work; generated minutes arrive as transcript artifacts. */}
          <div className="rounded-xl border border-dashed border-border bg-transparent p-4">
            <p className="text-[15px] font-semibold text-ink-soft sm:text-[14px]">No minutes yet</p>
            <p className="mt-1 text-[15px] leading-relaxed text-ink-soft sm:text-[14px]">
              Minutes land in the transcript and are captured in the delivery report.
            </p>
            <button
              type="button"
              onClick={() => { appendText('Please generate minutes of this meeting so far.'); selectTab('chat'); }}
              className="mt-3 flex min-h-11 w-fit items-center rounded-lg border border-border px-4 text-sm font-semibold text-ink-soft transition hover:border-accent hover:text-accent"
            >
              Ask for minutes
            </button>
          </div>
        </div>
      </div>
    );
  }
}

// T-71 work-object anatomy: kind is METADATA, not a title. The title is the
// first meaningful line/sentence; anything longer becomes the bounded summary
// below it (shared T-72 endpoint disclosure).
// Locked cascade (design lead): explicit first line <=80 → first sentence
// <=80 → last clause boundary (colon/semicolon/comma/dash) in 24-80 → last
// word <=72. The summary CONTINUES after the boundary; no duplicated or
// orphaned punctuation, no grammatically dangling halves.
export function artifactParts(text: string): { title: string; summary: string } {
  const trimmed = text.trim();
  if (!trimmed) return { title: '', summary: '' };
  const nl = trimmed.indexOf('\n');
  if (nl > 0 && nl <= 80) return { title: trimmed.slice(0, nl).trim(), summary: trimmed.slice(nl + 1).trim() };
  const sentence = trimmed.match(/^([^.!?\n]{1,79}[.!?])(?:\s|$)/);
  if (sentence) return { title: sentence[1]!, summary: trimmed.slice(sentence[0].length).trim() };
  if (trimmed.length <= 80 && nl < 0) return { title: trimmed, summary: '' };
  const head = trimmed.slice(0, 81);
  let cutAt = -1;
  let cutLen = 0;
  let keepPunct = false;
  // Comma removed as a boundary (design lead: '…Decision, Action,' /
  // 'and Result…' is a broken list split, not a clause). Colon, semicolon,
  // and spaced dash only; otherwise the word-cut fallback rules.
  const clause = /[:;](?=\s)|\s[—–-](?=\s)/g;
  let m: RegExpExecArray | null;
  while ((m = clause.exec(head))) {
    if (m.index >= 24 && m.index <= 79) {
      cutAt = m.index;
      cutLen = m[0].length + 1;
      keepPunct = /[:;]/.test(m[0]![0]!);
    }
  }
  if (cutAt > 0) {
    return {
      title: trimmed.slice(0, cutAt + (keepPunct ? 1 : 0)).trimEnd(),
      summary: trimmed.slice(cutAt + cutLen).trimStart(),
    };
  }
  const w = trimmed.lastIndexOf(' ', 72);
  const at = w > 24 ? w : 72;
  return { title: `${trimmed.slice(0, at).trimEnd()}…`, summary: trimmed.slice(at).trimStart() };
}

// T-71 user-facing vocabulary: the page says Action; [TODO] stays protocol.
function outputKindLabel(kind: ArtifactKind): string {
  return kind === 'todo' ? 'Action' : artifactLabel(kind);
}

function ArtifactCard({ artifact, now, failed, onOpenSource }: { artifact: RoomArtifact; now?: number; failed?: boolean; onOpenSource?: (messageId: number) => void }) {
  const { title, summary } = artifactParts(artifact.text);
  return (
    <div
      data-artifact-card={artifact.id}
      tabIndex={-1}
      className={`rounded-xl border bg-surface-softer p-3.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${failed ? 'border-red-400/40' : 'border-border-faint'}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`msg-meta font-semibold uppercase ${artifactTone(artifact.kind)}`}>
          {outputKindLabel(artifact.kind)}
        </span>
        <span className="msg-meta shrink-0">{artifact.author} · {messageTime(artifact.time, now)}</span>
      </div>
      <h4 data-gate="artifact-title" className="mt-1 line-clamp-2 text-[16px] font-semibold leading-snug text-ink">{title}</h4>
      {summary && (
        <div className="text-ink-soft">
          <ClampedNoteBody text={summary} expandLabel="Show the full output" dataRole="artifact-body" />
        </div>
      )}
      {/* rev20b: the failed card carries its own inline error and the
          relabeled retry — recovery lives ON the originating card. */}
      {failed && (
        <div role="alert" className="mt-2 rounded-lg border border-red-400/30 bg-red-500/5 px-3 py-2 text-[15px] leading-relaxed text-red-400 sm:text-[14px]">
          The jump to this source failed. History couldn't be loaded.
        </div>
      )}
      {/* Provenance beats vague export (design lead): every work object
          links back to its source message. */}
      {onOpenSource && (
        <button
          type="button"
          onClick={() => onOpenSource(artifact.sourceMessageId)}
          className={`msg-disclosure -mb-1.5 -ml-2 mt-0.5 flex h-11 items-center px-2 transition ${failed ? 'font-semibold text-red-400 hover:text-red-300' : 'text-ink-soft hover:text-accent'}`}
        >
          {failed ? 'Retry source jump' : 'View in chat'}
        </button>
      )}
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
        <div className="truncate text-[12px] font-semibold text-ink">{attachment.name}</div>
        <div className="text-[12px] text-ink-soft">{formatBytes(attachment.size)}</div>
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
      return 'text-amber-300';
    case 'status':
      return 'text-blue-700';
    case 'result':
      return 'text-violet-700';
  }
}
