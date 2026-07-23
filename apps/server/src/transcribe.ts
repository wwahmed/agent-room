// T-131: server-side speech-to-text so dictation can be BOTH silent and
// continuous. The phone captures raw audio (MediaRecorder) and posts short
// segments here; we transcribe them ourselves and never touch the built-in
// speech engine, so there is no OS "listening" chime and no stop-on-pause.
//
// Engine: local whisper.cpp running as a PERSISTENT server (whisper-server),
// so the ~150 MB model is loaded once and every segment is just inference.
// Spawning `whisper-cli` per segment reloaded the model each time (~8 s);
// whisper-server answers a warm request in well under a second on Apple
// Silicon. ffmpeg transcodes the browser's webm/opus (Android/desktop) or
// mp4/aac (iPhone) segment to the 16 kHz mono WAV whisper wants.
//
// I/O (spawning ffmpeg, HTTP to whisper-server) is thin; the decisions live in
// PURE helpers (ffmpegArgs, parseWhisperText, pickSegmentText) that are
// unit-tested without the engine or audio fixtures.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

export const WHISPER_SERVER_URL = (process.env.AGENT_ROOM_WHISPER_URL || 'http://127.0.0.1:8110').replace(/\/$/, '');

// The chat server runs under launchd with a minimal PATH that does not include
// Homebrew, so `ffmpeg` alone resolves to ENOENT (spawn status null). Resolve
// an absolute path; override with AGENT_ROOM_FFMPEG if it lives elsewhere.
export const FFMPEG_BIN =
  process.env.AGENT_ROOM_FFMPEG ||
  ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'].find((p) => existsSync(p)) ||
  'ffmpeg';

type FetchLike = typeof fetch;

// ffmpeg args to decode ANY container on stdin to 16 kHz mono 16-bit WAV on
// stdout — the exact shape whisper.cpp wants. Pure so it is asserted directly.
export function ffmpegArgs(): string[] {
  return ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-ar', '16000', '-ac', '1', '-f', 'wav', 'pipe:1'];
}

// whisper output carries non-speech markers and stray whitespace/newlines.
// Strip bracketed markers like [BLANK_AUDIO] / (music), collapse whitespace.
export function parseWhisperText(raw: string): string {
  return raw
    .replace(/\[[^\]]*\]/g, ' ') // [BLANK_AUDIO], [Music], ...
    .replace(/\((?:music|inaudible|noise|silence)\)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// A segment is transcribed independently; the client concatenates in order.
// Blank-only results collapse to '' so a silent pause adds nothing.
export function pickSegmentText(raw: string): string {
  return parseWhisperText(raw);
}

export interface EngineStatus {
  ok: boolean;
  url: string;
  reason?: string;
}

// Reachability of the persistent whisper-server. whisper-server answers GET /
// with the demo page (200); anything that connects proves the model host is up.
export async function engineStatus(fetchImpl: FetchLike = fetch): Promise<EngineStatus> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2000);
    const r = await fetchImpl(`${WHISPER_SERVER_URL}/`, { method: 'GET', signal: ctrl.signal }).catch((e) => {
      throw e;
    });
    clearTimeout(t);
    if (r.status >= 500) return { ok: false, url: WHISPER_SERVER_URL, reason: `whisper-server ${r.status}` };
    return { ok: true, url: WHISPER_SERVER_URL };
  } catch {
    return { ok: false, url: WHISPER_SERVER_URL, reason: 'whisper-server unreachable' };
  }
}

export interface TranscribeResult {
  ok: boolean;
  text: string;
  engine: 'whisper-local' | 'none';
  reason?: string;
}

// Transcode + transcribe one audio segment. Returns ok:false (never throws) so
// the caller can 503 and the CLIENT can fall back to the built-in engine or
// buffer locally, rather than losing audio mid-dictation.
export async function transcribeSegment(
  audio: Buffer,
  opts: { runner?: typeof spawnSync; fetchImpl?: FetchLike } = {},
): Promise<TranscribeResult> {
  const runner = opts.runner ?? spawnSync;
  const fetchImpl = opts.fetchImpl ?? fetch;
  if (!audio || audio.length === 0) return { ok: true, text: '', engine: 'whisper-local' };

  // 1) Decode the browser container to 16 kHz mono WAV.
  const wav = runner(FFMPEG_BIN, ffmpegArgs(), { input: audio, maxBuffer: 64 * 1024 * 1024 });
  if (wav.error || wav.status !== 0 || !wav.stdout || wav.stdout.length === 0) {
    const why = wav.error ? (wav.error as NodeJS.ErrnoException).code || wav.error.message : `exit ${wav.status}`;
    return { ok: false, text: '', engine: 'none', reason: `ffmpeg failed (${why})` };
  }

  // 2) Inference on the persistent whisper-server.
  try {
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(wav.stdout)], { type: 'audio/wav' }), 'seg.wav');
    fd.append('response_format', 'json');
    fd.append('temperature', '0');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    const r = await fetchImpl(`${WHISPER_SERVER_URL}/inference`, { method: 'POST', body: fd, signal: ctrl.signal });
    clearTimeout(timer);
    if (!r.ok) return { ok: false, text: '', engine: 'none', reason: `whisper-server ${r.status}` };
    const body = (await r.json()) as { text?: string };
    return { ok: true, text: pickSegmentText(body?.text ?? ''), engine: 'whisper-local' };
  } catch {
    return { ok: false, text: '', engine: 'none', reason: 'whisper-server unreachable' };
  }
}
