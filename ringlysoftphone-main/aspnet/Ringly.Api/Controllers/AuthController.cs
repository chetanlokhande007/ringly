using System.Text.Json;
using Microsoft.AspNetCore.Mvc;

namespace Ringly.Api.Controllers;

[ApiController]
[Route("api/auth/google")]
public sealed class AuthController : ControllerBase
{
    private readonly IConfiguration _config;
    private readonly IHttpClientFactory _http;

    public AuthController(IConfiguration config, IHttpClientFactory http)
    {
        _config = config;
        _http = http;
    }

    private string ClientId =>
        _config["Google:ClientId"]
        ?? Environment.GetEnvironmentVariable("GOOGLE_OAUTH_CLIENT_ID")
        ?? string.Empty;

    /// <summary>Non-secret client ID for the browser. The client secret never leaves the server.</summary>
    [HttpGet("config")]
    public IActionResult GetConfig() =>
        Ok(new { clientId = ClientId, configured = !string.IsNullOrWhiteSpace(ClientId) });

    public sealed record VerifyRequest(string Credential);

    /// <summary>Validate a Google Identity Services ID token and return the profile.</summary>
    [HttpPost("verify")]
    public async Task<IActionResult> Verify([FromBody] VerifyRequest body)
    {
        if (string.IsNullOrWhiteSpace(body?.Credential))
            return Ok(new { ok = false, error = "Missing credential" });

        var client = _http.CreateClient();
        var res = await client.GetAsync(
            "https://oauth2.googleapis.com/tokeninfo?id_token=" + Uri.EscapeDataString(body.Credential));
        if (!res.IsSuccessStatusCode)
            return Ok(new { ok = false, error = "Invalid Google token" });

        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
        var root = doc.RootElement;
        string? Get(string k) => root.TryGetProperty(k, out var v) ? v.GetString() : null;

        var clientId = ClientId;
        if (!string.IsNullOrWhiteSpace(clientId) && Get("aud") != clientId)
            return Ok(new { ok = false, error = "Token was issued for a different app" });
        if (Get("email_verified") == "false")
            return Ok(new { ok = false, error = "Google account email is not verified" });

        return Ok(new
        {
            ok = true,
            user = new
            {
                sub = Get("sub") ?? string.Empty,
                email = Get("email") ?? string.Empty,
                name = Get("name") ?? Get("email") ?? string.Empty,
                picture = Get("picture") ?? string.Empty,
            },
        });
    }
}
