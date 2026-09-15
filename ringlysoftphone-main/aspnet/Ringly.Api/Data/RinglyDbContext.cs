using Microsoft.EntityFrameworkCore;
using Ringly.Api.Models;

namespace Ringly.Api.Data;

public class RinglyDbContext : DbContext
{
    public RinglyDbContext(DbContextOptions<RinglyDbContext> options) : base(options) { }

    public DbSet<AppUser> Users => Set<AppUser>();
    public DbSet<TwilioCredential> TwilioCredentials => Set<TwilioCredential>();
    public DbSet<Contact> Contacts => Set<Contact>();
    public DbSet<CallLog> CallLogs => Set<CallLog>();
    public DbSet<SmsMessage> SmsMessages => Set<SmsMessage>();
    public DbSet<DialerCampaign> DialerCampaigns => Set<DialerCampaign>();
    public DbSet<DialerEntry> DialerEntries => Set<DialerEntry>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        base.OnModelCreating(b);

        b.Entity<AppUser>(e =>
        {
            e.ToTable("Users");
            e.HasIndex(x => x.Email).IsUnique();
            e.HasIndex(x => x.GoogleSubjectId);
        });

        b.Entity<TwilioCredential>(e =>
        {
            e.ToTable("TwilioCredentials");
            // One credential set per user, editable in Settings -> Twilio.
            e.HasIndex(x => x.UserId).IsUnique();
            e.HasOne(x => x.User)
                .WithOne(u => u.TwilioCredential)
                .HasForeignKey<TwilioCredential>(x => x.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Contact>(e =>
        {
            e.ToTable("Contacts");
            e.HasIndex(x => new { x.UserId, x.PhoneNumber }).IsUnique();
            e.HasIndex(x => new { x.UserId, x.IsFavorite });
            e.HasOne(x => x.User).WithMany(u => u.Contacts)
                .HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<CallLog>(e =>
        {
            e.ToTable("CallLogs");
            e.Property(x => x.Direction).HasConversion<int>();
            e.HasIndex(x => new { x.UserId, x.StartedAt });
            e.HasIndex(x => x.TwilioCallSid).IsUnique().HasFilter(null);
            e.HasOne(x => x.User).WithMany(u => u.CallLogs)
                .HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Contact).WithMany()
                .HasForeignKey(x => x.ContactId).OnDelete(DeleteBehavior.SetNull);
        });

        b.Entity<SmsMessage>(e =>
        {
            e.ToTable("SmsMessages");
            e.Property(x => x.Direction).HasConversion<int>();
            e.HasIndex(x => new { x.UserId, x.CreatedAt });
            e.HasIndex(x => x.TwilioMessageSid).IsUnique().HasFilter(null);
            e.HasOne(x => x.User).WithMany(u => u.SmsMessages)
                .HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Contact).WithMany()
                .HasForeignKey(x => x.ContactId).OnDelete(DeleteBehavior.SetNull);
        });

        b.Entity<DialerCampaign>(e =>
        {
            e.ToTable("DialerCampaigns");
            e.HasIndex(x => new { x.UserId, x.Status });
            e.HasOne(x => x.User).WithMany(u => u.DialerCampaigns)
                .HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<DialerEntry>(e =>
        {
            e.ToTable("DialerEntries");
            e.HasIndex(x => new { x.CampaignId, x.Position });
            e.HasOne(x => x.Campaign).WithMany(c => c.Entries)
                .HasForeignKey(x => x.CampaignId).OnDelete(DeleteBehavior.Cascade);
        });
    }

    public override int SaveChanges()
    {
        Touch();
        return base.SaveChanges();
    }

    public override Task<int> SaveChangesAsync(CancellationToken ct = default)
    {
        Touch();
        return base.SaveChangesAsync(ct);
    }

    private void Touch()
    {
        var now = DateTimeOffset.UtcNow;
        foreach (var entry in ChangeTracker.Entries())
        {
            if (entry.State != EntityState.Modified) continue;
            if (entry.Metadata.FindProperty("UpdatedAt") is not null)
                entry.Property("UpdatedAt").CurrentValue = now;
        }
    }
}
