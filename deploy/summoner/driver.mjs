// driver.mjs — the per-agent loop for a summoned agent. Runs inside a tmux
// session (durable + attachable). It joins the room, then loops:
//   listen for new messages -> ask the provider model -> post the reply.
// Config comes from SM_* env vars (set by the summoner service).
import { writeFileSync, appendFileSync } from 'node:fs';
import { joinMint, listen, send, presence, messagesSince } from './roomcli.mjs';
import { invokeModel } from './providers.mjs';

const cfg = {
  code: process.env.SM_ROOM,
  name: process.env.SM_NAME,
  role: process.env.SM_ROLE || 'AI Agent',
  provider: process.env.SM_PROVIDER,
  model: process.env.SM_MODEL,
  workspace: process.env.SM_WORKSPACE,
  keyfile: process.env.SM_KEYFILE,
  sessionId: process.env.SM_SESSION || '',
  persistent: process.env.SM_PERSISTENT !== 'off',
  mode: process.env.SM_MODE || 'chat',
  color: process.env.SM_COLOR || '#4F46E5',
  heartbeat: process.env.SM_HEARTBEAT || '',
  log: process.env.SM_LOG || '',
};

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  if (cfg.log) { try { appendFileSync(cfg.log, line); } catch {} }
}
function beat() {
  if (cfg.heartbeat) { try { writeFileSync(cfg.heartbeat, String(Date.now())); } catch {} }
}

let turns = 0;
let stopping = false;

async function respondTo(newMsgs) {
  // Only react to messages from OTHERS that are real chat (not status/system).
  const relevant = newMsgs.filter((m) =>
    m && m.name && m.name !== cfg.name && m.type !== 'system' && (m.text || '').trim());
  if (!relevant.length) return;

  const transcript = relevant.map((m) => `${m.name}: ${m.text}`).join('\n');
  const prompt = [
    `You are "${cfg.name}", a ${cfg.role} participating in a live team chat room with your teammate Waqas and other AI agents.`,
    `You are based in the local workspace: ${cfg.workspace}.`,
    ``,
    `New messages since your last reply:`,
    transcript,
    ``,
    `Reply concisely and usefully AS ${cfg.name}, in the first person, to the room.`,
    `If none of these messages needs a reply from you, output exactly: (no reply)`,
  ].join('\n');

  const resume = turns > 0;
  const { text, code, err } = await invokeModel({
    provider: cfg.provider, model: cfg.model, workspace: cfg.workspace,
    persistent: cfg.persistent, sessionId: cfg.sessionId, resume, mode: cfg.mode, prompt,
  });
  turns += 1;
  const reply = (text || '').trim();
  log(`model turn: code=${code} len=${reply.length} head=${JSON.stringify(reply.slice(0, 100))}${err ? ' err=' + err.slice(0, 160) : ''}`);
  if (!reply || /^\(no reply\)\.?$/i.test(reply)) {
    log(`-> suppressed (empty or no-reply)`);
    return;
  }
  await send({ code: cfg.code, name: cfg.name, text: reply, color: cfg.color, keyfile: cfg.keyfile });
  log(`replied (${reply.length} chars)`);
}

async function main() {
  // model may be empty for codex (means "use the account default model").
  if (!cfg.code || !cfg.name || !cfg.provider || !cfg.workspace || !cfg.keyfile) {
    log('FATAL: missing required SM_* env'); process.exit(2);
  }
  log(`summoned: ${cfg.name} (${cfg.provider}/${cfg.model}) in ${cfg.workspace} -> room ${cfg.code} [mode=${cfg.mode}]`);
  beat();

  await joinMint({ code: cfg.code, name: cfg.name, role: cfg.role, color: cfg.color, keyfile: cfg.keyfile });
  await presence({ code: cfg.code, name: cfg.name, keyfile: cfg.keyfile });

  // Start after the current tail so we only react to messages from now on.
  let cursor = (await messagesSince(cfg.code, 0)).length;

  await send({
    code: cfg.code, name: cfg.name, color: cfg.color, keyfile: cfg.keyfile,
    text: `🟢 ${cfg.name} online — ${cfg.provider}/${cfg.model || 'account-default'}, based in ${cfg.workspace.split('/').pop()}. Ready.`,
  });

  const onStop = async (sig) => {
    if (stopping) return; stopping = true;
    log(`received ${sig}, leaving`);
    try {
      await send({ code: cfg.code, name: cfg.name, color: cfg.color, keyfile: cfg.keyfile,
        text: `🔴 ${cfg.name} dismissed.` });
    } catch {}
    process.exit(0);
  };
  process.on('SIGTERM', () => onStop('SIGTERM'));
  process.on('SIGINT', () => onStop('SIGINT'));

  while (!stopping) {
    try {
      const msgs = await listen(cfg.code, cursor, 240);
      beat();
      if (msgs.length) {
        cursor += msgs.length;
        await respondTo(msgs);
      }
      await presence({ code: cfg.code, name: cfg.name, keyfile: cfg.keyfile });
    } catch (e) {
      log(`loop error: ${String(e).slice(0, 200)}`);
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
}

main().catch((e) => { log(`crash: ${String(e)}`); process.exit(1); });
