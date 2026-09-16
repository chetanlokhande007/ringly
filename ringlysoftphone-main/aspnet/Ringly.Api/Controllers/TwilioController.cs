using System.IdentityModel.Tokens.Jwt;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.Tokens;

namespace Ringly.Api.Controllers;

/// <summary>
/// Same-domain replacement for the Node server functions used by the React app.
/// Behaviour is identical — only the transport changed.
/// </summary>
[ApiController]
[Route("api/twilio")]
public class TwilioController : ControllerBase
{
    private const string TwilioRoot = "https://api.twilio.com/2010-04-01/Accounts";
    private readonly IHttpClientFactory _http;
    private readonly IConfiguration _config;

    public TwilioController(IHttpClientFactory http, IConfiguration config)
    {
        _http = http;
        _config = config;
    }

    private string Setting(string key) =>
        _config[$"Twilio:{key}"] ?? Environment.GetEnvironmentVariable($"TWILIO_{key.ToUpperInvariant()}") ?? "";

    private string AccountSid(string? given) => !string.IsNullOrWhiteSpace(given) ? given! : Setting("AccountSid");

    private string AuthToken(string? given) =>
        (!string.IsNullOrWhiteSpace(given) && given != "configured-on-server") ? given! : Setting("AuthToken");

    private string PublicBaseUrl()
    {
        var configured = Setting("PublicBaseUrl");
        if (!string.IsNullOrWhiteSpace(configured)) return configured.TrimEnd('/');
        return $"{Request.Scheme}://{Request.Host}";
    }

    private HttpClient Client(string accountSid, string authToken)
    {
        var client = _http.CreateClient();
        var basic = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{accountSid}:{authToken}"));
        client.DefaultRequestHeaders.Add("Authorization", $"Basic {basic}");
        return client;
    }

    public record VoiceTokenRequest(string? AccountSid, string? ApiKeySid, string? ApiKeySecret, string? TwimlAppSid, string? Identity, int? Ttl);

    /// <summary>Mint a Twilio Voice Access Token (JWT, cty=twilio-fpa;v=1).</summary>
    [HttpPost("token")]
    public IActionResult Token([FromBody] VoiceTokenRequest req)
    {
        var apiKeySid = !string.IsNullOrWhiteSpace(req?.ApiKeySid) ? req.ApiKeySid : Setting("ApiKeySid");
        var apiKeySecret = (!string.IsNullOrWhiteSpace(req?.ApiKeySecret) && req.ApiKeySecret != "configured-on-server")
            ? req.ApiKeySecret
            : Setting("ApiKeySecret");
        var twimlAppSid = !string.IsNullOrWhiteSpace(req?.TwimlAppSid) ? req.TwimlAppSid : Setting("TwimlAppSid");
        var identity = !string.IsNullOrWhiteSpace(req?.Identity) ? req.Identity : Setting("Identity");
        var accountSid = AccountSid(req?.AccountSid);

        if (string.IsNullOrWhiteSpace(apiKeySid) || string.IsNullOrWhiteSpace(apiKeySecret)
            || string.IsNullOrWhiteSpace(twimlAppSid) || string.IsNullOrWhiteSpace(identity)
            || string.IsNullOrWhiteSpace(accountSid))
        {
            return BadRequest(new { error = "Missing credentials" });
        }

        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var ttl = Math.Clamp(req.Ttl ?? 3600, 60, 24 * 3600);
        var expires = now + ttl;

        var voiceGrant = new Twilio.Jwt.AccessToken.VoiceGrant
        {
            IncomingAllow = true,
            OutgoingApplicationSid = twimlAppSid
        };

        var grants = new HashSet<Twilio.Jwt.AccessToken.IGrant> { voiceGrant };

        var token = new Twilio.Jwt.AccessToken.Token(
            accountSid,
            apiKeySid,
            apiKeySecret,
            identity: identity,
            expiration: DateTime.UtcNow.AddSeconds(ttl),
            grants: grants
        );

        return Ok(new { token = token.ToJwt(), identity, expiresAt = expires });
    }

