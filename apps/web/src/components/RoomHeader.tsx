import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Room } from '@agent-room/shared';
import type { AgentFace } from '../lib/facepile.js';
import { AgentFacepile } from './AgentFacepile.js';
import { AccountMenu } from './AccountMenu.js';

// T-58 north star: one 56px app-wide command bar with three jobs.
// Left says WHERE, center says FIND, right says WHO / WHAT NOW.
// Mobile compresses the same hierarchy to 52px without inventing a second UI.

interface Props {
  room: Room;
  ended: boolean;
  listeningCount: number;
  inspectorOpen: boolean;
  onShare: () => void;
  onToggleInspector: () => void;
  onSearch: () => void;
  onOpenRoom: () => void;
  onSummon?: () => void;
  onEndRoom: () => void;
  canEndRoom: boolean;
  /** T-26/T-27: the signed-in person, for the account menu avatar. */
  selfName: string;
  agents: AgentFace[];
  agentStaleCount: number;
  mentionNav?: React.ReactNode;
  /** T-134: the owner "Brief me" control, rendered in the header action row. */
  briefControl?: React.ReactNode;
  /** T-71: the workspace switcher. Centered inside the bar at lg+; rendered
   *  as the second row of the SAME header shell below lg (52 + 44 = 96px). */
  workspaceNav?: React.ReactNode;
  /** T-71: full-screen mobile pages (Settings) drop the nav row — chrome
   *  returns to 52px and the page provides its own title/Back orientation. */
  mobileNavHidden?: boolean;
  /** T-71 one-Back-path ruling: while a full-screen page (Settings) is open,
   *  the chevron returns THERE (prev destination), not to Home. */
  backOverride?: { label: string; onBack: () => void };
}

