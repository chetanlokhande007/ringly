using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Ringly.Api.Models;

/// <summary>Application user (softphone agent).</summary>
public class AppUser
{
    public Guid Id { get; set; } = Guid.NewGuid();

    [Required, MaxLength(256)]
    public string Email { get; set; } = default!;

    [MaxLength(200)]
    public string? FullName { get; set; }

    /// <summary>Null when the account was created through Google SSO.</summary>
    [MaxLength(512)]
    public string? PasswordHash { get; set; }

    [MaxLength(128)]
    public string? GoogleSubjectId { get; set; }

    [MaxLength(512)]
    public string? AvatarUrl { get; set; }

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;

    public TwilioCredential? TwilioCredential { get; set; }
    public ICollection<Contact> Contacts { get; set; } = new List<Contact>();
    public ICollection<CallLog> CallLogs { get; set; } = new List<CallLog>();
    public ICollection<SmsMessage> SmsMessages { get; set; } = new List<SmsMessage>();
    public ICollection<DialerCampaign> DialerCampaigns { get; set; } = new List<DialerCampaign>();
}

/// <summary>
/// Per-user Twilio configuration. Secret columns hold AES-256-GCM ciphertext,
/// never plaintext — see <c>ICredentialProtector</c>.
/// </summary>
public class TwilioCredential
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid UserId { get; set; }
    public AppUser? User { get; set; }

    [Required, MaxLength(64)]
    public string AccountSid { get; set; } = default!;

    [MaxLength(2048)]
    public string? AuthTokenCipher { get; set; }

    [MaxLength(64)]
    public string? ApiKeySid { get; set; }

    [MaxLength(2048)]
    public string? ApiKeySecretCipher { get; set; }

    [MaxLength(64)]
    public string? TwimlAppSid { get; set; }

    /// <summary>Voice SDK client identity, e.g. "CTMS".</summary>
    [MaxLength(128)]
    public string Identity { get; set; } = "CTMS";

    /// <summary>Verified outbound caller ID in E.164, e.g. "+14472442773".</summary>
    [MaxLength(32)]
    public string? CallerId { get; set; }

    [MaxLength(32)]
    public string Region { get; set; } = "US1";

    public bool IsVerified { get; set; }
    public DateTimeOffset? LastTestedAt { get; set; }

    [MaxLength(512)]
    public string? LastTestResult { get; set; }

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class Contact
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid UserId { get; set; }
    public AppUser? User { get; set; }

    [Required, MaxLength(200)]
    public string Name { get; set; } = default!;

    [Required, MaxLength(32)]
    public string PhoneNumber { get; set; } = default!;

    [MaxLength(256)]
    public string? Email { get; set; }

    [MaxLength(200)]
    public string? Company { get; set; }

    public bool IsFavorite { get; set; }

    [MaxLength(1000)]
    public string? Notes { get; set; }

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public enum CallDirection { Outbound = 0, Inbound = 1, Missed = 2 }

public class CallLog
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid UserId { get; set; }
    public AppUser? User { get; set; }

    public Guid? ContactId { get; set; }
    public Contact? Contact { get; set; }

    public CallDirection Direction { get; set; }

    [MaxLength(32)]
    public string? FromNumber { get; set; }

    [Required, MaxLength(32)]
    public string ToNumber { get; set; } = default!;

    /// <summary>Twilio call SID (CA...).</summary>
    [MaxLength(64)]
    public string? TwilioCallSid { get; set; }

    [MaxLength(32)]
    public string Status { get; set; } = "queued";

    public int DurationSeconds { get; set; }

    [MaxLength(512)]
    public string? RecordingUrl { get; set; }

    [MaxLength(1000)]
    public string? Notes { get; set; }

    public DateTimeOffset StartedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? EndedAt { get; set; }
}

public enum MessageDirection { Outbound = 0, Inbound = 1 }

public class SmsMessage
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid UserId { get; set; }
    public AppUser? User { get; set; }

    public Guid? ContactId { get; set; }
    public Contact? Contact { get; set; }

    public MessageDirection Direction { get; set; }

    [Required, MaxLength(32)]
    public string FromNumber { get; set; } = default!;

    [Required, MaxLength(32)]
    public string ToNumber { get; set; } = default!;

    [Required, MaxLength(1600)]
    public string Body { get; set; } = default!;

    /// <summary>Twilio message SID (SM...).</summary>
    [MaxLength(64)]
    public string? TwilioMessageSid { get; set; }

    [MaxLength(32)]
    public string Status { get; set; } = "queued";

    [MaxLength(32)]
    public string? ErrorCode { get; set; }

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class DialerCampaign
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid UserId { get; set; }
    public AppUser? User { get; set; }

    [Required, MaxLength(200)]
    public string Name { get; set; } = default!;

    [MaxLength(32)]
    public string Status { get; set; } = "idle"; // idle | running | paused | completed

    public int DelayBetweenCallsSeconds { get; set; } = 5;

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? CompletedAt { get; set; }

    public ICollection<DialerEntry> Entries { get; set; } = new List<DialerEntry>();
}

public class DialerEntry
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid CampaignId { get; set; }
    public DialerCampaign? Campaign { get; set; }

    [Required, MaxLength(200)]
    public string Name { get; set; } = default!;

    [Required, MaxLength(32)]
    public string PhoneNumber { get; set; } = default!;

    [MaxLength(32)]
    public string Status { get; set; } = "pending"; // pending | dialing | done | failed

    public int Position { get; set; }

    [MaxLength(64)]
    public string? TwilioCallSid { get; set; }

    public DateTimeOffset? DialedAt { get; set; }
}
