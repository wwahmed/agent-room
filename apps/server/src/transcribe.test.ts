import { describe, it, expect } from 'vitest';
import { ffmpegArgs, parseWhisperText, pickSegmentText, engineStatus, transcribeSegment } from './transcribe.js';

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
  it('trims the leading space and newlines whisper-server emits', () => {
    expect(pickSegmentText(' The quick brown fox\n and the lazy dog.\n')).toBe('The quick brown fox and the lazy dog.');
  });
});

describe('engineStatus', () => {
  it('is ok when whisper-server answers', async () => {
    const fetchImpl: any = async () => ({ status: 200 });
    const s = await engineStatus(fetchImpl);
    expect(s.ok).toBe(true);
  });
  it('is not ok when whisper-server is unreachable', async () => {
    const fetchImpl: any = async () => { throw new Error('ECONNREFUSED'); };
    const s = await engineStatus(fetchImpl);
    expect(s.ok).toBe(false);
    expect(s.reason).toMatch(/unreachable/);
  });
  it('is not ok on a 5xx from whisper-server', async () => {
    const fetchImpl: any = async () => ({ status: 503 });
    const s = await engineStatus(fetchImpl);
    expect(s.ok).toBe(false);
  });
});

describe('transcribeSegment', () => {
  const okFfmpeg: any = () => ({ status: 0, stdout: Buffer.from('RIFFfakewav') });
  it('returns empty text for an empty segment without spawning ffmpeg', async () => {
    let spawned = false;
    const runner: any = () => { spawned = true; return { status: 0, stdout: Buffer.from('') }; };
    const r = await transcribeSegment(Buffer.alloc(0), { runner });
    expect(r.ok).toBe(true);
    expect(r.text).toBe('');
    expect(spawned).toBe(false);
  });
  it('degrades to ok:false when ffmpeg fails', async () => {
    const runner: any = () => ({ status: 1, stdout: Buffer.from('') });
    const r = await transcribeSegment(Buffer.from('x'), { runner, fetchImpl: (async () => ({ ok: true, json: async () => ({ text: 'x' }) })) as any });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/ffmpeg/);
  });
  it('degrades to ok:false when whisper-server is unreachable (audio not lost, caller can buffer)', async () => {
    const fetchImpl: any = async () => { throw new Error('ECONNREFUSED'); };
    const r = await transcribeSegment(Buffer.from('x'), { runner: okFfmpeg, fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.engine).toBe('none');
    expect(r.reason).toMatch(/unreachable/);
  });
  it('returns cleaned text on a successful inference', async () => {
    const fetchImpl: any = async () => ({ ok: true, json: async () => ({ text: ' Hello there.\n' }) });
    const r = await transcribeSegment(Buffer.from('x'), { runner: okFfmpeg, fetchImpl });
    expect(r.ok).toBe(true);
    expect(r.engine).toBe('whisper-local');
    expect(r.text).toBe('Hello there.');
  });
  it('degrades to ok:false on a non-2xx from whisper-server', async () => {
    const fetchImpl: any = async () => ({ ok: false, status: 500 });
    const r = await transcribeSegment(Buffer.from('x'), { runner: okFfmpeg, fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/500/);
  });
});
