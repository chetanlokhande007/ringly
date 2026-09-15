/**
 * Local DTMF key-press feedback (Web Audio).
 * Purely an audible cue in the browser — it never touches the Twilio call
 * media path. Sending real DTMF to the far end still goes through
 * `sendDtmf()` in twilio-client.ts.
 */

const FREQS: Record<string, [number, number]> = {
  "1": [697, 1209], "2": [697, 1336], "3": [697, 1477],
  "4": [770, 1209], "5": [770, 1336], "6": [770, 1477],
  "7": [852, 1209], "8": [852, 1336], "9": [852, 1477],
  "*": [941, 1209], "0": [941, 1336], "#": [941, 1477],
  "+": [941, 1336],
};

let ctx: AudioContext | null = null;
let enabled = true;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor: typeof AudioContext | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Turn the local key-press tones on/off (e.g. from settings). */
export function setToneEnabled(v: boolean) {
  enabled = v;
}

export function isToneEnabled() {
  return enabled;
}

/** Play a short dual-tone beep for a dialpad key. Safe to call anywhere. */
export function playDtmfTone(key: string, durationMs = 120) {
  if (!enabled) return;
  const pair = FREQS[key];
  if (!pair) return;
  try {
    const audio = getCtx();
    if (!audio) return;
    const now = audio.currentTime;
    const gain = audio.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
    gain.connect(audio.destination);

    for (const f of pair) {
      const osc = audio.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(f, now);
      osc.connect(gain);
      osc.start(now);
      osc.stop(now + durationMs / 1000 + 0.02);
    }
  } catch {
    /* audio unavailable — silent fallback */
  }
}

/** Short error/invalid beep used when a dial attempt can't proceed. */
export function playErrorTone() {
  if (!enabled) return;
  try {
    const audio = getCtx();
    if (!audio) return;
    const now = audio.currentTime;
    const gain = audio.createGain();
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    gain.connect(audio.destination);
    const osc = audio.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.setValueAtTime(360, now + 0.18);
    osc.connect(gain);
    osc.start(now);
    osc.stop(now + 0.37);
  } catch {
    /* noop */
  }
}