export function RoomHeader({
  room,
  ended,
  listeningCount,
  inspectorOpen,
  onShare,
  onToggleInspector,
  onSearch,
  onOpenRoom,
  onSummon,
  onEndRoom,
  canEndRoom,
  selfName,
  agents,
  agentStaleCount,
  mentionNav,
  briefControl,
  workspaceNav,
  mobileNavHidden,
  backOverride,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const agentCount = agents.length;
  const activeAgentCount = Math.max(0, agentCount - agentStaleCount);
  const agentStatus = agentStaleCount > 0
    ? `${agentStaleCount} need attention`
    : `${activeAgentCount} active`;

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [menuOpen]);

  return (
    <header className={`app-command-bar fixed inset-x-0 top-0 z-40 flex flex-col ${workspaceNav ? (mobileNavHidden ? 'h-[52px] lg:h-14' : 'h-[96px] lg:h-14') : 'h-[52px] items-center sm:h-14'}`}>
      {/* T-109: px-1 below sm — every horizontal pixel the chrome keeps is a
          pixel the room name loses; four 44px controls already fill the bar. */}
      <div className={`relative z-10 flex min-w-0 items-center px-1 sm:px-3 ${workspaceNav ? 'h-[52px] flex-shrink-0 lg:h-full' : 'h-full flex-1 w-full'}`}>
        <div className="flex min-w-0 items-center">
          {backOverride ? (
            <button
              type="button"
              onClick={backOverride.onBack}
              aria-label={backOverride.label}
              className="header-glass-control flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl text-ink-soft transition hover:text-ink"
            >
              <svg viewBox="0 0 16 16" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M10.5 3 5.5 8l5 5" />
              </svg>
            </button>
          ) : (
          <Link
            to="/"
            aria-label="Back to rooms"
            className="header-glass-control flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl text-ink-soft transition hover:text-ink"
          >
            <svg viewBox="0 0 16 16" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10.5 3 5.5 8l5 5" />
            </svg>
          </Link>
          )}
          <Link
            to="/"
            aria-label="WakiChat home"
            className="header-brand-orb mr-1 hidden h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl transition sm:flex"
          >
            <img src="/brand/wakichat/wakichat-icon-192.png" alt="" className="h-7 w-7 rounded-lg shadow-[0_4px_18px_rgb(var(--accent)/0.45)]" />
          </Link>
          <button
            type="button"
            onClick={onOpenRoom}
            /* T-109: py-0.5 + block-flow pill keep the two-line identity
               inside the 52px bar — inline-flex left line-box slack that
               pushed the name 2px above the viewport under the status bar. */
            className="header-room-identity group min-h-11 min-w-0 rounded-xl px-1 py-0.5 text-left transition sm:flex sm:items-center sm:gap-2 sm:px-2.5"
            aria-label={`Open room settings for ${room.topic}`}
          >
            {/* T-109: 42vw capped the name below what the freed space allows;
                56vw lets a realistic title read at 390 while flex min-w-0
                still yields to the control cluster. */}
            <span className="block max-w-[56vw] truncate text-[15px] font-semibold leading-tight tracking-[-0.01em] text-ink sm:max-w-[220px] lg:max-w-[240px] xl:max-w-[300px]">
              {room.topic}
            </span>
            <span className={`header-room-presence mt-0 flex w-fit max-w-full items-center gap-1.5 truncate rounded-full px-1.5 py-0.5 text-[12px] font-medium leading-none ${ended ? 'text-red-400' : 'text-ink-soft'}`}>
              {!ended && <span className="header-live-dot inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-400" aria-hidden="true" />}
              <span className="truncate">
                {ended ? 'Meeting ended' : `${room.participants.length} here`}
                {!ended && listeningCount > 0 && <span className="text-ink-faint"> · {listeningCount} listening</span>}
                {room.workspace && <span className="text-ink-faint"> · <span aria-hidden="true">📁 </span>{room.workspace.split('/').pop()}</span>}
              </span>
            </span>
            <svg className="hidden flex-shrink-0 text-ink-faint opacity-0 transition group-hover:opacity-100 lg:block" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
              <path d="m3 11.8.4-2.3L10.8 2l2.2 2.2-7.5 7.5-2.5.1Z" />
            </svg>
          </button>
        </div>

        {workspaceNav && (
          /* Flex auto-margin centering from lg–xl (the nav squeezes between the
             clusters, never overlapping — absolute collided at 1024/1100/1280).
             At 2xl+ (ultrawide) there IS room, so TRUE-center it absolutely so
             the three clusters read as a clean left/center/right. */
          <div className="mx-auto hidden min-w-0 flex-shrink px-2 lg:block 2xl:absolute 2xl:left-1/2 2xl:mx-0 2xl:-translate-x-1/2">{workspaceNav}</div>
        )}
        {!workspaceNav && (
        <button
          type="button"
          onClick={onSearch}
          aria-label="Search rooms, messages, and tasks"
          className="group absolute left-1/2 hidden h-11 w-[min(320px,28vw)] -translate-x-1/2 items-center text-[13px] text-ink-faint transition hover:text-ink-soft md:flex"
        >
          <span className="header-search-field flex h-9 w-full items-center rounded-[10px] px-3 transition">
            <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
              <circle cx="7" cy="7" r="4.25" /><path d="m10.2 10.2 3 3" />
            </svg>
            <span className="ml-2 truncate">Search rooms, messages, tasks…</span>
            <kbd className="ml-auto rounded-md border border-border-faint bg-surface px-1.5 py-0.5 text-[12px] font-medium text-ink-soft">⌘K</kbd>
          </span>
        </button>
        )}

        <div className="ml-auto flex flex-shrink-0 items-center gap-0.5 sm:gap-1 lg:gap-1.5 2xl:gap-2 2xl:pr-1">
          <button
            type="button"
            onClick={onSearch}
            aria-label="Search rooms, messages, and tasks"
            /* T-109: below sm the icon leaves the bar entirely — Search moves
               into the overflow menu so the ROOM NAME gets the width. The
               phone header was handing five 44px controls full space while
               the name got ~90px (host escalation, screenshot 52335). */
            className={`header-glass-control hidden h-11 w-11 items-center justify-center rounded-xl text-ink-soft transition hover:text-ink sm:flex ${workspaceNav ? 'lg:hidden' : 'md:hidden'}`}
          >
            <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
              <circle cx="7" cy="7" r="4.25" /><path d="m10.2 10.2 3 3" />
            </svg>
          </button>
          {workspaceNav && (
            <button
              type="button"
              onClick={onSearch}
              aria-label="Search rooms, messages, and tasks"
              className="header-glass-control hidden h-11 flex-shrink-0 items-center gap-1.5 rounded-xl px-2.5 text-ink-soft transition hover:text-ink lg:flex"
            >
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                <circle cx="7" cy="7" r="4.25" /><path d="m10.2 10.2 3 3" />
              </svg>
              <kbd className="rounded-md border border-border-faint bg-surface px-1.5 py-0.5 text-[12px] font-medium text-ink-soft">⌘K</kbd>
            </button>
          )}
          {briefControl}
          <div className="hidden sm:block">{mentionNav}</div>
          {agentCount > 0 && (
            <>
              {/* T-109 phone chip: the multi-face pile cost ~80px the room
                  name needed. One 44px chip keeps the T-31 health language
                  (count + green dot / amber triangle, worded aria) and the
                  same tap-through to People; faces return at sm+. */}
              <button
                type="button"
                onClick={() => navigate(`/r/${room.code}?panel=people`)}
                aria-label={`${agentCount} agents, ${agentStatus}. Open People.`}
                className={`header-team-pill flex h-11 min-w-11 items-center justify-center gap-1 rounded-xl px-1.5 sm:hidden ${agentStaleCount > 0 ? 'header-team-pill-warn' : ''}`}
              >
                {agentStaleCount > 0 ? (
                  <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" className="flex-shrink-0 text-amber-400" aria-hidden="true">
                    <path d="M8 1.8 15.2 14H.8L8 1.8Z" />
                    <path d="M8 6v3.4M8 11.6v.1" stroke="rgb(var(--surface))" strokeWidth="1.6" strokeLinecap="round" fill="none" />
                  </svg>
                ) : (
                  <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-400" aria-hidden="true" />
                )}
                <span className={`text-[13px] font-semibold ${agentStaleCount > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>{agentCount}</span>
              </button>
              <div
                className={`header-team-pill hidden min-h-11 items-center rounded-xl pr-1 sm:flex sm:pr-2 ${agentStaleCount > 0 ? 'header-team-pill-warn' : ''}`}
                aria-label={`${agentCount} agents, ${agentStatus}`}
              >
                <AgentFacepile code={room.code} agentCount={agentCount} agentStaleCount={agentStaleCount} agents={agents} />
                {/* T-71 pixel review 5: facepile + ONE human-readable status —
                    details live in People, not a congested pill. */}
                <span className={`hidden items-center gap-1.5 pr-1 text-[13px] font-semibold xl:flex ${agentStaleCount > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${agentStaleCount > 0 ? 'bg-amber-400' : 'bg-emerald-400'}`} aria-hidden="true" />
                  {agentStatus}
                </span>
              </div>
            </>
          )}
          {/* T-102 HOTFIX (host-critical): the old box-with-exit-arrow glyph
              read as a DOOR. Sharing uses the universal share icon (tray +
              up arrow) and is visible at EVERY width, not desktop-only. */}
          <button
            type="button"
            onClick={onShare}
            aria-label="Share room invite link"
            title="Share room invite link"
            className="header-glass-control flex h-11 w-11 items-center justify-center gap-1.5 rounded-xl text-ink-soft transition hover:text-ink md:w-auto md:px-2.5"
          >
            <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-shrink-0">
              <path d="M8 10V1.8M4.9 4.7 8 1.6l3.1 3.1" />
              <path d="M3 7.5v5A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5v-5" />
            </svg>
            {/* Visible label wherever width allows (QA ruling rev3): below md
                the icon stays alone so room identity keeps its width — the
                sm boundary inverted legibility at exactly 640 (VA-0076). */}
            <span className="hidden text-[13px] font-semibold md:inline">Share</span>
          </button>
          <div ref={menuRef} className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen(open => !open)}
              aria-label="More room actions"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className={`header-glass-control flex h-11 w-11 items-center justify-center rounded-xl text-ink-soft transition hover:text-ink ${menuOpen ? 'header-glass-control-active text-ink' : ''}`}
            >
              <svg viewBox="0 0 16 16" width="19" height="19" fill="currentColor" aria-hidden="true">
                <circle cx="3" cy="8" r="1.15" /><circle cx="8" cy="8" r="1.15" /><circle cx="13" cy="8" r="1.15" />
              </svg>
            </button>
            {menuOpen && (
              /* T-26/T-27: room-scoped actions ONLY — personal preferences
                 (theme, reading scale, Log out) live in the account menu. */
              <div role="menu" aria-label="Room actions" className="absolute right-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-xl border border-border bg-surface p-1.5 shadow-2xl">
                {/* T-109: the standalone search icon left the phone bar so
                    the room name gets its width; Search lives here below sm. */}
                <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onSearch(); }} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-[13px] font-medium text-ink-soft transition hover:bg-surface-softer hover:text-ink sm:hidden">
                  <span className="flex w-5 justify-center" aria-hidden="true">
                    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <circle cx="7" cy="7" r="4.25" /><path d="m10.2 10.2 3 3" />
                    </svg>
                  </span>
                  Search
                </button>
                <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onOpenRoom(); }} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-[13px] font-medium text-ink-soft transition hover:bg-surface-softer hover:text-ink">
                  <span className="flex w-5 justify-center" aria-hidden="true">⚙</span>
                  Room settings & rename
                </button>
                {onSummon && !ended && (
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onSummon(); }} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-[13px] font-medium text-ink-soft transition hover:bg-surface-softer hover:text-ink">
                    <span className="flex w-5 justify-center" aria-hidden="true">
                      <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M8 2v5M8 7l2.2-1.3M8 7 5.8 5.7" /><circle cx="8" cy="10.5" r="3.2" />
                      </svg>
                    </span>
                    Summon agent
                  </button>
                )}
                <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onShare(); }} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-[13px] font-medium text-ink-soft transition hover:bg-surface-softer hover:text-ink sm:hidden">
                  <span className="flex w-5 justify-center" aria-hidden="true">
                    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M8 10V1.8M4.9 4.7 8 1.6l3.1 3.1" />
                      <path d="M3 7.5v5A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5v-5" />
                    </svg>
                  </span>
                  Share invite link
                </button>
                <div className="my-1 h-px bg-border-faint" />
                {/* Truthful label (design lead): this NAVIGATES; it does not
                    mutate participation. A real Leave lands with the T-06
                    identity-lifecycle work. */}
                <Link
                  to="/"
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                  className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-[13px] font-medium text-ink-soft transition hover:bg-surface-softer hover:text-ink"
                >
                  <span className="flex w-5 justify-center" aria-hidden="true">←</span>
                  Back to rooms
                </Link>
                {canEndRoom && (
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onEndRoom(); }} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-[13px] font-medium text-red-400 transition hover:bg-red-500/10">
                    <span className="flex w-5 justify-center" aria-hidden="true">×</span>
                    End room
                  </button>
                )}
              </div>
            )}
          </div>
          <AccountMenu name={selfName} onOpenSettings={onOpenRoom} />
          <button
            type="button"
            onClick={onToggleInspector}
            aria-label={inspectorOpen ? 'Close room details' : 'Open room details'}
            className="sr-only"
          />
        </div>
      </div>
      {workspaceNav && !mobileNavHidden && (
        <div className="flex h-11 flex-shrink-0 items-center px-2 lg:hidden">{workspaceNav}</div>
      )}
    </header>
  );
}