    private static string B64(object o) => Base64Url(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(o)));

    private static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    /// <summary>
    /// Non-secret, tenant-configurable defaults from configuration
    /// (appsettings.json / environment / DB-backed config provider).
    /// Secrets are never returned.
    /// </summary>
    [HttpGet("defaults")]
    public IActionResult Defaults() => Ok(new
    {
        accountSid = Setting("AccountSid"),
        apiKeySid = Setting("ApiKeySid"),
        twimlAppSid = Setting("TwimlAppSid"),
        identity = Setting("Identity"),
        callerId = Setting("CallerId"),
        hasServerAuthToken = !string.IsNullOrWhiteSpace(Setting("AuthToken")),
        hasServerApiKeySecret = !string.IsNullOrWhiteSpace(Setting("ApiKeySecret")),
    });

    public record CredsRequest(string? AccountSid, string? AuthToken);

    [HttpPost("test-connection")]
    public async Task<IActionResult> TestConnection([FromBody] CredsRequest req)
    {
        var sid = AccountSid(req?.AccountSid);
        var token = AuthToken(req?.AuthToken);
        if (string.IsNullOrWhiteSpace(sid) || string.IsNullOrWhiteSpace(token))
            return Ok(new { ok = false, status = 400, error = "Missing credentials" });

        var res = await Client(sid, token).GetAsync($"{TwilioRoot}/{Uri.EscapeDataString(sid)}.json");
        var body = await res.Content.ReadAsStringAsync();
        if (!res.IsSuccessStatusCode)
            return Ok(new { ok = false, status = (int)res.StatusCode, error = Truncate(body, 400) });

        using var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;
        return Ok(new
        {
            ok = true,
            friendlyName = Str(root, "friendly_name"),
            status = Str(root, "status"),
            type = Str(root, "type"),
        });
    }

    public record SmsRequest(string? AccountSid, string? AuthToken, string From, string To, string Body);

    [HttpPost("send-sms")]
    public async Task<IActionResult> SendSms([FromBody] SmsRequest req)
    {
        if (req is null || string.IsNullOrWhiteSpace(req.From) || string.IsNullOrWhiteSpace(req.To) || string.IsNullOrWhiteSpace(req.Body))
            return Ok(new { ok = false, status = 400, message = "Missing from/to/body" });
        if (req.Body.Length > 1600)
            return Ok(new { ok = false, status = 400, message = "Message too long" });

        var sid = AccountSid(req.AccountSid);
        var token = AuthToken(req.AuthToken);
        if (string.IsNullOrWhiteSpace(sid) || string.IsNullOrWhiteSpace(token))
            return Ok(new { ok = false, status = 400, message = "Missing Twilio credentials" });

        var form = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["To"] = req.To, ["From"] = req.From, ["Body"] = req.Body,
        });
        var res = await Client(sid, token).PostAsync($"{TwilioRoot}/{Uri.EscapeDataString(sid)}/Messages.json", form);
        var json = await ReadJson(res);
        if (!res.IsSuccessStatusCode)
            return Ok(new { ok = false, status = (int)res.StatusCode, message = Str(json, "message") ?? "Twilio error" });

        return Ok(new
        {
            ok = true,
            sid = Str(json, "sid"),
            status = Str(json, "status"),
            to = Str(json, "to"),
            from = Str(json, "from"),
            body = Str(json, "body"),
        });
    }

    public record RestCallRequest(string? AccountSid, string? AuthToken, string To, string? From, string? AgentPhone);

    /// <summary>PSTN bridge: ring the agent's phone, then dial the destination.</summary>
    [HttpPost("rest-call")]
    public async Task<IActionResult> RestCall([FromBody] RestCallRequest req)
    {
        if (req is null || string.IsNullOrWhiteSpace(req.To))
            return Ok(new { ok = false, status = 400, message = "Missing destination number" });

        var sid = AccountSid(req.AccountSid);
        var token = AuthToken(req.AuthToken);
        var from = !string.IsNullOrWhiteSpace(req.From) ? req.From! : Setting("CallerId");
        var agentPhone = req.AgentPhone ?? "";

        if (string.IsNullOrWhiteSpace(sid) || string.IsNullOrWhiteSpace(token))
            return Ok(new { ok = false, status = 400, message = "Missing Twilio credentials" });
        if (string.IsNullOrWhiteSpace(from))
            return Ok(new { ok = false, status = 400, message = "Missing caller ID (your Twilio number)" });
        if (string.IsNullOrWhiteSpace(agentPhone))
            return Ok(new { ok = false, status = 400, message = "Browser calling isn't ready and no agent phone is set. Add your own phone number in Twilio settings to bridge calls." });

        var twimlUrl = $"{PublicBaseUrl()}/api/public/twilio/voice?To={Uri.EscapeDataString(req.To)}&CallerId={Uri.EscapeDataString(from)}";
        var form = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["To"] = agentPhone, ["From"] = from, ["Url"] = twimlUrl, ["Method"] = "GET",
        });
        var res = await Client(sid, token).PostAsync($"{TwilioRoot}/{Uri.EscapeDataString(sid)}/Calls.json", form);
        var json = await ReadJson(res);
        if (!res.IsSuccessStatusCode)
            return Ok(new { ok = false, status = (int)res.StatusCode, message = Str(json, "message") ?? "Twilio call failed" });

        return Ok(new { ok = true, sid = Str(json, "sid"), status = Str(json, "status") });
    }

    /// <summary>Create an API Key + reuse/repoint the TwiML App for browser Voice.</summary>
    [HttpPost("provision")]
    public async Task<IActionResult> Provision([FromBody] CredsRequest req)
    {
        var sid = AccountSid(req?.AccountSid);
        var token = AuthToken(req?.AuthToken);
        if (string.IsNullOrWhiteSpace(sid) || string.IsNullOrWhiteSpace(token))
            return Ok(new { ok = false, message = "Missing Twilio Account SID or Auth Token" });

        var http = Client(sid, token);
        var root = $"{TwilioRoot}/{Uri.EscapeDataString(sid)}";
        var voiceUrl = $"{PublicBaseUrl()}/api/public/twilio/voice";

        try
        {
            var key = await Send(http, HttpMethod.Post, $"{root}/Keys.json", new() { ["FriendlyName"] = "Ringly Softphone" });
            var apiKeySid = Str(key, "sid");
            var apiKeySecret = Str(key, "secret");

            var list = await Send(http, HttpMethod.Get, $"{root}/Applications.json?FriendlyName=Ringly%20Softphone", null);
            string? existing = null;
            if (list.TryGetProperty("applications", out var apps) && apps.GetArrayLength() > 0)
                existing = Str(apps[0], "sid");

            var appJson = existing is not null
                ? await Send(http, HttpMethod.Post, $"{root}/Applications/{existing}.json",
                    new() { ["VoiceUrl"] = voiceUrl, ["VoiceMethod"] = "POST" })
                : await Send(http, HttpMethod.Post, $"{root}/Applications.json",
                    new() { ["FriendlyName"] = "Ringly Softphone", ["VoiceUrl"] = voiceUrl, ["VoiceMethod"] = "POST" });

            return Ok(new
            {
                ok = true,
                apiKeySid,
                apiKeySecret,
                twimlAppSid = Str(appJson, "sid"),
                voiceUrl,
            });
        }
        catch (Exception e)
        {
            return Ok(new { ok = false, message = e.Message });
        }
    }

    private static async Task<JsonElement> Send(HttpClient http, HttpMethod method, string url, Dictionary<string, string>? form)
    {
        using var msg = new HttpRequestMessage(method, url);
        if (form is not null) msg.Content = new FormUrlEncodedContent(form);
        var res = await http.SendAsync(msg);
        var json = await ReadJson(res);
        if (!res.IsSuccessStatusCode)
            throw new InvalidOperationException(Str(json, "message") ?? $"Twilio error {(int)res.StatusCode}");
        return json;
    }

    private static async Task<JsonElement> ReadJson(HttpResponseMessage res)
    {
        var text = await res.Content.ReadAsStringAsync();
        try { return JsonDocument.Parse(text).RootElement.Clone(); }
        catch { return JsonDocument.Parse("{}").RootElement.Clone(); }
    }

    private static string? Str(JsonElement el, string name) =>
        el.ValueKind == JsonValueKind.Object && el.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString()
            : null;

    private static string Truncate(string s, int n) => s.Length <= n ? s : s[..n];
}
