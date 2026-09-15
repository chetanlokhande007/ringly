/**
 * SPA build replacement for `twilio.functions.ts` (TanStack server functions).
 * Exposes the identical call signatures — `fn({ data })` — but talks to the
 * ASP.NET Core API hosted on the same domain. Aliased in vite.spa.config.ts,
 * so no application code changes.
 */

async function post<T>(path: string, data: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data ?? {}),
  });
  return (await res.json()) as T;
}

type Opt<T> = { data: T } | undefined;

export const mintVoiceToken = (o: Opt<Record<string, unknown>>) =>
  post<{ token: string; identity: string; expiresAt: number }>("/api/twilio/token", o?.data);

export const getTwilioDefaults = async () =>
  (await fetch("/api/twilio/defaults").then((r) => r.json())) as {
    accountSid: string;
    apiKeySid: string;
    twimlAppSid: string;
    identity: string;
    callerId: string;
    hasServerAuthToken: boolean;
  };

export const testConnection = (o: Opt<Record<string, unknown>>) =>
  post<{ ok: boolean; status?: number; error?: string; friendlyName?: string; type?: string }>(
    "/api/twilio/test-connection",
    o?.data,
  );

export const sendSms = (o: Opt<Record<string, unknown>>) =>
  post<{
    ok: boolean;
    status?: number;
    code?: unknown;
    message?: string;
    sid?: string;
    to?: string;
    from?: string;
    body?: string;
  }>("/api/twilio/send-sms", o?.data);

export const placeRestCall = (o: Opt<Record<string, unknown>>) =>
  post<{ ok: boolean; status?: number; message?: string; sid?: string }>(
    "/api/twilio/rest-call",
    o?.data,
  );

export const provisionVoice = (o: Opt<Record<string, unknown>>) =>
  post<{
    ok: boolean;
    message?: string;
    apiKeySid?: string;
    apiKeySecret?: string;
    twimlAppSid?: string;
    voiceUrl?: string;
  }>("/api/twilio/provision", o?.data);
