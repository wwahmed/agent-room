import { useRef, useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useRoom } from '../hooks/useRoom.js';
import { Bubble } from '../components/Bubble.js';
import { MeetingCodePill } from '../components/MeetingCodePill.js';
import { Avatar } from '../components/Avatar.js';
import { colorForName, initialsFor } from '../lib/colors.js';
import type { Message } from '@agent-room/shared';

export function Room() {
  const { code = '' } = useParams();
  const stored = sessionStorage.getItem(`room:${code}:self`);
  const self = stored ? JSON.parse(stored) as { name: string; role: string } : { name: 'Guest', role: '' };
  const { room, messages, error, sendMessage } = useRoom(code, self.name);
  const [text, setText] = useState('');
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    feedRef.current?.scrollTo(0, feedRef.current.scrollHeight);
  }, [messages.length]);

  if (error) return <div className="p-10 text-red-600">{error}</div>;
  if (!room) return <div className="p-10 text-ink-soft">Loading…</div>;

  async function send() {
    const body = text.trim();
    if (!body) return;
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
            <div className="text-[10px] text-ink-soft">{room.participants.length} participants</div>
          </div>
          <div className="flex items-center gap-2">
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

        <div ref={feedRef} className="flex-1 overflow-y-auto p-5 flex flex-col gap-3 bg-surface-soft">
          {messages.map(m => <Bubble key={m.id} message={m} self={m.name === self.name} />)}
        </div>

        <div className="border-t border-border-faint p-3 bg-surface flex items-center gap-2">
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
    </div>
  );
}
