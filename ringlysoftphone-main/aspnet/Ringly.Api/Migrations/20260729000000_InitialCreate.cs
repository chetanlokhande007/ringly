using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Ringly.Api.Migrations;

/// <summary>
/// Initial schema for the Ringly softphone: users, per-user Twilio credentials,
/// contacts, call logs, SMS messages and auto-dialer campaigns.
///
/// Apply with:  dotnet ef database update
/// </summary>
[Migration("20260729000000_InitialCreate")]
public partial class InitialCreate : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "Users",
            columns: table => new
            {
                Id = table.Column<Guid>(nullable: false),
                Email = table.Column<string>(maxLength: 256, nullable: false),
                FullName = table.Column<string>(maxLength: 200, nullable: true),
                PasswordHash = table.Column<string>(maxLength: 512, nullable: true),
                GoogleSubjectId = table.Column<string>(maxLength: 128, nullable: true),
                AvatarUrl = table.Column<string>(maxLength: 512, nullable: true),
                CreatedAt = table.Column<DateTimeOffset>(nullable: false),
                UpdatedAt = table.Column<DateTimeOffset>(nullable: false)
            },
            constraints: table => table.PrimaryKey("PK_Users", x => x.Id));

        migrationBuilder.CreateTable(
            name: "TwilioCredentials",
            columns: table => new
            {
                Id = table.Column<Guid>(nullable: false),
                UserId = table.Column<Guid>(nullable: false),
                AccountSid = table.Column<string>(maxLength: 64, nullable: false),
                AuthTokenCipher = table.Column<string>(maxLength: 2048, nullable: true),
                ApiKeySid = table.Column<string>(maxLength: 64, nullable: true),
                ApiKeySecretCipher = table.Column<string>(maxLength: 2048, nullable: true),
                TwimlAppSid = table.Column<string>(maxLength: 64, nullable: true),
                Identity = table.Column<string>(maxLength: 128, nullable: false, defaultValue: "CTMS"),
                CallerId = table.Column<string>(maxLength: 32, nullable: true),
                Region = table.Column<string>(maxLength: 32, nullable: false, defaultValue: "US1"),
                IsVerified = table.Column<bool>(nullable: false, defaultValue: false),
                LastTestedAt = table.Column<DateTimeOffset>(nullable: true),
                LastTestResult = table.Column<string>(maxLength: 512, nullable: true),
                CreatedAt = table.Column<DateTimeOffset>(nullable: false),
                UpdatedAt = table.Column<DateTimeOffset>(nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_TwilioCredentials", x => x.Id);
                table.ForeignKey("FK_TwilioCredentials_Users_UserId", x => x.UserId,
                    "Users", "Id", onDelete: ReferentialAction.Cascade);
            });

        migrationBuilder.CreateTable(
            name: "Contacts",
            columns: table => new
            {
                Id = table.Column<Guid>(nullable: false),
                UserId = table.Column<Guid>(nullable: false),
                Name = table.Column<string>(maxLength: 200, nullable: false),
                PhoneNumber = table.Column<string>(maxLength: 32, nullable: false),
                Email = table.Column<string>(maxLength: 256, nullable: true),
                Company = table.Column<string>(maxLength: 200, nullable: true),
                IsFavorite = table.Column<bool>(nullable: false, defaultValue: false),
                Notes = table.Column<string>(maxLength: 1000, nullable: true),
                CreatedAt = table.Column<DateTimeOffset>(nullable: false),
                UpdatedAt = table.Column<DateTimeOffset>(nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_Contacts", x => x.Id);
                table.ForeignKey("FK_Contacts_Users_UserId", x => x.UserId,
                    "Users", "Id", onDelete: ReferentialAction.Cascade);
            });

        migrationBuilder.CreateTable(
            name: "CallLogs",
            columns: table => new
            {
                Id = table.Column<Guid>(nullable: false),
                UserId = table.Column<Guid>(nullable: false),
                ContactId = table.Column<Guid>(nullable: true),
                Direction = table.Column<int>(nullable: false),
                FromNumber = table.Column<string>(maxLength: 32, nullable: true),
                ToNumber = table.Column<string>(maxLength: 32, nullable: false),
                TwilioCallSid = table.Column<string>(maxLength: 64, nullable: true),
                Status = table.Column<string>(maxLength: 32, nullable: false, defaultValue: "queued"),
                DurationSeconds = table.Column<int>(nullable: false, defaultValue: 0),
                RecordingUrl = table.Column<string>(maxLength: 512, nullable: true),
                Notes = table.Column<string>(maxLength: 1000, nullable: true),
                StartedAt = table.Column<DateTimeOffset>(nullable: false),
                EndedAt = table.Column<DateTimeOffset>(nullable: true)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_CallLogs", x => x.Id);
                table.ForeignKey("FK_CallLogs_Users_UserId", x => x.UserId,
                    "Users", "Id", onDelete: ReferentialAction.Cascade);
                table.ForeignKey("FK_CallLogs_Contacts_ContactId", x => x.ContactId,
                    "Contacts", "Id", onDelete: ReferentialAction.SetNull);
            });

        migrationBuilder.CreateTable(
            name: "SmsMessages",
            columns: table => new
            {
                Id = table.Column<Guid>(nullable: false),
                UserId = table.Column<Guid>(nullable: false),
                ContactId = table.Column<Guid>(nullable: true),
                Direction = table.Column<int>(nullable: false),
                FromNumber = table.Column<string>(maxLength: 32, nullable: false),
                ToNumber = table.Column<string>(maxLength: 32, nullable: false),
                Body = table.Column<string>(maxLength: 1600, nullable: false),
                TwilioMessageSid = table.Column<string>(maxLength: 64, nullable: true),
                Status = table.Column<string>(maxLength: 32, nullable: false, defaultValue: "queued"),
                ErrorCode = table.Column<string>(maxLength: 32, nullable: true),
                CreatedAt = table.Column<DateTimeOffset>(nullable: false),
                UpdatedAt = table.Column<DateTimeOffset>(nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_SmsMessages", x => x.Id);
                table.ForeignKey("FK_SmsMessages_Users_UserId", x => x.UserId,
                    "Users", "Id", onDelete: ReferentialAction.Cascade);
                table.ForeignKey("FK_SmsMessages_Contacts_ContactId", x => x.ContactId,
                    "Contacts", "Id", onDelete: ReferentialAction.SetNull);
            });

        migrationBuilder.CreateTable(
            name: "DialerCampaigns",
            columns: table => new
            {
                Id = table.Column<Guid>(nullable: false),
                UserId = table.Column<Guid>(nullable: false),
                Name = table.Column<string>(maxLength: 200, nullable: false),
                Status = table.Column<string>(maxLength: 32, nullable: false, defaultValue: "idle"),
                DelayBetweenCallsSeconds = table.Column<int>(nullable: false, defaultValue: 5),
                CreatedAt = table.Column<DateTimeOffset>(nullable: false),
                CompletedAt = table.Column<DateTimeOffset>(nullable: true)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_DialerCampaigns", x => x.Id);
                table.ForeignKey("FK_DialerCampaigns_Users_UserId", x => x.UserId,
                    "Users", "Id", onDelete: ReferentialAction.Cascade);
            });

        migrationBuilder.CreateTable(
            name: "DialerEntries",
            columns: table => new
            {
                Id = table.Column<Guid>(nullable: false),
                CampaignId = table.Column<Guid>(nullable: false),
                Name = table.Column<string>(maxLength: 200, nullable: false),
                PhoneNumber = table.Column<string>(maxLength: 32, nullable: false),
                Status = table.Column<string>(maxLength: 32, nullable: false, defaultValue: "pending"),
                Position = table.Column<int>(nullable: false, defaultValue: 0),
                TwilioCallSid = table.Column<string>(maxLength: 64, nullable: true),
                DialedAt = table.Column<DateTimeOffset>(nullable: true)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_DialerEntries", x => x.Id);
                table.ForeignKey("FK_DialerEntries_DialerCampaigns_CampaignId", x => x.CampaignId,
                    "DialerCampaigns", "Id", onDelete: ReferentialAction.Cascade);
            });

        migrationBuilder.CreateIndex("IX_Users_Email", "Users", "Email", unique: true);
        migrationBuilder.CreateIndex("IX_Users_GoogleSubjectId", "Users", "GoogleSubjectId");
        migrationBuilder.CreateIndex("IX_TwilioCredentials_UserId", "TwilioCredentials", "UserId", unique: true);
        migrationBuilder.CreateIndex("IX_Contacts_UserId_PhoneNumber", "Contacts",
            new[] { "UserId", "PhoneNumber" }, unique: true);
        migrationBuilder.CreateIndex("IX_Contacts_UserId_IsFavorite", "Contacts",
            new[] { "UserId", "IsFavorite" });
        migrationBuilder.CreateIndex("IX_CallLogs_UserId_StartedAt", "CallLogs",
            new[] { "UserId", "StartedAt" });
        migrationBuilder.CreateIndex("IX_CallLogs_ContactId", "CallLogs", "ContactId");
        migrationBuilder.CreateIndex("IX_CallLogs_TwilioCallSid", "CallLogs", "TwilioCallSid", unique: true);
        migrationBuilder.CreateIndex("IX_SmsMessages_UserId_CreatedAt", "SmsMessages",
            new[] { "UserId", "CreatedAt" });
        migrationBuilder.CreateIndex("IX_SmsMessages_ContactId", "SmsMessages", "ContactId");
        migrationBuilder.CreateIndex("IX_SmsMessages_TwilioMessageSid", "SmsMessages",
            "TwilioMessageSid", unique: true);
        migrationBuilder.CreateIndex("IX_DialerCampaigns_UserId_Status", "DialerCampaigns",
            new[] { "UserId", "Status" });
        migrationBuilder.CreateIndex("IX_DialerEntries_CampaignId_Position", "DialerEntries",
            new[] { "CampaignId", "Position" });
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable("DialerEntries");
        migrationBuilder.DropTable("DialerCampaigns");
        migrationBuilder.DropTable("SmsMessages");
        migrationBuilder.DropTable("CallLogs");
        migrationBuilder.DropTable("Contacts");
        migrationBuilder.DropTable("TwilioCredentials");
        migrationBuilder.DropTable("Users");
    }
}
