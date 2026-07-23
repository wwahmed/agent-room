// T-134: local text-to-speech for the owner brief's speaker playback. The
// mirror image of the whisper STT: macOS `say` is already on the host, so this
// needs no API key, no per-minute cost, and the audio never leaves our server —
// the same self-hosted ethos as dictation. `say` renders AIFF; ffmpeg transcodes
// to mp3 for broad browser <audio> support.
//
// Process I/O is thin; the decisions live in a PURE sanitizer that is
// unit-tested without invoking `say` or ffmpeg.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FFMPEG_BIN } from './transcribe.js';

export const SAY_BIN = process.env.AGENT_ROOM_SAY_BIN || (existsSync('/usr/bin/say') ? '/usr/bin/say' : 'say');
export const TTS_MAX_CHARS = 1500;

// The brief is short by design; cap hard, strip control chars, collapse
// whitespace. Passed to `say` as a single argv element (no shell), so this is
// about bounding size and cleaning output, not shell-escaping.
export function sanitizeTtsText(text: string): string {
  return (text || '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, ' ') // strip ASCII control chars
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TTS_MAX_CHARS);
}

export function ttsAvailable(runner = spawnSync): boolean {
  try {
    const probe = runner(SAY_BIN, ['-o', '/dev/null', ''], { timeout: 4000 });
    return !(probe.error && (probe.error as NodeJS.ErrnoException).code === 'ENOENT');
  } catch {
    return false;
  }
}

export interface TtsResult { ok: boolean; audio?: Buffer; mime?: string; reason?: string }

export async function synthesize(text: string, opts: { runner?: typeof spawnSync } = {}): Promise<TtsResult> {
  const runner = opts.runner ?? spawnSync;
  const clean = sanitizeTtsText(text);
  if (!clean) return { ok: false, reason: 'empty text' };
  const dir = mkdtempSync(join(tmpdir(), 'artts-'));
  try {
    const aiff = join(dir, 'v.aiff');
    const say = runner(SAY_BIN, ['-o', aiff, clean], { timeout: 20000 });
    if (say.error || say.status !== 0 || !existsSync(aiff)) {
      const why = say.error ? (say.error as NodeJS.ErrnoException).code || say.error.message : `exit ${say.status}`;
      return { ok: false, reason: `say failed (${why})` };
    }
    const mp3 = runner(FFMPEG_BIN, ['-hide_banner', '-loglevel', 'error', '-i', aiff, '-codec:a', 'libmp3lame', '-qscale:a', '5', '-f', 'mp3', 'pipe:1'], { maxBuffer: 32 * 1024 * 1024 });
    if (mp3.error || mp3.status !== 0 || !mp3.stdout || mp3.stdout.length === 0) {
      const why = mp3.error ? (mp3.error as NodeJS.ErrnoException).code || mp3.error.message : `exit ${mp3.status}`;
      return { ok: false, reason: `ffmpeg failed (${why})` };
    }
    // spawnSync stdout is a Buffer here (no 'encoding' passed).
    return { ok: true, audio: mp3.stdout as unknown as Buffer, mime: 'audio/mpeg' };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
