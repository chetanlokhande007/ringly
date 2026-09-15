import { createFileRoute } from "@tanstack/react-router";

/**
 * TwiML endpoint invoked by Twilio when the Voice SDK Device.connect() fires.
 * We forward the requested number through <Dial>. CallerId is passed as a
 * custom param from the client (device.connect({ params: { To, CallerId } })).
 */
export const Route = createFileRoute("/api/public/twilio/voice")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const form = await request.formData().catch(() => new FormData());
        // Inbound webhooks can carry ?ForwardTo=+91… so calls ring a backup phone.
        const forwardTo = (url.searchParams.get("ForwardTo") ?? "").trim();
        const to = forwardTo || String(form.get("To") ?? "").trim();
        const callerId = String(form.get("CallerId") ?? "").trim() || (url.searchParams.get("CallerId") ?? "").trim();
        const twiml = buildDialTwiml(to, callerId);
        return new Response(twiml, {
          status: 200,
          headers: { "content-type": "text/xml; charset=utf-8" },
        });
      },
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const forwardTo = (url.searchParams.get("ForwardTo") ?? "").trim();
        const to = forwardTo || (url.searchParams.get("To") ?? "").trim();
        const callerId = (url.searchParams.get("CallerId") ?? "").trim();
        return new Response(buildDialTwiml(to, callerId), {
          status: 200,
          headers: { "content-type": "text/xml; charset=utf-8" },
        });
      },

    },
  },
});

function escapeXml(v: string) {
  return v.replace(/[<>&'"]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c === "'" ? "&apos;" : "&quot;",
  );
}

function buildDialTwiml(to: string, callerId: string) {
  if (!to) {
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>No destination number provided.</Say></Response>`;
  }
  const cid = callerId ? ` callerId="${escapeXml(callerId)}"` : "";
  // Route to a PSTN number if it looks like E.164, otherwise treat as a client identity.
  const isPhone = /^\+?\d[\d\s\-().]{4,}$/.test(to);
  const inner = isPhone
    ? `<Number>${escapeXml(to)}</Number>`
    : `<Client>${escapeXml(to)}</Client>`;
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Dial answerOnBridge="true"${cid}>${inner}</Dial></Response>`;
}
