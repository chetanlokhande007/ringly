import { createServerFn } from "@tanstack/react-start";
import jwt from "jsonwebtoken";

type Creds = {
  accountSid: string;
  authToken: string;
};

type VoiceInput = {
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  twimlAppSid: string;
  identity: string;
  ttl?: number;
};

/**
 * Mint a Twilio Voice Access Token (JWT) on the server using the user's
 * API Key SID + Secret. Never exposes secrets to the browser bundle:
 * secrets are sent per-request from localStorage and used only in the handler.
 */
export const mintVoiceToken = createServerFn({ method: "POST" })
  .inputValidator((data: VoiceInput) => {
    if (!data || typeof data !== "object") throw new Error("Invalid input");
    const req = ["accountSid", "apiKeySid", "apiKeySecret", "twimlAppSid", "identity"] as const;
    for (const k of req) {
      if (!data[k] || typeof data[k] !== "string") throw new Error(`Missing ${k}`);
    }
    return data;
  })
  .handler(async ({ data }) => {
    const now = Math.floor(Date.now() / 1000);
    const ttl = Math.min(Math.max(data.ttl ?? 3600, 60), 24 * 3600);
    const token = jwt.sign(
      {
        jti: `${data.apiKeySid}-${now}`,
        grants: {
          identity: data.identity,
          voice: {
            incoming: { allow: true },
            outgoing: { application_sid: data.twimlAppSid },
          },
        },
      },
      data.apiKeySecret,
      {
        algorithm: "HS256",
        issuer: data.apiKeySid,
        subject: data.accountSid,
        expiresIn: ttl,
        header: { alg: "HS256", typ: "JWT", cty: "twilio-fpa;v=1" },
      },
    );
    return { token, identity: data.identity, expiresAt: now + ttl };
  });

/**
 * Non-secret, server-configured defaults (environment / appsettings / DB).
 * Secrets (auth token, API key secret) are never returned to the client.
 */
export const getTwilioDefaults = createServerFn({ method: "GET" }).handler(async () => {
  return {
    accountSid: process.env.TWILIO_ACCOUNT_SID ?? "",
    apiKeySid: process.env.TWILIO_API_KEY_SID ?? "",
    twimlAppSid: process.env.TWILIO_TWIML_APP_SID ?? "",
    identity: process.env.TWILIO_IDENTITY ?? "",
    callerId: process.env.TWILIO_CALLER_ID ?? "",
    hasServerAuthToken: Boolean((process.env.TWILIO_REST_AUTH_TOKEN || process.env.TWILIO_AUTH_TOKEN)),
  };
});

