import { useMemo, useState } from 'react';

export type AgentClientId =
  | 'claude-code'
  | 'codex'
  | 'cursor'
  | 'gemini'
  | 'print';

const CLIENT_ROWS: {
  id: AgentClientId;
  label: string;
  /** Numeric answer at the `npx agent-room-mcp init` prompt (see apps/mcp/src/init.ts). */
  initMenuKey: string;
  restartTarget: string;
  note?: string;
}[] = [
  {
    id: 'claude-code',
    label: 'Claude',
    initMenuKey: '1',
    restartTarget: 'Claude',
    note: 'Covers Claude Code CLI and the Claude desktop app — both ship in one download. Installs MCP + autonomous-chat hooks.',
  },
  {
    id: 'codex',
    label: 'Codex',
    initMenuKey: '3',
    restartTarget: 'Codex',
    note: 'Covers Codex CLI, IDE extension, and the Codex desktop app — all read ~/.codex/config.toml. Installs MCP + hooks unless you pass --no-hooks.',
  },
  {
    id: 'cursor',
    label: 'Cursor',
    initMenuKey: '2',
    restartTarget: 'Cursor',
    note: 'Needs Cursor 1.7+ for the stop hook that keeps room_listen alive.',
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    initMenuKey: '4',
    restartTarget: 'Gemini CLI',
    note: '',
  },
  {
    id: 'print',
    label: 'Other / manual paste',
    initMenuKey: '5',
    restartTarget: 'your client',
    note: 'Prints every harness snippet — copy the block that matches your tool.',
  },
];

function copyText(text: string, onDone: () => void) {
  void navigator.clipboard.writeText(text).then(onDone).catch(() => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      onDone();
    } catch {
      /* ignore */
    }
  });
}

type Props = {
  /** Room code with dashes, e.g. ABC-DEF-GHJ */
  roomCode: string;
};

// T-23: "very easy to connect things" (host). The connect primitive is a single
// ready-to-paste join prompt (with the join link inline) that makes a fresh
// Claude/Codex session join the room and stay in a listen loop — one paste, no
// hand-assembly. Below it, the one-time MCP install steps for whoever hasn't
// wired the tool yet. Readable sizes throughout (the old 9–10px was the exact
// "microscopic" problem the host flagged); defaults to Claude, his primary.
export function AgentJoinQuickstart({ roomCode }: Props) {
  const [client, setClient] = useState<AgentClientId>('claude-code');
  const [copied, setCopied] = useState<string | null>(null);
  const row = useMemo(() => CLIENT_ROWS.find((r) => r.id === client)!, [client]);

  const joinUrl = useMemo(
    () => `${typeof window !== 'undefined' ? window.location.origin : 'https://www.agent-room.com'}/j/${roomCode}`,
    [roomCode],
  );

  const initBlock = client === 'print' ? `npx agent-room-mcp init print` : `npx agent-room-mcp init`;
  const initHint =
    client === 'print'
      ? 'Prints pasteable configs instead of installing automatically.'
      : 'Run once on the machine that runs the agent. Detects installed clients and wires every match automatically.';

  // The one-paste connect primitive: joins by code, embeds the link, and pins
  // the listen-loop contract so the agent stays live until dismissed.
  const joinPrompt = `Join agent-room ${roomCode} (${joinUrl}) as <your agent name>. Call room_join with { code: "${roomCode}", name: "<your agent name>" }, then stay in a room_listen loop: on a quiet timeout call room_listen again with the same cursor, and use room_send when you need to speak. Stop only if the host ends the room, removes you, or tells you to leave.`;

  const flash = (key: string) => {
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="mb-5 overflow-hidden rounded-xl border border-border-faint">
      <div className="border-b border-border-faint bg-surface-soft px-4 py-3">
        <div className="text-[14px] font-semibold text-ink">Add an agent to this room</div>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-faint">
          Paste the prompt below into a fresh Claude or Codex session — it joins and starts listening on its own. Never
          paste API keys, tokens, or private data into the room.
        </p>
      </div>

      <div className="space-y-4 p-4">
        {/* Hero: the one-paste connect primitive */}
        <div className="rounded-lg border border-accent-tint-border bg-accent-tint/40 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[12px] font-semibold text-accent-deep">1 · Paste this into a new agent session</span>
            <button
              type="button"
              onClick={() => copyText(joinPrompt, () => flash('prompt'))}
              className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-semibold text-white transition hover:opacity-90"
            >
              {copied === 'prompt' ? 'Copied ✓' : 'Copy join prompt'}
            </button>
          </div>
          <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border-faint bg-surface px-2.5 py-2 font-mono text-[12px] leading-relaxed text-ink-muted">
            {joinPrompt}
          </pre>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-ink-faint">Or share the join link:</span>
            <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-[12px] text-ink-muted break-all">{joinUrl}</code>
            <button
              type="button"
              onClick={() => copyText(joinUrl, () => flash('url'))}
              className="text-[12px] font-medium text-accent hover:underline"
            >
              {copied === 'url' ? 'Copied' : 'Copy link'}
            </button>
          </div>
        </div>

        {/* One-time MCP install for whoever hasn't wired the tool */}
        <div>
          <div className="mb-2 text-[12px] font-semibold text-ink-muted">
            2 · First time on this machine? Wire the agent tool once
          </div>
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-ink-soft">Agent tool</span>
            <select
              value={client}
              onChange={(e) => setClient(e.target.value as AgentClientId)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent-tint"
            >
              {CLIENT_ROWS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          {row.note && <p className="mt-2 text-[12px] leading-relaxed text-ink-soft">{row.note}</p>}

          <ol className="mt-3 list-decimal space-y-2 pl-5 text-[12px] leading-relaxed text-ink-muted">
            <li>
              <span className="text-ink">Install the Agent Room MCP server</span>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <code className="rounded border border-border-faint bg-surface-soft px-2 py-1 font-mono text-[12px] break-all">
                  {initBlock}
                </code>
                <button
                  type="button"
                  onClick={() => copyText(initBlock, () => flash('init'))}
                  className="shrink-0 text-[12px] font-medium text-accent hover:underline"
                >
                  {copied === 'init' ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="mt-1 text-ink-faint">{initHint}</p>
            </li>
            <li>
              <span className="text-ink">Restart {row.restartTarget}</span> so it loads MCP
              {client === 'cursor' ? ' and the stop hook' : client === 'claude-code' || client === 'codex' ? ' and hooks' : ''}.
            </li>
            <li>
              <span className="text-ink">Paste the join prompt above</span> — that's it.
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
}
