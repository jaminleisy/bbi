using BenBotInventory.Server.Models;
using BenBotInventory.Server.Services;
using Microsoft.EntityFrameworkCore;

namespace BenBotInventory.Server.Data;

public static class DbSeeder
{
    public static async Task SeedAsync(AppDbContext db)
    {
        await db.Database.EnsureCreatedAsync();

        // Lightweight schema upgrades for existing databases (EnsureCreated does not alter tables)
        await db.Database.ExecuteSqlRawAsync(
            "IF COL_LENGTH('Parts', 'Notes') IS NULL ALTER TABLE Parts ADD Notes nvarchar(2000) NULL;");
        await db.Database.ExecuteSqlRawAsync(
            "IF COL_LENGTH('Parts', 'Merchant') IS NULL ALTER TABLE Parts ADD Merchant nvarchar(100) NULL;");
        await db.Database.ExecuteSqlRawAsync(
            "IF COL_LENGTH('Computers', 'IgnoreIncomplete') IS NULL ALTER TABLE Computers ADD IgnoreIncomplete bit NOT NULL CONSTRAINT DF_Computers_IgnoreIncomplete DEFAULT 0;");
        await db.Database.ExecuteSqlRawAsync(
            "IF COL_LENGTH('Payments', 'Fee') IS NULL ALTER TABLE Payments ADD Fee decimal(10,2) NULL;");
        await db.Database.ExecuteSqlRawAsync(
            "IF COL_LENGTH('Users', 'BuildAccess') IS NULL ALTER TABLE Users ADD BuildAccess nvarchar(500) NULL;");
        // Existing users default to full access (3); new rows should set PermissionLevel explicitly.
        await db.Database.ExecuteSqlRawAsync(@"
IF COL_LENGTH('Users', 'PermissionLevel') IS NULL
    ALTER TABLE Users ADD PermissionLevel int NOT NULL
        CONSTRAINT DF_Users_PermissionLevel DEFAULT 3;");
        await db.Database.ExecuteSqlRawAsync(
            "IF COL_LENGTH('Computers', 'BulkDesc') IS NULL ALTER TABLE Computers ADD BulkDesc nvarchar(500) NULL;");
        await db.Database.ExecuteSqlRawAsync(
            "IF COL_LENGTH('Computers', 'BulkCost') IS NULL ALTER TABLE Computers ADD BulkCost decimal(10,2) NULL;");
        await db.Database.ExecuteSqlRawAsync(
            "IF COL_LENGTH('Parts', 'Bad') IS NULL ALTER TABLE Parts ADD Bad int NULL;");
        await db.Database.ExecuteSqlRawAsync(
            "IF COL_LENGTH('Parts', 'Scam') IS NULL ALTER TABLE Parts ADD Scam int NULL;");
        await db.Database.ExecuteSqlRawAsync(
            "IF COL_LENGTH('Parts', 'Lost') IS NULL ALTER TABLE Parts ADD Lost int NULL;");

        // Wages table (EnsureCreated does not add new tables to existing DBs)
        await db.Database.ExecuteSqlRawAsync(@"
IF OBJECT_ID(N'dbo.Wages', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Wages (
        Id int NOT NULL IDENTITY(1,1) CONSTRAINT PK_Wages PRIMARY KEY,
        BuilderUserId nvarchar(50) NOT NULL,
        ComputerId int NULL,
        Amount decimal(10,2) NOT NULL,
        PaidDate datetime2 NULL,
        PaidMethod nvarchar(50) NULL,
        Notes nvarchar(2000) NULL,
        CONSTRAINT FK_Wages_Users_BuilderUserId FOREIGN KEY (BuilderUserId)
            REFERENCES dbo.Users (Id) ON DELETE NO ACTION,
        CONSTRAINT FK_Wages_Computers_ComputerId FOREIGN KEY (ComputerId)
            REFERENCES dbo.Computers (Id) ON DELETE SET NULL
    );
    CREATE INDEX IX_Wages_BuilderUserId ON dbo.Wages (BuilderUserId);
    CREATE INDEX IX_Wages_ComputerId ON dbo.Wages (ComputerId);
END
");
        await db.Database.ExecuteSqlRawAsync(@"
IF OBJECT_ID(N'dbo.Wages', N'U') IS NOT NULL AND COL_LENGTH('Wages', 'ComputerId') IS NULL
BEGIN
    ALTER TABLE dbo.Wages ADD ComputerId int NULL;
    ALTER TABLE dbo.Wages ADD CONSTRAINT FK_Wages_Computers_ComputerId
        FOREIGN KEY (ComputerId) REFERENCES dbo.Computers (Id) ON DELETE SET NULL;
    CREATE INDEX IX_Wages_ComputerId ON dbo.Wages (ComputerId);
END
");

        // ComputerShares table (advisory profit-split percentages)
        await db.Database.ExecuteSqlRawAsync(@"
IF OBJECT_ID(N'dbo.ComputerShares', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ComputerShares (
        Id int NOT NULL IDENTITY(1,1) CONSTRAINT PK_ComputerShares PRIMARY KEY,
        ComputerId int NOT NULL,
        BuilderUserId nvarchar(50) NOT NULL,
        Percentage decimal(5,2) NOT NULL,
        CONSTRAINT FK_ComputerShares_Computers_ComputerId FOREIGN KEY (ComputerId)
            REFERENCES dbo.Computers (Id) ON DELETE CASCADE,
        CONSTRAINT FK_ComputerShares_Users_BuilderUserId FOREIGN KEY (BuilderUserId)
            REFERENCES dbo.Users (Id) ON DELETE NO ACTION
    );
    CREATE INDEX IX_ComputerShares_ComputerId ON dbo.ComputerShares (ComputerId);
    CREATE INDEX IX_ComputerShares_BuilderUserId ON dbo.ComputerShares (BuilderUserId);
END
");

        // BuildNotes table (per-user notes on the lower-permission Builds page)
        await db.Database.ExecuteSqlRawAsync(@"
IF OBJECT_ID(N'dbo.BuildNotes', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.BuildNotes (
        Id int NOT NULL IDENTITY(1,1) CONSTRAINT PK_BuildNotes PRIMARY KEY,
        ComputerId int NOT NULL,
        UserId nvarchar(50) NOT NULL,
        Text nvarchar(2000) NOT NULL,
        CreatedDate datetime2 NOT NULL,
        CONSTRAINT FK_BuildNotes_Computers_ComputerId FOREIGN KEY (ComputerId)
            REFERENCES dbo.Computers (Id) ON DELETE CASCADE,
        CONSTRAINT FK_BuildNotes_Users_UserId FOREIGN KEY (UserId)
            REFERENCES dbo.Users (Id) ON DELETE NO ACTION
    );
    CREATE INDEX IX_BuildNotes_ComputerId ON dbo.BuildNotes (ComputerId);
    CREATE INDEX IX_BuildNotes_UserId ON dbo.BuildNotes (UserId);
END
");

        // Planned-part placeholders (custom text slots — not inventory Parts)
        await db.Database.ExecuteSqlRawAsync(@"
IF OBJECT_ID(N'dbo.PartPlaceholders', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.PartPlaceholders (
        Id int NOT NULL IDENTITY(1,1) CONSTRAINT PK_PartPlaceholders PRIMARY KEY,
        ComputerId int NOT NULL,
        Type nvarchar(50) NOT NULL,
        Description nvarchar(200) NOT NULL,
        CONSTRAINT FK_PartPlaceholders_Computers_ComputerId FOREIGN KEY (ComputerId)
            REFERENCES dbo.Computers (Id) ON DELETE CASCADE,
        CONSTRAINT FK_PartPlaceholders_PartTypes_Type FOREIGN KEY (Type)
            REFERENCES dbo.PartTypes (Type) ON DELETE NO ACTION
    );
    CREATE INDEX IX_PartPlaceholders_ComputerId ON dbo.PartPlaceholders (ComputerId);
    CREATE INDEX IX_PartPlaceholders_Type ON dbo.PartPlaceholders (Type);
END
");

        // Part photos for check-off workflow
        await db.Database.ExecuteSqlRawAsync(@"
IF OBJECT_ID(N'dbo.PartImages', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.PartImages (
        Id int NOT NULL IDENTITY(1,1) CONSTRAINT PK_PartImages PRIMARY KEY,
        PartId int NOT NULL,
        ContentType nvarchar(100) NOT NULL,
        Data varbinary(max) NOT NULL,
        CreatedDate datetime2 NOT NULL,
        CreatedUserId nvarchar(50) NULL,
        CONSTRAINT FK_PartImages_Parts_PartId FOREIGN KEY (PartId)
            REFERENCES dbo.Parts (Id) ON DELETE CASCADE
    );
    CREATE INDEX IX_PartImages_PartId ON dbo.PartImages (PartId);
END
");

        // Part image provenance (import / receiving / testing)
        await db.Database.ExecuteSqlRawAsync(@"
IF COL_LENGTH(N'dbo.PartImages', N'Source') IS NULL
    ALTER TABLE dbo.PartImages ADD Source nvarchar(20) NULL;
");

        // Messenger bridge tables (see /messenger-extension)
        await db.Database.ExecuteSqlRawAsync(@"
IF OBJECT_ID(N'dbo.MessengerThreads', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.MessengerThreads (
        Id int NOT NULL IDENTITY(1,1) CONSTRAINT PK_MessengerThreads PRIMARY KEY,
        FbThreadId nvarchar(100) NOT NULL,
        CounterpartyName nvarchar(200) NULL,
        CounterpartyUrl nvarchar(500) NULL,
        ListingTitle nvarchar(300) NULL,
        ListingUrl nvarchar(500) NULL,
        ComputerId int NULL,
        LastMessageDate datetime2 NULL,
        CreatedDate datetime2 NOT NULL CONSTRAINT DF_MessengerThreads_CreatedDate DEFAULT SYSUTCDATETIME(),
        Unread bit NOT NULL CONSTRAINT DF_MessengerThreads_Unread DEFAULT 0,
        CONSTRAINT FK_MessengerThreads_Computers_ComputerId FOREIGN KEY (ComputerId)
            REFERENCES dbo.Computers (Id) ON DELETE SET NULL
    );
    CREATE UNIQUE INDEX IX_MessengerThreads_FbThreadId ON dbo.MessengerThreads (FbThreadId);
    CREATE INDEX IX_MessengerThreads_ComputerId ON dbo.MessengerThreads (ComputerId);
END
");
        await db.Database.ExecuteSqlRawAsync(@"
IF OBJECT_ID(N'dbo.MessengerMessages', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.MessengerMessages (
        Id int NOT NULL IDENTITY(1,1) CONSTRAINT PK_MessengerMessages PRIMARY KEY,
        ThreadId int NOT NULL,
        ExternalId nvarchar(200) NOT NULL,
        Direction nvarchar(10) NOT NULL,
        SenderName nvarchar(200) NULL,
        Text nvarchar(max) NOT NULL,
        Timestamp datetime2 NOT NULL,
        CreatedDate datetime2 NOT NULL CONSTRAINT DF_MessengerMessages_CreatedDate DEFAULT SYSUTCDATETIME(),
        RawJson nvarchar(max) NULL,
        CONSTRAINT FK_MessengerMessages_Threads_ThreadId FOREIGN KEY (ThreadId)
            REFERENCES dbo.MessengerThreads (Id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IX_MessengerMessages_Thread_External ON dbo.MessengerMessages (ThreadId, ExternalId);
    CREATE INDEX IX_MessengerMessages_Timestamp ON dbo.MessengerMessages (Timestamp);
END
");
        await db.Database.ExecuteSqlRawAsync(@"
IF OBJECT_ID(N'dbo.MessengerOutbox', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.MessengerOutbox (
        Id int NOT NULL IDENTITY(1,1) CONSTRAINT PK_MessengerOutbox PRIMARY KEY,
        ThreadId int NOT NULL,
        Text nvarchar(max) NOT NULL,
        Status nvarchar(20) NOT NULL CONSTRAINT DF_MessengerOutbox_Status DEFAULT N'pending',
        Attempts int NOT NULL CONSTRAINT DF_MessengerOutbox_Attempts DEFAULT 0,
        Error nvarchar(1000) NULL,
        QueuedByUserId nvarchar(50) NULL,
        RuleId int NULL,
        CreatedDate datetime2 NOT NULL CONSTRAINT DF_MessengerOutbox_CreatedDate DEFAULT SYSUTCDATETIME(),
        SentDate datetime2 NULL,
        CONSTRAINT FK_MessengerOutbox_Threads_ThreadId FOREIGN KEY (ThreadId)
            REFERENCES dbo.MessengerThreads (Id) ON DELETE CASCADE
    );
    CREATE INDEX IX_MessengerOutbox_Status ON dbo.MessengerOutbox (Status);
END
");
        // RuleId column added after initial deploy — idempotent add.
        await db.Database.ExecuteSqlRawAsync(@"
IF OBJECT_ID(N'dbo.MessengerOutbox', N'U') IS NOT NULL AND COL_LENGTH('MessengerOutbox', 'RuleId') IS NULL
    ALTER TABLE dbo.MessengerOutbox ADD RuleId int NULL;
");

        // Auto-responder rules
        await db.Database.ExecuteSqlRawAsync(@"
IF OBJECT_ID(N'dbo.MessengerRules', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.MessengerRules (
        Id int NOT NULL IDENTITY(1,1) CONSTRAINT PK_MessengerRules PRIMARY KEY,
        Name nvarchar(100) NOT NULL,
        Enabled bit NOT NULL CONSTRAINT DF_MessengerRules_Enabled DEFAULT 1,
        MatchType nvarchar(20) NOT NULL CONSTRAINT DF_MessengerRules_MatchType DEFAULT N'contains',
        MatchText nvarchar(500) NULL,
        ResponseText nvarchar(4000) NOT NULL,
        OrderIndex int NOT NULL CONSTRAINT DF_MessengerRules_OrderIndex DEFAULT 0,
        CooldownMinutes int NOT NULL CONSTRAINT DF_MessengerRules_Cooldown DEFAULT 30,
        RequireLinkedBuild bit NOT NULL CONSTRAINT DF_MessengerRules_RequireLinkedBuild DEFAULT 0,
        CreatedDate datetime2 NOT NULL CONSTRAINT DF_MessengerRules_CreatedDate DEFAULT SYSUTCDATETIME(),
        LastFiredDate datetime2 NULL
    );
    CREATE INDEX IX_MessengerRules_OrderIndex ON dbo.MessengerRules (OrderIndex);
END
");

        // FK from MessengerOutbox.RuleId → MessengerRules.Id (added lazily so
        // existing databases with the outbox but no rules table get patched).
        await db.Database.ExecuteSqlRawAsync(@"
IF OBJECT_ID(N'dbo.MessengerRules', N'U') IS NOT NULL
   AND OBJECT_ID(N'dbo.MessengerOutbox', N'U') IS NOT NULL
   AND COL_LENGTH('MessengerOutbox', 'RuleId') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_MessengerOutbox_Rules_RuleId')
BEGIN
    ALTER TABLE dbo.MessengerOutbox
        ADD CONSTRAINT FK_MessengerOutbox_Rules_RuleId
            FOREIGN KEY (RuleId) REFERENCES dbo.MessengerRules (Id) ON DELETE SET NULL;
END
");

        await db.Database.ExecuteSqlRawAsync(@"
IF OBJECT_ID(N'dbo.MessengerMessages', N'U') IS NOT NULL AND COL_LENGTH('MessengerMessages', 'MediaUrl') IS NULL
    ALTER TABLE dbo.MessengerMessages ADD MediaUrl nvarchar(1000) NULL;
");

        // Message attachments (photos etc.)
        await db.Database.ExecuteSqlRawAsync(@"
IF OBJECT_ID(N'dbo.MessengerAttachments', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.MessengerAttachments (
        Id int NOT NULL IDENTITY(1,1) CONSTRAINT PK_MessengerAttachments PRIMARY KEY,
        MessageId int NOT NULL,
        ContentType nvarchar(100) NOT NULL,
        Data varbinary(max) NOT NULL,
        SourceUrl nvarchar(1000) NULL,
        Width int NULL,
        Height int NULL,
        CreatedDate datetime2 NOT NULL CONSTRAINT DF_MessengerAttachments_CreatedDate DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_MessengerAttachments_Messages_MessageId FOREIGN KEY (MessageId)
            REFERENCES dbo.MessengerMessages (Id) ON DELETE CASCADE
    );
    CREATE INDEX IX_MessengerAttachments_MessageId ON dbo.MessengerAttachments (MessageId);
END
");

        // Performance indexes for list filters / joins (idempotent).
        await db.Database.ExecuteSqlRawAsync(@"
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Computers_Type_Status' AND object_id = OBJECT_ID(N'dbo.Computers'))
    CREATE INDEX IX_Computers_Type_Status ON dbo.Computers (Type, Status);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Computers_Status_SoldDate' AND object_id = OBJECT_ID(N'dbo.Computers'))
    CREATE INDEX IX_Computers_Status_SoldDate ON dbo.Computers (Status, SoldDate);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Computers_BuilderUserId' AND object_id = OBJECT_ID(N'dbo.Computers'))
    CREATE INDEX IX_Computers_BuilderUserId ON dbo.Computers (BuilderUserId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Parts_ComputerId' AND object_id = OBJECT_ID(N'dbo.Parts'))
    CREATE INDEX IX_Parts_ComputerId ON dbo.Parts (ComputerId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Parts_Type_Manufacturer_Model' AND object_id = OBJECT_ID(N'dbo.Parts'))
    CREATE INDEX IX_Parts_Type_Manufacturer_Model ON dbo.Parts (Type, Manufacturer, ModelNumber);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Payments_ComputerId' AND object_id = OBJECT_ID(N'dbo.Payments'))
    CREATE INDEX IX_Payments_ComputerId ON dbo.Payments (ComputerId);
");

        // One-time status casing migration: lowercase legacy values -> Proper case.
        // Also migrate the old 'built' mapping for personal (M) rows that were
        // imported before the Personal status existed is intentionally NOT done
        // here - those stay Built until re-imported.
        await db.Database.ExecuteSqlRawAsync(@"
            UPDATE Computers SET Status = 'Planned'      WHERE Status = 'planned';
            UPDATE Computers SET Status = 'In-progress'  WHERE Status = 'in-progress';
            UPDATE Computers SET Status = 'Built'        WHERE Status = 'built';
            UPDATE Computers SET Status = 'Active'       WHERE Status = 'listed' OR Status = 'Listed';
            UPDATE Computers SET Status = 'Sold'         WHERE Status = 'sold';
            UPDATE Computers SET Status = 'Returned'     WHERE Status = 'returned';
            UPDATE Computers SET Status = 'Needs repair' WHERE Status = 'needs repair';
            UPDATE Computers SET Status = 'Traded'       WHERE Status = 'traded';
            UPDATE Computers SET Status = 'Personal'     WHERE Status = 'personal';
        ");

        // Part types with required flag
        var types = new (string Type, bool Required)[]
        {
            ("case", true), ("psu", true), ("gpu", true), ("mobo", true),
            ("cpu", true), ("cpuCooler", true), ("storage", true), ("ram", true),
            ("fan", false), ("psuCable", false), ("gpuSupport", false),
            ("monitor", false), ("keyboard", false), ("mouse", false),
            ("pcie wifi", false), ("usb wifi", false), ("usb bluetooth", false),
            ("winkey", false), ("gpuVerticalBracket", false), ("adapter", false),
            ("rgbController", false), ("misc", false)
        };
        foreach (var (type, required) in types)
        {
            if (!await db.PartTypes.AnyAsync(t => t.Type == type))
                db.PartTypes.Add(new PartType { Type = type, Required = required });
        }

        // Conditions (Proper-cased). Migrate any legacy lowercase lookup/part values.
        // Must use a case-sensitive collation: the default CI collation treats
        // 'new' and 'New' as equal, so deleting legacy lowercase rows would also
        // wipe the Proper-cased lookup values.
        await db.Database.ExecuteSqlRawAsync(@"
            IF NOT EXISTS (SELECT 1 FROM Conditions WHERE Name COLLATE Latin1_General_CS_AS = N'New')
                INSERT INTO Conditions (Name) VALUES (N'New');
            IF NOT EXISTS (SELECT 1 FROM Conditions WHERE Name COLLATE Latin1_General_CS_AS = N'Used')
                INSERT INTO Conditions (Name) VALUES (N'Used');
            IF NOT EXISTS (SELECT 1 FROM Conditions WHERE Name COLLATE Latin1_General_CS_AS = N'As-is')
                INSERT INTO Conditions (Name) VALUES (N'As-is');
            UPDATE Parts SET Condition = N'New'   WHERE Condition COLLATE Latin1_General_CS_AS = N'new';
            UPDATE Parts SET Condition = N'Used'  WHERE Condition COLLATE Latin1_General_CS_AS = N'used';
            UPDATE Parts SET Condition = N'As-is' WHERE Condition COLLATE Latin1_General_CS_AS = N'as-is';
            DELETE FROM Conditions WHERE Name COLLATE Latin1_General_CS_AS IN (N'new', N'used', N'as-is');
        ");

        // Sellers
        foreach (var s in new[] { "Amazon", "Newegg", "eBay", "Facebook Marketplace", "Micro Center", "Best Buy", "AliExpress", "Woot", "Local", "Other" })
        {
            if (!await db.Sellers.AnyAsync(x => x.Name == s))
                db.Sellers.Add(new Seller { Name = s });
        }

        // CPU sockets
        foreach (var s in new[] { "AM4", "AM5", "LGA1151", "LGA1200", "LGA1700", "Other" })
        {
            if (!await db.CpuSockets.AnyAsync(x => x.Name == s))
                db.CpuSockets.Add(new CpuSocket { Name = s });
        }

        // PCIe gens
        foreach (var s in new[] { "3.0", "4.0", "5.0" })
        {
            if (!await db.PcieGens.AnyAsync(x => x.Name == s))
                db.PcieGens.Add(new PcieGen { Name = s });
        }

        // RAM types
        foreach (var s in new[] { "DDR3", "DDR4", "DDR5" })
        {
            if (!await db.RamTypes.AnyAsync(x => x.Name == s))
                db.RamTypes.Add(new RamType { Name = s });
        }

        // Locations
        foreach (var s in new[] { "Ben", "Josh" })
        {
            if (!await db.Locations.AnyAsync(x => x.Name == s))
                db.Locations.Add(new Location { Name = s });
        }

        // Default admin user (id: admin / password: admin) - change after first login!
        if (!await db.Users.AnyAsync())
        {
            db.Users.Add(new User
            {
                Id = "admin",
                Name = "Administrator",
                PasswordHash = PasswordHasher.Hash("admin"),
                PermissionLevel = 3,
                BuildAccess = "All"
            });
        }
        else
        {
            // Ensure the seeded admin account stays at full access.
            var admin = await db.Users.FirstOrDefaultAsync(u => u.Id == "admin");
            if (admin is not null && admin.PermissionLevel < 3)
                admin.PermissionLevel = 3;
        }

        await db.SaveChangesAsync();
    }
}
