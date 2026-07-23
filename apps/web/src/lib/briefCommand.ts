// T-139: recognize the /brief command family typed in the composer. Returns the
// parsed intent, or null when the text is an ordinary message. Kept pure and
// separately tested so the composer just branches on the result.

export interface BriefCommand {
  withAudio: boolean;
  mode: 'default' | 'deep';
  /** A /brief <topic> scope, or null for the whole room. */
  topic: string | null;
}

// Natural-language equivalents the owner might type instead of the slash form.
const NL_TRIGGERS = [
  'brief me',
  'catch me up',
  'what did i miss',
  "what's new",
  'whats new',
  '进度', // "progress"
  '简报', // "brief"
];

/**
 * Parse a composer submission into a brief command.
 *  - `/brief` and `/brief-with-audio` (also `/brief with audio`, `/brief aloud`)
 *  - `/brief deep` for the expanded form
 *  - `/brief <topic>` to scope to one workstream
 *  - natural-language triggers (text only, no audio)
 */
export function parseBriefCommand(raw: string): BriefCommand | null {
  const text = raw.trim();
  const lower = text.toLowerCase();

  // Only the command word itself — "/brief", "/brief-...", "/brief ..." — never
  // an unrelated word like "/briefing".
  if (/^\/brief(?=$|\s|-)/i.test(lower)) {
    // Everything after the command word, e.g. "-with-audio deep payments".
    let rest = text.slice('/brief'.length);
    let withAudio = false;
    // Accept -with-audio, "with audio", "aloud", "audio", "speak", 🔊.
    const audioMatch = rest.match(/^\s*(?:-with-audio|with[-\s]audio|aloud|audio|speak(?:ing)?)\b/i);
    if (audioMatch) { withAudio = true; rest = rest.slice(audioMatch[0].length); }
    rest = rest.trim();
    let mode: 'default' | 'deep' = 'default';
    if (/^deep\b/i.test(rest)) { mode = 'deep'; rest = rest.replace(/^deep\b/i, '').trim(); }
    const topic = rest.length > 0 ? rest : null;
    return { withAudio, mode, topic };
  }

  // Natural language: only when the message IS the trigger (not merely contains
  // it), so a sentence quoting "catch me up" is not hijacked.
  const stripped = lower.replace(/[!.?？！。]+$/g, '').trim();
  if (NL_TRIGGERS.includes(stripped)) {
    const withAudio = /\baloud\b|read.*aloud|speak/i.test(lower);
    return { withAudio, mode: 'default', topic: null };
  }
  return null;
}
