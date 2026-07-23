// T-139: run a /brief command. Fetch the server-composed brief (honest by
// construction — see packages/shared/briefProtocol), post it to the room as an
// EXECUTIVE BRIEF card, and speak it for the audio variant. Server-side is the
// reliable floor: it always answers, even when no agent is listening.

import type { Message } from '@agent-room/shared';
import { appendSystemMessage, createClient } from './api.js';
import { speakText } from './speak.js';
import type { BriefCommand } from './briefCommand.js';

interface BriefPayload { display: string; speech: string }

export interface RunBriefResult { posted: boolean; spoke: boolean; error?: string }

export async function runBrief(code: string, selfName: string, cmd: BriefCommand): Promise<RunBriefResult> {
  const params = new URLSearchParams({ code, self: selfName });
  if (cmd.mode === 'deep') params.set('mode', 'deep');
  if (cmd.topic) params.set('topic', cmd.topic);

  let brief: BriefPayload;
  try {
    const r = await fetch(`/api/brief?${params.toString()}`, { credentials: 'same-origin' });
    if (!r.ok) return { posted: false, spoke: false, error: r.status === 401 ? 'Sign in to get a brief.' : `Brief failed (${r.status}).` };
    const body = (await r.json()) as { brief?: BriefPayload };
    if (!body.brief || !body.brief.display) return { posted: false, spoke: false, error: 'The brief came back empty.' };
    brief = body.brief;
  } catch {
    return { posted: false, spoke: false, error: 'Could not reach the brief service.' };
  }

  const scope = cmd.mode === 'deep' ? 'deep' : cmd.topic ? `topic:${cmd.topic}` : undefined;
  const nowMs = Date.now();
  const msg: Message = {
    id: nowMs,
    type: 'sys',
    name: 'Executive Brief',
    role: '',
    initials: 'EB',
    color: '#0EA5E9',
    client: 'web',
    text: brief.display,
    time: nowMs,
    metadata: { brief: true, briefSpeech: brief.speech, briefScope: scope },
  };
  try {
    await appendSystemMessage(createClient(), code, msg);
  } catch {
    return { posted: false, spoke: false, error: 'Could not post the brief.' };
  }

  let spoke = false;
  if (cmd.withAudio && brief.speech) {
    try { await speakText(brief.speech); spoke = true; } catch { /* audio is best-effort; the text brief already landed */ }
  }
  return { posted: true, spoke };
}