/** Verify credentials by fetching the account resource. */
export const testConnection = createServerFn({ method: "POST" })
  .inputValidator((data: Partial<Creds>) => data ?? {})
  .handler(async ({ data }) => {
    const accountSid = data.accountSid || process.env.TWILIO_ACCOUNT_SID || "";
    const authToken = data.authToken || (process.env.TWILIO_REST_AUTH_TOKEN || process.env.TWILIO_AUTH_TOKEN) || "";
    if (!accountSid || !authToken) return { ok: false as const, status: 400, error: "Missing credentials" };
    const auth = btoa(`${accountSid}:${authToken}`);
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}.json`,
      { headers: { Authorization: `Basic ${auth}` } },
    );
    if (!res.ok) {
      const body = await res.text();
      return { ok: false as const, status: res.status, error: body.slice(0, 400) };
    }
    const json = (await res.json()) as { friendly_name?: string; status?: string; type?: string };
    return {
      ok: true as const,
      friendlyName: json.friendly_name ?? "",
      status: json.status ?? "",
      type: json.type ?? "",
    };
  });

type SmsInput = Partial<Creds> & { from: string; to: string; body: string };

/** Send an SMS via Twilio REST. */
export const sendSms = createServerFn({ method: "POST" })
  .inputValidator((data: SmsInput) => {
    for (const k of ["from", "to", "body"] as const) {
      if (!data?.[k] || typeof data[k] !== "string") throw new Error(`Missing ${k}`);
    }
    if (data.body.length > 1600) throw new Error("Message too long");
    return data;
  })
  .handler(async ({ data }) => {
    const accountSid = data.accountSid || process.env.TWILIO_ACCOUNT_SID || "";
    const authToken = data.authToken || (process.env.TWILIO_REST_AUTH_TOKEN || process.env.TWILIO_AUTH_TOKEN) || "";
    if (!accountSid || !authToken) {
      return { ok: false as const, status: 400, code: null, message: "Missing Twilio credentials" };
    }
    const auth = btoa(`${accountSid}:${authToken}`);
    const form = new URLSearchParams({ To: data.to, From: data.from, Body: data.body });
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      },
    );
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false as const,
        status: res.status,
        code: json.code ?? null,
        message: (json.message as string) ?? "Twilio error",
      };
    }
    return {
      ok: true as const,
      sid: json.sid as string,
      status: json.status as string,
      to: json.to as string,
      from: json.from as string,
      body: json.body as string,
    };
  });

type RestCallInput = Partial<Creds> & { to: string; from?: string; agentPhone?: string };

/**
 * Place an outbound PSTN bridge call: rings the agent's own phone first, then
 * dials the destination. Only used when browser Voice is unavailable.
 * The TwiML callback always targets the stable public app URL — preview
 * origins redirect (302) and make Twilio play "an application error occurred".
 */
export const placeRestCall = createServerFn({ method: "POST" })
  .inputValidator((data: RestCallInput) => {
    if (!data?.to || typeof data.to !== "string") throw new Error("Missing destination number");
    return data;
  })
  .handler(async ({ data }) => {
    const base =
      process.env.TWILIO_PUBLIC_BASE_URL ||
      "https://project--b9899d10-afab-4608-acf5-852d855dbbcb-dev.lovable.app";
    const accountSid = data.accountSid || process.env.TWILIO_ACCOUNT_SID || "";
    const authToken =
      data.authToken || process.env.TWILIO_REST_AUTH_TOKEN || process.env.TWILIO_AUTH_TOKEN || "";
    const from = data.from || process.env.TWILIO_CALLER_ID || "";
    const agentPhone = data.agentPhone || "";
    if (!accountSid || !authToken) {
      return { ok: false as const, status: 400, message: "Missing Twilio credentials" };
    }
    if (!from) {
      return { ok: false as const, status: 400, message: "Missing caller ID (your Twilio number)" };
    }
    if (!agentPhone) {
      return {
        ok: false as const,
        status: 400,
        message:
          "Browser calling isn't ready and no agent phone is set. Add your own phone number in Twilio settings to bridge calls.",
      };
    }
    const twimlUrl = `${base}/api/public/twilio/voice?To=${encodeURIComponent(data.to)}&CallerId=${encodeURIComponent(from)}`;
    const auth = btoa(`${accountSid}:${authToken}`);
    const form = new URLSearchParams({ To: agentPhone, From: from, Url: twimlUrl, Method: "GET" });
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Calls.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      },
    );
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false as const,
        status: res.status,
        message: (json.message as string) ?? "Twilio call failed",
      };
    }
    return { ok: true as const, sid: json.sid as string, status: json.status as string };
  });

type ProvisionInput = Partial<Creds>;

/**
 * Create (or reuse) the API Key + TwiML App required for browser Voice.
 * The API Key secret is only returned by Twilio at creation time, so a new
 * key is minted each time this runs; the TwiML App is reused by name and its
 * Voice URL is always repointed at the stable public TwiML endpoint.
 */
export const provisionVoice = createServerFn({ method: "POST" })
  .inputValidator((data: ProvisionInput) => data ?? {})
  .handler(async ({ data }) => {
    const base =
      process.env.TWILIO_PUBLIC_BASE_URL ||
      "https://project--b9899d10-afab-4608-acf5-852d855dbbcb-dev.lovable.app";
    const accountSid = data.accountSid || process.env.TWILIO_ACCOUNT_SID || "";
    const authToken =
      data.authToken || process.env.TWILIO_REST_AUTH_TOKEN || process.env.TWILIO_AUTH_TOKEN || "";
    if (!accountSid || !authToken) {
      return { ok: false as const, message: "Missing Twilio Account SID or Auth Token" };
    }
    const auth = btoa(`${accountSid}:${authToken}`);
    const root = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}`;
    const voiceUrl = `${base}/api/public/twilio/voice`;
    const call = async (path: string, body?: Record<string, string>) => {
      const res = await fetch(`${root}${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: `Basic ${auth}`,
          ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        },
        body: body ? new URLSearchParams(body).toString() : undefined,
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error((json.message as string) || `Twilio error ${res.status}`);
      return json;
    };

    try {
      const key = await call("/Keys.json", { FriendlyName: "Ringly Softphone" });
      const apiKeySid = key.sid as string;
      const apiKeySecret = key.secret as string;

      const list = (await call("/Applications.json?FriendlyName=Ringly%20Softphone")) as {
        applications?: Array<{ sid: string }>;
      };
      const existing = list.applications?.[0]?.sid;
      const app = existing
        ? await call(`/Applications/${existing}.json`, {
            VoiceUrl: voiceUrl,
            VoiceMethod: "POST",
          })
        : await call("/Applications.json", {
            FriendlyName: "Ringly Softphone",
            VoiceUrl: voiceUrl,
            VoiceMethod: "POST",
          });

      return {
        ok: true as const,
        apiKeySid,
        apiKeySecret,
        twimlAppSid: app.sid as string,
        voiceUrl,
      };
    } catch (e) {
      return { ok: false as const, message: e instanceof Error ? e.message : "Provisioning failed" };
    }
  });

