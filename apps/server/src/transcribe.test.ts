import { describe, it, expect } from 'vitest';
import {
  resolveModelPath,
  ffmpegArgs,
  parseWhisperText,
  pickSegmentText,
  engineStatus,
  transcribeSegment,
} from './transcribe.js';

describe('resolveModelPath', () => {
  it('prefers the explicit env path when it exists', () => {
    expect(resolveModelPath('/models/custom.bin', (p) => p === '/models/custom.bin')).toBe('/models/custom.bin');
  });
  it('falls back to a known location when env is unset', () => {
    const hb = '/opt/homebrew/share/whisper-cpp/ggml-base.en.bin';
    expect(resolveModelPath(undefined, (p) => p === hb)).toBe(hb);
  });
  it('returns null when no candidate exists', () => {
    expect(resolveModelPath('/nope.bin', () => false)).toBeNull();
  });
});

describe('ffmpegArgs', () => {
  it('decodes stdin to 16 kHz mono wav on stdout', () => {
    const a = ffmpegArgs();
    expect(a).toContain('pipe:0');
    expect(a).toContain('pipe:1');
    expect(a.join(' ')).toContain('-ar 16000');
    expect(a.join(' ')).toContain('-ac 1');
    expect(a.join(' ')).toContain('-f wav');
  });
});

describe('parseWhisperText', () => {
  it('strips bracketed non-speech markers and collapses whitespace', () => {
    expect(parseWhisperText('  [BLANK_AUDIO]  hello   there [Music] ')).toBe('hello there');
  });
  it('strips parenthetical noise markers', () => {
    expect(parseWhisperText('okay (music) go')).toBe('okay go');
  });
  it('returns empty for marker-only output (a silent pause adds nothing)', () => {
    expect(pickSegmentText('[BLANK_AUDIO]')).toBe('');
  });
});

describe('engineStatus', () => {
  it('reports unavailable when the binary is missing (ENOENT)', () => {
    const runner: any = () => ({ error: Object.assign(new Error('nope'), { code: 'ENOENT' }) });
    const s = engineStatus({ runner, existsFn: () => true, modelEnv: '/m.bin' });
    expect(s.ok).toBe(false);
    expect(s.reason).toMatch(/not installed/);
  });
  it('reports unavailable when no model is found even if the binary runs', () => {
    const runner: any = () => ({ status: 0, stdout: 'usage', error: undefined });
    const s = engineStatus({ runner, existsFn: () => false });
    expect(s.ok).toBe(false);
    expect(s.reason).toMatch(/no whisper model/);
  });
  it('reports ok when binary runs and a model exists', () => {
    const runner: any = () => ({ status: 0, stdout: 'usage', error: undefined });
    const s = engineStatus({ runner, existsFn: () => true, modelEnv: '/m.bin' });
    expect(s.ok).toBe(true);
    expect(s.model).toBe('/m.bin');
  });
});

describe('transcribeSegment', () => {
  it('degrades to ok:false (never throws) when the engine is unavailable', async () => {
    const r = await transcribeSegment(Buffer.from('x'), {
      status: { ok: false, bin: 'whisper-cli', model: null, reason: 'no whisper model found' },
    });
    expect(r.ok).toBe(false);
    expect(r.engine).toBe('none');
    expect(r.reason).toMatch(/no whisper model/);
  });
  it('returns empty text for an empty segment without spawning anything', async () => {
    let spawned = false;
    const runner: any = () => { spawned = true; return { status: 0, stdout: Buffer.from('') }; };
    const r = await transcribeSegment(Buffer.alloc(0), {
      runner,
      status: { ok: true, bin: 'whisper-cli', model: '/m.bin' },
    });
    expect(r.ok).toBe(true);
    expect(r.text).toBe('');
    expect(spawned).toBe(false);
  });
});
