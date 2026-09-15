# Ringly — single ASP.NET Core application (React SPA + Web API)

One deployable app: the React frontend is built into `wwwroot` and served by the
same ASP.NET Core host that exposes the API — same domain, no CORS, no separate
Node server. The existing UI, layout, login page, dialogs, components and
frontend packages are unchanged.

## Layout

```text
/                                            # React app (unchanged)
├─ spa/index.html                            # static SPA host page
├─ src/spa-main.tsx                          # client-only entry (reuses the same page component)
├─ src/lib/twilio.functions.spa.ts           # calls the ASP.NET API instead of Node server functions
├─ vite.spa.config.ts                        # static build -> aspnet/Ringly.Api/wwwroot
└─ aspnet/Ringly.Api/
   ├─ Program.cs                             # static files + API routing + SPA fallback
   ├─ Ringly.Api.csproj                      # runs `npm run build:spa` on publish
   ├─ Controllers/TwilioController.cs        # /api/twilio/* (token, defaults, test, sms, call, provision)
   ├─ Controllers/TwilioVoiceController.cs   # /api/public/twilio/voice (TwiML)
   ├─ Controllers/TwilioCredentialsController.cs
   ├─ Models/Entities.cs, Data/RinglyDbContext.cs, Migrations/, Scripts/
   └─ Security/CredentialProtector.cs        # AES-256-GCM at-rest encryption
```

## API surface (same behaviour as the previous server functions)

| Endpoint | Purpose |
| --- | --- |
| `GET  /api/twilio/defaults` | Server-configured Account SID + whether an auth token is set |
| `POST /api/twilio/token` | Mint a Voice Access Token (JWT, `cty=twilio-fpa;v=1`) |
| `POST /api/twilio/test-connection` | Validate credentials against Twilio REST |
| `POST /api/twilio/send-sms` | Send SMS via Twilio REST |
| `POST /api/twilio/rest-call` | PSTN bridge call fallback |
| `POST /api/twilio/provision` | Create API Key + TwiML App for browser Voice |
| `GET/POST /api/public/twilio/voice` | TwiML `<Dial>` endpoint called by Twilio |

Point the TwiML App's Voice Request URL at `https://<your-domain>/api/public/twilio/voice`.

## Configuration (`appsettings.json` or environment)

No Twilio credential is hardcoded in the source. Every account-specific value is
read from configuration (or per-user rows in `TwilioCredentials`), so different
users/organisations can run the same build with their own Twilio account.

```json
{
  "ConnectionStrings": { "Default": "Server=localhost;Database=Ringly;Trusted_Connection=True;TrustServerCertificate=True" },
  "Security": { "CredentialKey": "<32-byte base64 key>" },
  "Twilio": {
    "AccountSid": "ACxxxxxxxx",
    "AuthToken": "xxxxxxxx",
    "ApiKeySid": "SKxxxxxxxx",
    "ApiKeySecret": "xxxxxxxx",
    "TwimlAppSid": "APxxxxxxxx",
    "Identity": "CTMS",
    "CallerId": "+1xxxxxxxxxx",
    "PublicBaseUrl": "https://your-domain.com"
  }
}
```

`GET /api/twilio/defaults` exposes only the non-secret fields (Account SID, API
Key SID, TwiML App SID, identity, caller ID) so the UI can prefill the settings
form; auth token and API key secret never leave the server. Values a user saves
in the app override the server defaults, and per-user credentials are stored
AES-256-GCM encrypted in the database.

`PublicBaseUrl` is optional — when empty the request host is used. Environment
variables `TWILIO_ACCOUNTSID` / `TWILIO_AUTHTOKEN` / `TWILIO_APIKEYSID` /
`TWILIO_APIKEYSECRET` / `TWILIO_TWIMLAPPSID` / `TWILIO_IDENTITY` /
`TWILIO_CALLERID` / `TWILIO_PUBLICBASEURL` are also honoured.

## Run locally

```bash
cd aspnet/Ringly.Api
npm --prefix ../.. run build:spa   # builds React into wwwroot
dotnet run                         # app + API on https://localhost:5001
```

For frontend iteration you can still run `npm run dev` at the repo root.

## Publish (single app)

```bash
cd aspnet/Ringly.Api
dotnet publish -c Release -o ./publish
```

The publish target runs `npm install` + `npm run build:spa`, emits the React
bundle into `wwwroot`, and copies it into the publish output. Deploy the
`publish` folder — frontend and backend run from one domain.

Skip the frontend build (e.g. CI already built it): `dotnet publish -c Release -p:BuildSpaOnPublish=false`.

## Routing

- `/api/**` → controllers (unknown API paths return JSON 404)
- real files in `wwwroot` → served as static assets
- everything else → `index.html`, so client-side routing and page refreshes work

## Database

```bash
dotnet tool install --global dotnet-ef
dotnet ef database update            # applies Migrations/20260729000000_InitialCreate
# or run Scripts/001_InitialCreate.sql directly
```

Generate the credential key: `openssl rand -base64 32`.
