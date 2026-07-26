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

// Levels (host-tuned, 2026-07-25): the first pass was so subtle it vanished in
// a normal room. Waqas asked for "slightly more noticeable" — so the ready and
// send cues are now two-note figures at roughly double the old peak, which
// reads clearly without becoming an alert. Melodic direction encodes meaning:
// rising = recording is live, falling = message went out.

/** Warming up: faint, quick dots while the mic is being acquired — a
 *  responsive "hang on, getting ready" tick, not a chime. */
export function playWarmingCue(): void {
  blip(520, 40, 0.035);
  setTimeout(() => blip(520, 40, 0.035), 105);
  setTimeout(() => blip(520, 40, 0.035), 210);
}

/** Recording live: a rising two-note chime — "recording now". */
export function playReadyCue(): void {
  blip(660, 140, 0.11);
  setTimeout(() => blip(880, 220, 0.11), 120);
}

/** Sent confirmation: a falling two-note figure — "message went out". */
export function playSendCue(): void {
  blip(880, 100, 0.09);
  setTimeout(() => blip(660, 160, 0.09), 95);
}
