// T-131: with the built-in speech engine gone, there is no OS "listening"
// chime at all. Waqas asked for a subtle app-played cue at the START of
// recording (mic-live confirmation) and at SEND — and nothing in between. These
// are short WebAudio tones we fully control, so they are quiet by design and
// never fire mid-recording.

let ctx: AudioContext | null = null;
function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
    || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  return ctx;
}

// A short, soft sine blip. gain stays low so it is a cue, not an alert.
function blip(freq: number, durationMs: number, peak = 0.05): void {
  const ac = audioContext();
  if (!ac) return;
  // Autoplay policy: a user gesture (the record/send tap) precedes every call,
  // so resuming here is allowed and needed after the tab was backgrounded.
  if (ac.state === 'suspended') void ac.resume().catch(() => {});
  const now = ac.currentTime;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, now);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(peak, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
  osc.connect(gain).connect(ac.destination);
  osc.start(now);
  osc.stop(now + durationMs / 1000 + 0.02);
}

/** Mic-live confirmation at the start of recording (rising two-note). */
export function playStartCue(): void {
  blip(660, 90);
  setTimeout(() => blip(880, 110), 90);
}

/** Sent confirmation (single soft note). */
export function playSendCue(): void {
  blip(720, 120, 0.045);
}
