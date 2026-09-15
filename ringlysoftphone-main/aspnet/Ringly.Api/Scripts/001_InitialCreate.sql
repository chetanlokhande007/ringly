-- ============================================================================
-- Ringly Softphone — initial schema (SQL Server / T-SQL)
-- Equivalent of Migrations/20260729000000_InitialCreate.cs for teams that
-- prefer to apply raw SQL (dotnet ef migrations script > this file).
-- For PostgreSQL: swap UNIQUEIDENTIFIER -> uuid, NVARCHAR -> varchar,
-- DATETIMEOFFSET -> timestamptz, BIT -> boolean.
-- ============================================================================

CREATE TABLE Users (
    Id               UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_Users PRIMARY KEY,
    Email            NVARCHAR(256)    NOT NULL,
    FullName         NVARCHAR(200)    NULL,
    PasswordHash     NVARCHAR(512)    NULL,
    GoogleSubjectId  NVARCHAR(128)    NULL,
    AvatarUrl        NVARCHAR(512)    NULL,
    CreatedAt        DATETIMEOFFSET   NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    UpdatedAt        DATETIMEOFFSET   NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
CREATE UNIQUE INDEX IX_Users_Email ON Users (Email);
CREATE INDEX IX_Users_GoogleSubjectId ON Users (GoogleSubjectId);

CREATE TABLE TwilioCredentials (
    Id                  UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_TwilioCredentials PRIMARY KEY,
    UserId              UNIQUEIDENTIFIER NOT NULL,
    AccountSid          NVARCHAR(64)     NOT NULL,
    AuthTokenCipher     NVARCHAR(2048)   NULL,
    ApiKeySid           NVARCHAR(64)     NULL,
    ApiKeySecretCipher  NVARCHAR(2048)   NULL,
    TwimlAppSid         NVARCHAR(64)     NULL,
    Identity            NVARCHAR(128)    NOT NULL DEFAULT 'CTMS',
    CallerId            NVARCHAR(32)     NULL,
    Region              NVARCHAR(32)     NOT NULL DEFAULT 'US1',
    IsVerified          BIT              NOT NULL DEFAULT 0,
    LastTestedAt        DATETIMEOFFSET   NULL,
    LastTestResult      NVARCHAR(512)    NULL,
    CreatedAt           DATETIMEOFFSET   NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    UpdatedAt           DATETIMEOFFSET   NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT FK_TwilioCredentials_Users_UserId FOREIGN KEY (UserId)
        REFERENCES Users (Id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IX_TwilioCredentials_UserId ON TwilioCredentials (UserId);

CREATE TABLE Contacts (
    Id           UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_Contacts PRIMARY KEY,
    UserId       UNIQUEIDENTIFIER NOT NULL,
    Name         NVARCHAR(200)    NOT NULL,
    PhoneNumber  NVARCHAR(32)     NOT NULL,
    Email        NVARCHAR(256)    NULL,
    Company      NVARCHAR(200)    NULL,
    IsFavorite   BIT              NOT NULL DEFAULT 0,
    Notes        NVARCHAR(1000)   NULL,
    CreatedAt    DATETIMEOFFSET   NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    UpdatedAt    DATETIMEOFFSET   NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT FK_Contacts_Users_UserId FOREIGN KEY (UserId)
        REFERENCES Users (Id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IX_Contacts_UserId_PhoneNumber ON Contacts (UserId, PhoneNumber);
CREATE INDEX IX_Contacts_UserId_IsFavorite ON Contacts (UserId, IsFavorite);

CREATE TABLE CallLogs (
    Id               UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_CallLogs PRIMARY KEY,
    UserId           UNIQUEIDENTIFIER NOT NULL,
    ContactId        UNIQUEIDENTIFIER NULL,
    Direction        INT              NOT NULL, -- 0 outbound, 1 inbound, 2 missed
    FromNumber       NVARCHAR(32)     NULL,
    ToNumber         NVARCHAR(32)     NOT NULL,
    TwilioCallSid    NVARCHAR(64)     NULL,
    Status           NVARCHAR(32)     NOT NULL DEFAULT 'queued',
    DurationSeconds  INT              NOT NULL DEFAULT 0,
    RecordingUrl     NVARCHAR(512)    NULL,
    Notes            NVARCHAR(1000)   NULL,
    StartedAt        DATETIMEOFFSET   NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    EndedAt          DATETIMEOFFSET   NULL,
    CONSTRAINT FK_CallLogs_Users_UserId FOREIGN KEY (UserId)
        REFERENCES Users (Id) ON DELETE CASCADE,
    CONSTRAINT FK_CallLogs_Contacts_ContactId FOREIGN KEY (ContactId)
        REFERENCES Contacts (Id) ON DELETE SET NULL
);
CREATE INDEX IX_CallLogs_UserId_StartedAt ON CallLogs (UserId, StartedAt);
CREATE INDEX IX_CallLogs_ContactId ON CallLogs (ContactId);
CREATE UNIQUE INDEX IX_CallLogs_TwilioCallSid ON CallLogs (TwilioCallSid) WHERE TwilioCallSid IS NOT NULL;

CREATE TABLE SmsMessages (
    Id                UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_SmsMessages PRIMARY KEY,
    UserId            UNIQUEIDENTIFIER NOT NULL,
    ContactId         UNIQUEIDENTIFIER NULL,
    Direction         INT              NOT NULL, -- 0 outbound, 1 inbound
    FromNumber        NVARCHAR(32)     NOT NULL,
    ToNumber          NVARCHAR(32)     NOT NULL,
    Body              NVARCHAR(1600)   NOT NULL,
    TwilioMessageSid  NVARCHAR(64)     NULL,
    Status            NVARCHAR(32)     NOT NULL DEFAULT 'queued',
    ErrorCode         NVARCHAR(32)     NULL,
    CreatedAt         DATETIMEOFFSET   NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    UpdatedAt         DATETIMEOFFSET   NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT FK_SmsMessages_Users_UserId FOREIGN KEY (UserId)
        REFERENCES Users (Id) ON DELETE CASCADE,
    CONSTRAINT FK_SmsMessages_Contacts_ContactId FOREIGN KEY (ContactId)
        REFERENCES Contacts (Id) ON DELETE SET NULL
);
CREATE INDEX IX_SmsMessages_UserId_CreatedAt ON SmsMessages (UserId, CreatedAt);
CREATE INDEX IX_SmsMessages_ContactId ON SmsMessages (ContactId);
CREATE UNIQUE INDEX IX_SmsMessages_TwilioMessageSid ON SmsMessages (TwilioMessageSid) WHERE TwilioMessageSid IS NOT NULL;

CREATE TABLE DialerCampaigns (
    Id                        UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_DialerCampaigns PRIMARY KEY,
    UserId                    UNIQUEIDENTIFIER NOT NULL,
    Name                      NVARCHAR(200)    NOT NULL,
    Status                    NVARCHAR(32)     NOT NULL DEFAULT 'idle',
    DelayBetweenCallsSeconds  INT              NOT NULL DEFAULT 5,
    CreatedAt                 DATETIMEOFFSET   NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CompletedAt               DATETIMEOFFSET   NULL,
    CONSTRAINT FK_DialerCampaigns_Users_UserId FOREIGN KEY (UserId)
        REFERENCES Users (Id) ON DELETE CASCADE
);
CREATE INDEX IX_DialerCampaigns_UserId_Status ON DialerCampaigns (UserId, Status);

CREATE TABLE DialerEntries (
    Id             UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_DialerEntries PRIMARY KEY,
    CampaignId     UNIQUEIDENTIFIER NOT NULL,
    Name           NVARCHAR(200)    NOT NULL,
    PhoneNumber    NVARCHAR(32)     NOT NULL,
    Status         NVARCHAR(32)     NOT NULL DEFAULT 'pending',
    Position       INT              NOT NULL DEFAULT 0,
    TwilioCallSid  NVARCHAR(64)     NULL,
    DialedAt       DATETIMEOFFSET   NULL,
    CONSTRAINT FK_DialerEntries_DialerCampaigns_CampaignId FOREIGN KEY (CampaignId)
        REFERENCES DialerCampaigns (Id) ON DELETE CASCADE
);
CREATE INDEX IX_DialerEntries_CampaignId_Position ON DialerEntries (CampaignId, Position);
