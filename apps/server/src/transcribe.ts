// T-131: server-side speech-to-text so dictation can be BOTH silent and
// continuous. The phone captures raw audio (MediaRecorder) and posts short
// segments here; we transcribe them ourselves and never touch the built-in
// speech engine, so there is no OS "listening" chime and no stop-on-pause.
//
// Engine: local whisper.cpp (the `whisper-cli` binary + a ggml model). No API
// key, no per-minute cost, self-contained on the host. ffmpeg transcodes the
// browser's webm/opus segment to the 16 kHz mono WAV whisper expects.
//
// This module keeps the process-spawning I/O thin and pushes every decision
// into PURE helpers (resolveModelPath, ffmpegArgs, parseWhisperText,
// pickSegmentText) so the transcription logic is unit-tested without needing
// the engine or audio fixtures installed.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const WHISPER_BIN = process.env.AGENT_ROOM_WHISPER_BIN || 'whisper-cli';

// Model lookup order: explicit env, then the common homebrew/user cache spots.
// Kept pure (existsFn injected) so tests can drive every branch deterministically.
export function resolveModelPath(
  env: string | undefined,
  existsFn: (p: string) => boolean = existsSync,
): string | null {
  const candidates = [
    env,
    join(process.env.HOME || '', '.cache', 'whisper', 'ggml-base.en.bin'),
    '/opt/homebrew/share/whisper-cpp/ggml-base.en.bin',
    '/opt/homebrew/share/whisper.cpp/models/ggml-base.en.bin',
    '/usr/local/share/whisper-cpp/ggml-base.en.bin',
  ].filter((c): c is string => typeof c === 'string' && c.length > 0);
  for (const c of candidates) if (existsFn(c)) return c;
  return null;
}

// True when a runnable binary is found on PATH (or as an absolute path).
export function binaryAvailable(bin: string = WHISPER_BIN, runner = spawnSync): boolean {
  try {
    const probe = runner(bin, ['--help'], { encoding: 'utf8', timeout: 4000 });
    // whisper-cli exits non-zero for --help on some builds but still runs;
    // the reliable signal is that the process spawned at all (no ENOENT).
    return !(probe.error && (probe.error as NodeJS.ErrnoException).code === 'ENOENT');
  } catch {
    return false;
  }
}

export interface EngineStatus {
  ok: boolean;
  bin: string;
  model: string | null;
  reason?: string;
}

export function engineStatus(
  opts: { modelEnv?: string; existsFn?: (p: string) => boolean; runner?: typeof spawnSync } = {},
): EngineStatus {
  const bin = WHISPER_BIN;
  const model = resolveModelPath(opts.modelEnv ?? process.env.AGENT_ROOM_WHISPER_MODEL, opts.existsFn);
  if (!binaryAvailable(bin, opts.runner)) {
    return { ok: false, bin, model, reason: 'whisper-cli not installed' };
  }
  if (!model) return { ok: false, bin, model: null, reason: 'no whisper model found' };
  return { ok: true, bin, model };
}

// ffmpeg args to decode ANY container on stdin to 16 kHz mono 16-bit WAV on
// stdout — the exact shape whisper.cpp wants. Pure so it is asserted directly.
export function ffmpegArgs(): string[] {
  return ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-ar', '16000', '-ac', '1', '-f', 'wav', 'pipe:1'];
}

// whisper.cpp text output carries non-speech markers and stray whitespace.
// Strip bracketed markers like [BLANK_AUDIO] / (music), collapse whitespace.
export function parseWhisperText(raw: string): string {
  return raw
    .replace(/\[[^\]]*\]/g, ' ') // [BLANK_AUDIO], [Music], ...
    .replace(/\((?:music|inaudible|noise|silence)\)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// A segment is transcribed independently; the client concatenates segments in
// order. Empty/blank-only results collapse to '' so a pause adds nothing.
export function pickSegmentText(raw: string): string {
  const t = parseWhisperText(raw);
  return t;
}

export interface TranscribeResult {
  ok: boolean;
  text: string;
  engine: 'whisper-local' | 'none';
  reason?: string;
}

// Transcode + transcribe one audio segment. Returns ok:false (never throws) so
// the caller can fall the CLIENT back to the built-in engine when the local
// engine is unavailable, rather than 500-ing mid-dictation.
export async function transcribeSegment(
  audio: Buffer,
  opts: { runner?: typeof spawnSync; status?: EngineStatus } = {},
): Promise<TranscribeResult> {
  const runner = opts.runner ?? spawnSync;
  const status = opts.status ?? engineStatus();
  if (!status.ok || !status.model) {
    return { ok: false, text: '', engine: 'none', reason: status.reason || 'engine unavailable' };
  }
  if (!audio || audio.length === 0) return { ok: true, text: '', engine: 'whisper-local' };

  const dir = mkdtempSync(join(tmpdir(), 'arstt-'));
  try {
    const wav = runner('ffmpeg', ffmpegArgs(), { input: audio, maxBuffer: 64 * 1024 * 1024 });
    if (wav.status !== 0 || !wav.stdout || wav.stdout.length === 0) {
      return { ok: false, text: '', engine: 'none', reason: `ffmpeg failed (${wav.status})` };
    }
    const wavPath = join(dir, 'seg.wav');
    writeFileSync(wavPath, wav.stdout);
    // -nt: no timestamps; -otxt: write <wav>.txt; read that back for the text.
    const w = runner(status.bin, ['-m', status.model, '-f', wavPath, '-nt', '-otxt'], {
      encoding: 'buffer',
      timeout: 30000,
    });
    if (w.status !== 0) {
      // whisper writes text to stdout too; try that before declaring failure.
      const stdoutText = w.stdout ? w.stdout.toString('utf8') : '';
      if (stdoutText.trim()) return { ok: true, text: pickSegmentText(stdoutText), engine: 'whisper-local' };
      return { ok: false, text: '', engine: 'none', reason: `whisper failed (${w.status})` };
    }
    let text = '';
    const txtPath = `${wavPath}.txt`;
    if (existsSync(txtPath)) text = readFileSync(txtPath, 'utf8');
    else if (w.stdout) text = w.stdout.toString('utf8');
    return { ok: true, text: pickSegmentText(text), engine: 'whisper-local' };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
