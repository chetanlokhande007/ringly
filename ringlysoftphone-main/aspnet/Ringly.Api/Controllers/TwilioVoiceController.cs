using System.Security;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;

namespace Ringly.Api.Controllers;

/// <summary>
/// TwiML endpoint hit by Twilio when the Voice SDK Device connects, or when a
/// REST bridge call is answered. Same XML as the previous Node endpoint.
/// </summary>
[ApiController]
[Route("api/public/twilio/voice")]
public class TwilioVoiceController : ControllerBase
{
    [HttpGet]
    public IActionResult Get(
        [FromQuery(Name = "To")] string? to,
        [FromQuery(Name = "CallerId")] string? callerId,
        [FromQuery(Name = "ForwardTo")] string? forwardTo)
        => Xml(BuildDialTwiml(Pick(forwardTo, to), callerId ?? ""));

    [HttpPost]
    [Consumes("application/x-www-form-urlencoded")]
    public IActionResult Post(
        [FromForm(Name = "To")] string? to,
        [FromForm(Name = "CallerId")] string? callerId,
        [FromQuery(Name = "ForwardTo")] string? forwardTo)
        => Xml(BuildDialTwiml(Pick(forwardTo, to), callerId ?? ""));

    /// <summary>Inbound webhooks may pass ?ForwardTo=+91… to redirect callers.</summary>
    private static string Pick(string? forwardTo, string? to)
        => !string.IsNullOrWhiteSpace(forwardTo) ? forwardTo! : to ?? "";


    private ContentResult Xml(string xml) => Content(xml, "text/xml; charset=utf-8");

    private static string Escape(string v) => SecurityElement.Escape(v) ?? "";

    private static string BuildDialTwiml(string to, string callerId)
    {
        to = to.Trim();
        callerId = callerId.Trim();
        if (string.IsNullOrEmpty(to))
            return "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response><Say>No destination number provided.</Say></Response>";

        var cid = string.IsNullOrEmpty(callerId) ? "" : $" callerId=\"{Escape(callerId)}\"";
        var isPhone = Regex.IsMatch(to, @"^\+?\d[\d\s\-().]{4,}$");
        var inner = isPhone ? $"<Number>{Escape(to)}</Number>" : $"<Client>{Escape(to)}</Client>";
        return $"<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response><Dial answerOnBridge=\"true\"{cid}>{inner}</Dial></Response>";
    }
}
