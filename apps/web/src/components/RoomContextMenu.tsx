import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { copyText } from '../lib/copy.js';
import { menuPosition, useContextMenuTrigger, useDismissOnOutside } from '../lib/contextMenuTrigger.js';
import { ROOM_TEMPLATES } from '../lib/templates.js';
import {
  archiveRoomAction, unarchiveRoomAction, reactivateRoom, setRoomTemplateAction,
  listSummonedAgents, dismissSummonedAgent, hasHostKey, createClient,
} from '../lib/api.js';

// Room-card context actions (host order): long-press on touch, right-click on
// desktop, one menu — Open, Open People, Copy invite link, Change room type,
// Archive/Unarchive, Reactivate. All existing actions, surfaced where the
// rooms are listed instead of buried inside each room.

export interface RoomMenuTarget {
  code: string;
  topic: string;
  status?: string;    // 'active' | 'ended'
  archived?: boolean;
  x: number;
  y: number;
}

/** Press handling for a room card. The gesture logic itself (native
 *  contextmenu, the iOS long-press timer, the scroll guard, and swallowing the
 *  next click so the T-34 stretched Link doesn't ALSO navigate) is shared with
 *  the agent-row menu in `lib/contextMenuTrigger.ts`. This wrapper keeps the
 *  room-card call sites unchanged. */
export function useRoomCardMenu() {
  return useContextMenuTrigger<Omit<RoomMenuTarget, 'x' | 'y'>>();
}

export function RoomContextMenu({ menu, selfName, onClose, onChanged }: {
  menu: RoomMenuTarget;
  /** Host display name — reactivation records who asked. */
  selfName?: string;
  onClose: () => void;
  /** Called after any mutation so the hosting list can refresh itself. */
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const client = useRef(createClient()).current;
  const [typePicking, setTypePicking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // Client-side gate only decides what's worth SHOWING; the server re-verifies
  // host authority on every action.
  const canHost = hasHostKey(menu.code);
  const ended = menu.status === 'ended';

  useDismissOnOutside(onClose);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try {
      await fn();
      onChanged();
      onClose();
    } catch (e) {
      const { showToast } = await import('./Toast.js');
      showToast(e instanceof Error ? e.message : `Could not ${label.toLowerCase()}`, 'error');
      setBusy(null);
    }
  }

  async function archive() {
    // Same flow the in-room Settings uses: offer to stop attached agents.
    let agentIds: string[] = [];
    try {
      agentIds = (await listSummonedAgents())
        .filter((a) => a.room === menu.code && a.status === 'active')
        .map((a) => a.agentId);
    } catch { /* summoner may be down; archive anyway */ }
    if (agentIds.length > 0 && window.confirm(`Also stop & archive ${agentIds.length} agent(s) attached to this room?`)) {
      for (const id of agentIds) { try { await dismissSummonedAgent(id, true); } catch { /* best-effort */ } }
    }
    await archiveRoomAction(client, menu.code);
  }

  const item = 'flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] font-medium text-ink-soft transition hover:bg-surface-softer hover:text-ink disabled:opacity-50';
  const glyph = (d: string) => (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );

  return (
    <div
      role="menu"
      aria-label={`Actions for ${menu.topic}`}
      data-gate="room-context-menu"
      className="fixed z-50 w-[230px] overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-2xl"
      style={menuPosition(menu, 238, 330)}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="truncate px-3 py-1.5 text-[12px] font-medium uppercase tracking-wide text-ink-faint">{menu.topic}</div>

      <button type="button" role="menuitem" className={item} onClick={() => { onClose(); navigate(`/r/${menu.code}`); }}>
        {glyph('m6 3.5 5 4.5-5 4.5')}Open
      </button>
      <button type="button" role="menuitem" className={item} onClick={() => { onClose(); navigate(`/r/${menu.code}?panel=people`); }}>
        {glyph('M5.5 7a2.25 2.25 0 1 0 0-4.5A2.25 2.25 0 0 0 5.5 7Zm5 6.5v-1a3 3 0 0 0-3-3h-4a3 3 0 0 0-3 3v1m9.5-6.75a2.25 2.25 0 1 0-1.4-4M15 13.5v-1a3 3 0 0 0-2-2.83')}Open People
      </button>
      <button
        type="button"
        role="menuitem"
        className={item}
        onClick={() => { onClose(); void copyText(`${window.location.origin}/j/${menu.code}`, 'Invite link copied'); }}
      >
        {glyph('M6.5 9.5 9.5 6.5M7.5 4.75 9 3.25a2.65 2.65 0 0 1 3.75 3.75L11.25 8.5M8.5 11.25 7 12.75a2.65 2.65 0 0 1-3.75-3.75L4.75 7.5')}Copy invite link
      </button>

      {canHost && !ended && !menu.archived && (
        <>
          <div className="mx-3 my-1 h-px bg-border-faint" aria-hidden="true" />
          <button type="button" role="menuitem" aria-expanded={typePicking} className={item} onClick={() => setTypePicking((v) => !v)}>
            {glyph('M3 5.5h10M3 8h10M3 10.5h6')}Change room type…
          </button>
          {typePicking && (
            <div className="max-h-44 overflow-y-auto border-y border-border-faint bg-surface-softer/50 py-1" data-gate="room-type-picker">
              {ROOM_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="menuitem"
                  disabled={busy != null}
                  className={`${item} pl-7`}
                  onClick={() => void run('Change room type', async () => {
                    await setRoomTemplateAction(client, menu.code, t.id === 'blank' ? '' : t.id);
                    const { showToast } = await import('./Toast.js');
                    showToast(t.id === 'blank' ? 'Room type cleared.' : `Room type set to ${t.label}.`);
                  })}
                >
                  <span aria-hidden="true">{t.emoji}</span>{t.label}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {canHost && ended && (
        <button
          type="button"
          role="menuitem"
          disabled={busy != null}
          className={item}
          onClick={() => void run('Reactivate', async () => { await reactivateRoom(client, menu.code, { requesterName: selfName }); })}
        >
          {glyph('M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2v3h-3')}{busy === 'Reactivate' ? 'Reactivating…' : 'Reactivate room'}
        </button>
      )}

      {canHost && (menu.archived ? (
        <button
          type="button"
          role="menuitem"
          disabled={busy != null}
          className={item}
          onClick={() => void run('Unarchive', async () => { await unarchiveRoomAction(client, menu.code); })}
        >
          {glyph('M2 6.5h12M3 6.5V4A1 1 0 0 1 4 3h8a1 1 0 0 1 1 1v2.5M6.5 9.5h3M8 13.5V9.5')}{busy === 'Unarchive' ? 'Unarchiving…' : 'Unarchive room'}
        </button>
      ) : (
        <button
          type="button"
          role="menuitem"
          disabled={busy != null}
          className={item}
          onClick={() => void run('Archive', archive)}
        >
          {glyph('M2 3.5h12v3H2zM3 6.5v6A1 1 0 0 0 4 13.5h8a1 1 0 0 0 1-1v-6M6.5 9h3')}{busy === 'Archive' ? 'Archiving…' : 'Archive room'}
        </button>
      ))}
    </div>
  );
}
