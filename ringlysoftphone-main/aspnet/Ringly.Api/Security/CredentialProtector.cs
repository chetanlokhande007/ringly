using System.Security.Cryptography;
using System.Text;

namespace Ringly.Api.Security;

/// <summary>
/// AES-256-GCM protector for Twilio secrets at rest. The key comes from
/// configuration ("Security:CredentialKey", 32 bytes base64) — never from code.
/// Ciphertext layout: base64( nonce(12) | tag(16) | ciphertext ).
/// </summary>
public interface ICredentialProtector
{
    string? Protect(string? plaintext);
    string? Unprotect(string? cipher);
}

public class AesGcmCredentialProtector : ICredentialProtector
{
    private readonly byte[] _key;

    public AesGcmCredentialProtector(IConfiguration config)
    {
        var raw = config["Security:CredentialKey"]
                  ?? throw new InvalidOperationException("Security:CredentialKey is not configured.");
        _key = Convert.FromBase64String(raw);
        if (_key.Length != 32)
            throw new InvalidOperationException("Security:CredentialKey must be 32 bytes (base64).");
    }

    public string? Protect(string? plaintext)
    {
        if (string.IsNullOrEmpty(plaintext)) return null;
        var nonce = RandomNumberGenerator.GetBytes(12);
        var plain = Encoding.UTF8.GetBytes(plaintext);
        var cipher = new byte[plain.Length];
        var tag = new byte[16];
        using var aes = new AesGcm(_key, tag.Length);
        aes.Encrypt(nonce, plain, cipher, tag);
        return Convert.ToBase64String([.. nonce, .. tag, .. cipher]);
    }

    public string? Unprotect(string? cipherText)
    {
        if (string.IsNullOrEmpty(cipherText)) return null;
        var blob = Convert.FromBase64String(cipherText);
        var nonce = blob[..12];
        var tag = blob[12..28];
        var cipher = blob[28..];
        var plain = new byte[cipher.Length];
        using var aes = new AesGcm(_key, tag.Length);
        aes.Decrypt(nonce, cipher, tag, plain);
        return Encoding.UTF8.GetString(plain);
    }
}
