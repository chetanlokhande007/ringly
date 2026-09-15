import { createServerFn } from "@tanstack/react-start";

export type GoogleProfile = {
  sub: string;
  email: string;
  name: string;
  picture: string;
};

/**
 * Non-secret Google OAuth config for the browser (client ID only).
 * The client secret stays on the server and is never returned.
 */
export const getGoogleAuthConfig = createServerFn({ method: "GET" }).handler(async () => {
  return {
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
    configured: Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID),
  };
});

/**
 * Verify the Google Identity Services credential (an ID token) server-side and
 * return the profile. Validates the audience against our own client ID.
 */
export const verifyGoogleCredential = createServerFn({ method: "POST" })
  .inputValidator((data: { credential: string }) => {
    if (!data?.credential || typeof data.credential !== "string") {
      throw new Error("Missing credential");
    }
    return data;
  })
  .handler(async ({ data }) => {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID ?? "";
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(data.credential)}`,
    );
    if (!res.ok) return { ok: false as const, error: "Invalid Google token" };
    const info = (await res.json()) as Record<string, string>;
    if (clientId && info.aud !== clientId) {
      return { ok: false as const, error: "Token was issued for a different app" };
    }
    if (info.email_verified === "false") {
      return { ok: false as const, error: "Google account email is not verified" };
    }
    return {
      ok: true as const,
      user: {
        sub: info.sub,
        email: info.email ?? "",
        name: info.name ?? info.email ?? "",
        picture: info.picture ?? "",
      } satisfies GoogleProfile,
    };
  });
