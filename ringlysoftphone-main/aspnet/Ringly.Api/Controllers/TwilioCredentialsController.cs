using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Ringly.Api.Data;
using Ringly.Api.Models;
using Ringly.Api.Security;

namespace Ringly.Api.Controllers;

public record TwilioCredentialDto(
    string AccountSid,
    string? AuthToken,
    string? ApiKeySid,
    string? ApiKeySecret,
    string? TwimlAppSid,
    string Identity,
    string? CallerId,
    string Region);

/// <summary>
/// Read/update the signed-in agent's Twilio settings. GET returns masked
/// secrets so the UI can prefill the form without leaking values; PUT keeps
/// the stored secret when the client sends the masked placeholder back.
/// </summary>
[ApiController]
[Route("api/twilio/credentials")]
[Authorize]
public class TwilioCredentialsController : ControllerBase
{
    private const string Mask = "••••••••";

    private readonly RinglyDbContext _db;
    private readonly ICredentialProtector _protector;
    private readonly IHttpClientFactory _http;

    public TwilioCredentialsController(RinglyDbContext db, ICredentialProtector protector, IHttpClientFactory http)
    {
        _db = db;
        _protector = protector;
        _http = http;
    }

    private Guid UserId => Guid.Parse(User.FindFirst("sub")?.Value
        ?? throw new UnauthorizedAccessException());

    [HttpGet]
    public async Task<ActionResult<TwilioCredentialDto>> Get()
    {
        var row = await _db.TwilioCredentials.AsNoTracking()
            .FirstOrDefaultAsync(x => x.UserId == UserId);

        if (row is null)
            return Ok(new TwilioCredentialDto("", null, null, null, null, "CTMS", null, "US1"));

        return Ok(new TwilioCredentialDto(
            row.AccountSid,
            row.AuthTokenCipher is null ? null : Mask,
            row.ApiKeySid,
            row.ApiKeySecretCipher is null ? null : Mask,
            row.TwimlAppSid,
            row.Identity,
            row.CallerId,
            row.Region));
    }

    [HttpPut]
    public async Task<ActionResult<TwilioCredentialDto>> Upsert([FromBody] TwilioCredentialDto dto)
    {
        if (string.IsNullOrWhiteSpace(dto.AccountSid) || !dto.AccountSid.StartsWith("AC"))
            return BadRequest(new { message = "Account SID must start with AC." });

        var row = await _db.TwilioCredentials.FirstOrDefaultAsync(x => x.UserId == UserId);
        if (row is null)
        {
            row = new TwilioCredential { UserId = UserId };
            _db.TwilioCredentials.Add(row);
        }

        row.AccountSid = dto.AccountSid.Trim();
        row.ApiKeySid = dto.ApiKeySid?.Trim();
        row.TwimlAppSid = dto.TwimlAppSid?.Trim();
        row.Identity = string.IsNullOrWhiteSpace(dto.Identity) ? "CTMS" : dto.Identity.Trim();
        row.CallerId = dto.CallerId?.Trim();
        row.Region = string.IsNullOrWhiteSpace(dto.Region) ? "US1" : dto.Region.Trim();

        if (!string.IsNullOrEmpty(dto.AuthToken) && dto.AuthToken != Mask)
            row.AuthTokenCipher = _protector.Protect(dto.AuthToken.Trim());
        if (!string.IsNullOrEmpty(dto.ApiKeySecret) && dto.ApiKeySecret != Mask)
            row.ApiKeySecretCipher = _protector.Protect(dto.ApiKeySecret.Trim());

        await _db.SaveChangesAsync();
        return await Get();
    }

    /// <summary>Validate the stored credentials against the Twilio REST API.</summary>
    [HttpPost("test")]
    public async Task<IActionResult> Test()
    {
        var row = await _db.TwilioCredentials.FirstOrDefaultAsync(x => x.UserId == UserId);
        if (row is null) return NotFound(new { message = "No Twilio credentials saved." });

        var token = _protector.Unprotect(row.AuthTokenCipher);
        if (string.IsNullOrEmpty(token))
            return BadRequest(new { message = "Auth token missing." });

        var client = _http.CreateClient();
        var basic = Convert.ToBase64String(
            System.Text.Encoding.UTF8.GetBytes($"{row.AccountSid}:{token}"));
        client.DefaultRequestHeaders.Authorization = new("Basic", basic);

        var res = await client.GetAsync(
            $"https://api.twilio.com/2010-04-01/Accounts/{Uri.EscapeDataString(row.AccountSid)}.json");
        var body = await res.Content.ReadAsStringAsync();

        row.IsVerified = res.IsSuccessStatusCode;
        row.LastTestedAt = DateTimeOffset.UtcNow;
        row.LastTestResult = res.IsSuccessStatusCode ? "OK" : body[..Math.Min(body.Length, 400)];
        await _db.SaveChangesAsync();

        return res.IsSuccessStatusCode
            ? Ok(new { ok = true, message = "Connection OK" })
            : StatusCode((int)res.StatusCode, new { ok = false, message = row.LastTestResult });
    }
}
