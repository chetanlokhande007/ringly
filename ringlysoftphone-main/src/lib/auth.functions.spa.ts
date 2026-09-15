/**
 * SPA build replacement for `auth.functions.ts` — same call signatures, but
 * talks to the same-domain ASP.NET Core AuthController.
 */
export type GoogleProfile = {
  sub: string;
  email: string;
  name: string;
  picture: string;
};

export const getGoogleAuthConfig = async () =>
  (await fetch("/api/auth/google/config").then((r) => r.json())) as {
    clientId: string;
    configured: boolean;
  };

export const verifyGoogleCredential = async (o?: { data: { credential: string } }) =>
  (await fetch("/api/auth/google/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(o?.data ?? {}),
  }).then((r) => r.json())) as
    | { ok: true; user: GoogleProfile }
    | { ok: false; error: string };
