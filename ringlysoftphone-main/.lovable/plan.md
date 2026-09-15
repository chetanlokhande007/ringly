## Goal
Turn the mocked softphone into a working Twilio-backed extension with real auth, real SMS, and real Voice calls to any verified number (test target: +91-8055500014).

## 1. Backend (Lovable Cloud)
Enable Lovable Cloud. Create these tables:
- `profiles(id, email, full_name, avatar_url)` — auto-populated on signup via trigger
- `twilio_credentials(user_id PK, account_sid, auth_token_ciphertext, api_key_sid, api_key_secret_ciphertext, twiml_app_sid, caller_id, updated_at)` — server-role-only, per-user encrypted
- `call_logs(id, user_id, direction, from_number, to_number, status, duration_sec, twilio_sid, created_at)`
- `sms_messages(id, user_id, direction, from_number, to_number, body, status, twilio_sid, error_code, created_at)`
- `contacts(id, user_id, name, phone, email, is_favorite, created_at)`

RLS: each user reads/writes only their own rows. `twilio_credentials` locked to `service_role` only (secrets never leave the server).

## 2. Auth
- Enable Google OAuth via Cloud broker + Email/Password.
- Sign-in screen replaces mock login; on success go to Dialpad.
- Route gate: everything except `/auth` lives under `_authenticated/`.

## 3. Twilio Server Functions (`createServerFn`)
- `saveTwilioCredentials` — encrypts and upserts creds for current user
- `testTwilioConnection` — hits `GET /Accounts/{sid}.json` with user creds, returns friendly status
- `mintVoiceToken` — builds a Twilio Voice Access Token (JWT signed with API Key Secret, includes VoiceGrant → TwiML App SID) for the Voice SDK
- `sendSms` — Twilio REST `POST /Messages.json`, inserts into `sms_messages`
- `logCall` — inserts call log after Voice SDK reports final state
- `listCallLogs` / `listSmsMessages` / `contacts CRUD`

## 4. Twilio Webhook (server route, public)
- `POST /api/public/twilio/voice` — returns TwiML `<Dial><Number>{To}</Number></Dial>` from caller ID; TwiML App points here
- `POST /api/public/twilio/status` — status callback updates `call_logs` (queued/ringing/answered/completed/failed with duration)
- `POST /api/public/twilio/sms-status` — updates `sms_messages` delivery status
Signatures validated with Twilio's X-Twilio-Signature (auth token HMAC).

## 5. Frontend (Voice SDK)
- Install `@twilio/voice-sdk`.
- On login, call `mintVoiceToken`; register `Device` with the token; auto-refresh 5 min before expiry.
- Dialpad "Call" → `device.connect({ params: { To: number } })`.
- Wire mute/hold/hangup/DTMF to the active `Call` object.
- Incoming call → show ringing screen; accept/reject bound to SDK.
- Show live status (connecting → ringing → in-call → ended) from SDK events.

## 6. SMS
- New SMS + reply composer POSTs `sendSms`; message appears immediately (status=queued), then updates as webhook fires.
- Thread view queries `sms_messages` grouped by counterparty.

## 7. Settings → Twilio (per-user)
- Form fields: Account SID, Auth Token, API Key SID, API Key Secret, TwiML App SID, Caller ID.
- "Test connection" button → `testTwilioConnection`.
- Inline instructions + link telling user to point the TwiML App Voice URL at `https://project--<id>.lovable.app/api/public/twilio/voice`.

## 8. Trial call flow
After user saves creds and TwiML App URL is configured in Twilio Console, they dial `+918055500014` — call routes via `device.connect` → Lovable webhook → TwiML `<Dial>` → real phone rings.

## Technical notes
- Access Token signed with `jsonwebtoken` (HS256) — no Twilio Node SDK needed on Worker runtime.
- Encryption: AES-256-GCM using a generated `TWILIO_CRED_ENCRYPTION_KEY` (`secrets--generate_secret`).
- `contacts`, `call_logs`, `sms_messages` fetched via TanStack Query with realtime subscription for live status updates.

## Not in this pass
- Auto-Dialer live campaign runner (UI stays; wire to real calls after voice is verified working)
- Gmail integration (already scoped separately)
- Recording playback UI

Approve to build.