import type { Call, Device } from "@twilio/voice-sdk";
import { mintVoiceToken } from "./twilio.functions";

/**
 * The npm ESM build of @twilio/voice-sdk breaks under the dev bundler
 * ("Class extends value undefined" — its CommonJS `events` dependency is not
 * initialised). We load the official standalone browser build instead, which
 * exposes window.Twilio.Device and is byte-identical in behaviour.
 */
type DeviceCtor = new (token: string, opts?: Record<string, unknown>) => Device;

let sdkPromise: Promise<DeviceCtor> | null = null;

function loadDeviceCtor(): Promise<DeviceCtor> {
  if (typeof window === "undefined") return Promise.reject(new Error("Voice SDK requires a browser"));
  const existing = (window as unknown as { Twilio?: { Device?: DeviceCtor } }).Twilio?.Device;
  if (existing) return Promise.resolve(existing);
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise<DeviceCtor>((resolve, reject) => {
    const src = "/twilio-voice.min.js";
    let tag = document.querySelector<HTMLScriptElement>(`script[data-twilio-voice]`);
    if (!tag) {
      tag = document.createElement("script");
      tag.src = src;
      tag.async = true;
      tag.dataset.twilioVoice = "true";
      document.head.appendChild(tag);
    }
    const done = () => {
      const ctor = (window as unknown as { Twilio?: { Device?: DeviceCtor } }).Twilio?.Device;
      if (ctor) resolve(ctor);
      else reject(new Error("Twilio Voice SDK failed to load"));
    };
    tag.addEventListener("load", done, { once: true });
    tag.addEventListener(
      "error",
      () => {
        sdkPromise = null;
        reject(new Error("Twilio Voice SDK failed to load"));
      },
      { once: true },
    );
    if ((window as unknown as { Twilio?: { Device?: DeviceCtor } }).Twilio?.Device) done();
  });
  return sdkPromise;
}

export type TwilioCreds = {
  accountSid: string;
  authToken: string;
  apiKeySid: string;
  apiKeySecret: string;
  twimlAppSid: string;
  identity: string;
  callerId: string;
  /** Optional: your own phone, used to bridge calls when browser audio is unavailable. */
  agentPhone?: string;
};


const STORAGE_KEY = "ringly.twilio.creds.v1";

export function loadCreds(): TwilioCreds | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as TwilioCreds;
  } catch {
    return null;
  }
}

export function saveCreds(c: TwilioCreds) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
}

export function credsReadyForVoice(c: Partial<TwilioCreds> | null | undefined): c is TwilioCreds {
  return !!(
    c &&
    c.accountSid?.startsWith("AC") &&
    c.apiKeySid?.startsWith("SK") &&
    c.apiKeySecret &&
    c.twimlAppSid?.startsWith("AP") &&
    c.identity
  );
}

let device: Device | null = null;
let currentCall: Call | null = null;
let identity: string | null = null;

type IncomingPolicy = {
  enabled: boolean;
  /** Non-empty means: forward inbound callers to this number. */
  forwardTo: string;
  onBlocked?: (from: string) => void;
  onForward?: (from: string, to: string) => void;
};

const incomingPolicy: IncomingPolicy = { enabled: true, forwardTo: "" };

/** Update inbound-call handling at runtime (no device restart needed). */
export function setIncomingPolicy(p: Partial<IncomingPolicy>) {
  Object.assign(incomingPolicy, p);
}


type Listener = () => void;
const listeners = new Set<Listener>();

export const twilio = {
  getDevice: () => device,
  getCall: () => currentCall,
  getIdentity: () => identity,
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

function emit() {
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      /* noop */
    }
  });
}

export async function initDevice(c: TwilioCreds) {
  await destroyDevice();
  const { token } = await mintVoiceToken({
    data: {
      accountSid: c.accountSid,
      apiKeySid: c.apiKeySid,
      apiKeySecret: c.apiKeySecret,
      twimlAppSid: c.twimlAppSid,
      identity: c.identity,
    },
  });
  const DeviceCtor = await loadDeviceCtor();
  device = new DeviceCtor(token, {
    logLevel: 1,
    allowIncomingWhileBusy: false,
    edge: ["ashburn", "singapore", "roaming"],
  });
  identity = c.identity;
  device.on("registered", emit);
  device.on("unregistered", emit);
  device.on("error", (e: unknown) => {
    console.error("Twilio Device error", e);
    emit();
  });
  device.on("tokenWillExpire", async () => {
    try {
      const { token: fresh } = await mintVoiceToken({
        data: {
          accountSid: c.accountSid,
          apiKeySid: c.apiKeySid,
          apiKeySecret: c.apiKeySecret,
          twimlAppSid: c.twimlAppSid,
          identity: c.identity,
        },
      });
      device?.updateToken(fresh);
    } catch (err) {
      console.error("Token refresh failed", err);
    }
  });
  device.on("incoming", (call: Call) => {
    // Inbound policy: decline when incoming calls are off, or hand the caller
    // over to the forwarding number instead of ringing the browser.
    if (!incomingPolicy.enabled) {
      try { call.reject(); } catch { /* noop */ }
      incomingPolicy.onBlocked?.(String(call.parameters?.From ?? ""));
      return;
    }
    if (incomingPolicy.forwardTo) {
      try { call.reject(); } catch { /* noop */ }
      incomingPolicy.onForward?.(String(call.parameters?.From ?? ""), incomingPolicy.forwardTo);
      return;
    }
    currentCall = call;
    wireCallEvents(call);
    emit();
  });

  await device.register();
  emit();
  return device;
}

export async function destroyDevice() {
  try {
    currentCall?.disconnect();
  } catch {
    /* noop */
  }
  currentCall = null;
  try {
    device?.destroy();
  } catch {
    /* noop */
  }
  device = null;
  identity = null;
  emit();
}

function wireCallEvents(call: Call) {
  call.on("accept", emit);
  call.on("disconnect", () => {
    currentCall = null;
    emit();
  });
  call.on("cancel", () => {
    currentCall = null;
    emit();
  });
  call.on("reject", () => {
    currentCall = null;
    emit();
  });
  call.on("error", (e) => {
    console.error("Twilio Call error", e);
    emit();
  });
}

export async function placeCall(number: string, callerId: string) {
  if (!device) throw new Error("Twilio device not initialized. Save credentials first.");
  const call = await device.connect({ params: { To: number, CallerId: callerId } });
  currentCall = call;
  wireCallEvents(call);
  emit();
  return call;
}

export function hangup() {
  try {
    currentCall?.disconnect();
  } catch {
    /* noop */
  }
}

export function setMuted(m: boolean) {
  try {
    currentCall?.mute(m);
  } catch {
    /* noop */
  }
}

export function sendDtmf(digit: string) {
  try {
    currentCall?.sendDigits(digit);
  } catch {
    /* noop */
  }
}

export function acceptIncoming() {
  try {
    currentCall?.accept();
  } catch {
    /* noop */
  }
}

export function rejectIncoming() {
  try {
    currentCall?.reject();
  } catch {
    /* noop */
  }
}
