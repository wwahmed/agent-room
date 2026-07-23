// T-139: play text through the room's local TTS (/api/tts, macOS `say` + ffmpeg).
// One playback at a time — a new speakText stops the previous clip — so /brief
// audio and a card's 🔊 replay never overlap. Reused by the brief runner and the
// EXECUTIVE BRIEF card.

let current: HTMLAudioElement | null = null;

export function stopSpeaking(): void {
  if (current) { current.pause(); current = null; }
}

export function isSpeaking(): boolean {
  return current !== null;
}

/** Fetch synthesized audio for `text` and play it. Rejects on a TTS failure so
 *  the caller can surface "audio unavailable" without blocking the text brief. */
export async function speakText(text: string): Promise<void> {
  stopSpeaking();
  const r = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
    credentials: 'same-origin',
  });
  if (!r.ok) throw new Error(`tts ${r.status}`);
  const url = URL.createObjectURL(await r.blob());
  const audio = new Audio(url);
  current = audio;
  audio.onended = () => { URL.revokeObjectURL(url); if (current === audio) current = null; };
  await audio.play();
}
