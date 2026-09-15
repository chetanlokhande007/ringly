/**
 * Local (per-browser) preferences for inbound call handling and redial.
 * Kept out of the Twilio credential blob so it can be toggled freely.
 */
export type CallSettings = {
  /** When false, inbound calls are declined automatically. */
  incomingEnabled: boolean;
  /** When true, inbound calls are bridged to `forwardTo` instead of ringing here. */
  forwardingEnabled: boolean;
  /** Destination for temporary call forwarding (E.164). */
  forwardTo: string;
  /** Last successfully dialled number, used by the redial button. */
  lastDialed: string;
};

const KEY = "ringly.call.settings.v1";

export const defaultCallSettings: CallSettings = {
  incomingEnabled: true,
  forwardingEnabled: false,
  forwardTo: "+919145050514",
  lastDialed: "",
};

export function loadCallSettings(): CallSettings {
  if (typeof window === "undefined") return defaultCallSettings;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return defaultCallSettings;
    return { ...defaultCallSettings, ...(JSON.parse(raw) as Partial<CallSettings>) };
  } catch {
    return defaultCallSettings;
  }
}

export function saveCallSettings(s: CallSettings) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* noop */
  }
}

const COUNTRY_KEY = "ringly.dialpad.country.v1";

/** Remembers the last country picked on the dialpad across calls/sessions. */
export function loadDialCountryIso(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(COUNTRY_KEY);
  } catch {
    return null;
  }
}

export function saveDialCountryIso(iso: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(COUNTRY_KEY, iso);
  } catch {
    /* noop */
  }
}

const DRAFT_KEY = "ringly.dialpad.draft.v1";

/** Keeps the typed number on the dialpad across calls/screens until changed. */
export function loadDialDraft(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(DRAFT_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveDialDraft(value: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DRAFT_KEY, value);
  } catch {
    /* noop */
  }
}
