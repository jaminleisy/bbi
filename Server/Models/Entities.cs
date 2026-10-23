using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json.Serialization;

namespace BenBotInventory.Server.Models;

// ---------- Users ----------
public class User
{
    [Key]
    [MaxLength(50)]
    public string Id { get; set; } = null!;

    [MaxLength(100)]
    public string Name { get; set; } = null!;

    [JsonIgnore]
    [MaxLength(200)]
    public string PasswordHash { get; set; } = null!;

    /// <summary>
    /// Comma-separated builder names/ids, "Unassigned" for builds with no
    /// builder, or "All" for every build. Determines which builds this user
    /// can view on the lower-permission Builds page (matched against
    /// Computer.BuilderUserId).
    /// </summary>
    [MaxLength(500)]
    public string? BuildAccess { get; set; }

    /// <summary>
    /// 1 = Builds only; 2 = Builds + Computers/Parts view + edit computers;
    /// 3 = full access including edit parts and user administration.
    /// </summary>
    public int PermissionLevel { get; set; } = 1;
}

// ---------- String lookup tables (string primary keys, no int ids) ----------
public class PartType
{
    [Key]
    [MaxLength(50)]
    public string Type { get; set; } = null!;

    public bool Required { get; set; }
}

public class Seller
{
    [Key]
    [MaxLength(100)]
    public string Name { get; set; } = null!;
}

public class CpuSocket
{
    [Key]
    [MaxLength(50)]
    public string Name { get; set; } = null!;
}

public class PcieGen
{
    [Key]
    [MaxLength(50)]
    public string Name { get; set; } = null!;
}

public class RamType
{
    [Key]
    [MaxLength(50)]
    public string Name { get; set; } = null!;
}

public class Location
{
    [Key]
    [MaxLength(100)]
    public string Name { get; set; } = null!;
}

public class Condition
{
    [Key]
    [MaxLength(50)]
    public string Name { get; set; } = null!;
}

// ---------- Parts ----------
public class Part
{
    public int Id { get; set; }

    [MaxLength(50)]
    public string Type { get; set; } = null!;

    [MaxLength(100)]
    public string? Manufacturer { get; set; }

    [MaxLength(100)]
    public string? ModelNumber { get; set; }

    [Column(TypeName = "decimal(10,2)")]
    public decimal? Cost { get; set; }

    public DateTime? OrderDate { get; set; }

    [MaxLength(500)]
    public string? OrderUrl { get; set; }

    [MaxLength(100)]
    public string? Seller { get; set; }

    [MaxLength(50)]
    public string? Color { get; set; }

    public bool HasRgb { get; set; }

    [MaxLength(50)]
    public string? CpuSocket { get; set; }

    [MaxLength(50)]
    public string? PcieGen { get; set; }

    [MaxLength(50)]
    public string? RamType { get; set; }

    [MaxLength(100)]
    public string? Location { get; set; }

    public bool Received { get; set; }

    public DateTime? TestedDate { get; set; }

    [MaxLength(50)]
    public string? TestedUserId { get; set; }

    [MaxLength(50)]
    public string? Condition { get; set; }

    public DateTime? ReturnByDate { get; set; }

    [MaxLength(100)]
    public string? Merchant { get; set; }

    [MaxLength(2000)]
    public string? Notes { get; set; }

    /// <summary>0/null = ok, 1 = possibly bad, 2 = confirmed bad.</summary>
    public int? Bad { get; set; }

    /// <summary>0/null = ok, 1 = possibly scam, 2 = confirmed scam.</summary>
    public int? Scam { get; set; }

    /// <summary>0/null = ok, 1 = possibly lost, 2 = confirmed lost.</summary>
    public int? Lost { get; set; }

    // A part may belong to at most one computer

    public int? ComputerId { get; set; }

    [JsonIgnore]
    public Computer? Computer { get; set; }

    [JsonIgnore]
    public List<PartImage> Images { get; set; } = new();
}

/// <summary>Photo attached to a part (stored in the database).</summary>
public class PartImage
{
    public int Id { get; set; }

    public int PartId { get; set; }

    [JsonIgnore]
    public Part? Part { get; set; }

    [MaxLength(100)]
    public string ContentType { get; set; } = "image/jpeg";

    /// <summary>Raw image bytes.</summary>
    [JsonIgnore]
    public byte[] Data { get; set; } = Array.Empty<byte>();

    /// <summary>How the photo was added: import | receiving | testing.</summary>
    [MaxLength(20)]
    public string? Source { get; set; }

    public DateTime CreatedDate { get; set; } = DateTime.UtcNow;

    [MaxLength(50)]
    public string? CreatedUserId { get; set; }
}

// ---------- Computers (builds) ----------
public class Computer
{
    public int Id { get; set; }

    [MaxLength(200)]
    public string Name { get; set; } = null!;

    [MaxLength(2000)]
    public string? Description { get; set; }

    /// <summary>"PC" or "Parts"</summary>
    [MaxLength(20)]
    public string Type { get; set; } = "PC";

    /// <summary>Planned, In-progress, Built, Active, Sold, Returned, Needs repair, Traded, Personal</summary>
    [MaxLength(30)]
    public string Status { get; set; } = "Planned";

    public DateTime AddedDate { get; set; } = DateTime.UtcNow;

    [MaxLength(50)]
    public string? AddedUserId { get; set; }

    [MaxLength(50)]
    public string? BuilderUserId { get; set; }

    [MaxLength(100)]
    public string? Location { get; set; }

    /// <summary>
    /// When true, the UI suppresses the "missing required parts" warning for this computer.
    /// </summary>
    public bool IgnoreIncomplete { get; set; }

    /// <summary>
    /// Sale / estimated sale price including tax (spreadsheet Expected/Actual Sell).
    /// Pretax revenue is Price − Tax.
    /// </summary>
    [Column(TypeName = "decimal(10,2)")]
    public decimal? Price { get; set; }

    /// <summary>Tax portion included in <see cref="Price"/> (not added on top).</summary>
    [Column(TypeName = "decimal(10,2)")]
    public decimal? Tax { get; set; }

    [Column(TypeName = "decimal(10,2)")]
    public decimal? OriginalPrice { get; set; }

    /// <summary>Bulk / misc purchases description (spreadsheet Misc 3 text).</summary>
    [MaxLength(500)]
    public string? BulkDesc { get; set; }

    /// <summary>
    /// Bulk / misc cost amount. Included in PartsCost for profit calculations.
    /// </summary>
    [Column(TypeName = "decimal(10,2)")]
    public decimal? BulkCost { get; set; }

    public DateTime? SoldDate { get; set; }

    [MaxLength(200)]
    public string? CustomerName { get; set; }

    [MaxLength(500)]
    public string? CustomerUrl { get; set; }

    [MaxLength(500)]
    public string? ConversationUrl { get; set; }

    [MaxLength(2000)]
    public string? CustomerInfo { get; set; }

    [MaxLength(200)]
    public string? CustomerAddress1 { get; set; }

    [MaxLength(200)]
    public string? CustomerAddress2 { get; set; }

    [MaxLength(100)]
    public string? CustomerCity { get; set; }

    [MaxLength(50)]
    public string? CustomerState { get; set; }

    [MaxLength(20)]
    public string? CustomerZip { get; set; }

    [MaxLength(100)]
    public string? TrackingNumber { get; set; }

    [MaxLength(100)]
    public string? TrackingStatus { get; set; }

    [MaxLength(4000)]
    public string? Notes { get; set; }

    public DateTime? ExpectedCompletionDate { get; set; }

    public List<Part> Parts { get; set; } = new();

    public List<PartPlaceholder> Placeholders { get; set; } = new();

    public List<Payment> Payments { get; set; } = new();

    public List<Wage> Wages { get; set; } = new();

    public List<ComputerShare> Shares { get; set; } = new();

    public List<BuildNote> BuildNotes { get; set; } = new();
}

/// <summary>
/// Planned part slot with custom text — not inventory. Does not appear on the Parts page.
/// Counts toward missing-required completeness for its Type.
/// </summary>
public class PartPlaceholder
{
    public int Id { get; set; }

    public int ComputerId { get; set; }

    [JsonIgnore]
    public Computer? Computer { get; set; }

    [MaxLength(50)]
    public string Type { get; set; } = null!;

    [MaxLength(200)]
    public string Description { get; set; } = null!;
}

// ---------- Build notes (lower-permission Builds page) ----------
public class BuildNote
{
    public int Id { get; set; }

    public int ComputerId { get; set; }

    [JsonIgnore]
    public Computer? Computer { get; set; }

    [MaxLength(50)]
    public string UserId { get; set; } = null!;

    [MaxLength(2000)]
    public string Text { get; set; } = null!;

    public DateTime CreatedDate { get; set; } = DateTime.UtcNow;
}

// ---------- Payments ----------
public class Payment
{
    public int Id { get; set; }

    public int ComputerId { get; set; }

    [JsonIgnore]
    public Computer? Computer { get; set; }

    /// <summary>Full customer payment amount (tax-inclusive), matching Computer.Price.</summary>
    [Column(TypeName = "decimal(10,2)")]
    public decimal Amount { get; set; }

    /// <summary>Tax portion included in <see cref="Amount"/> (not added on top).</summary>
    [Column(TypeName = "decimal(10,2)")]
    public decimal? Tax { get; set; }

    /// <summary>Platform / processing fee associated with this payment (e.g. PayPal).</summary>
    [Column(TypeName = "decimal(10,2)")]
    public decimal? Fee { get; set; }

    [MaxLength(50)]
    public string? Method { get; set; }

    public DateTime Date { get; set; } = DateTime.UtcNow;

    [MaxLength(500)]
    public string? PaymentUrl { get; set; }

    /// <summary>"payment", "deposit", "refund"</summary>
    [MaxLength(20)]
    public string Type { get; set; } = "payment";
}

// ---------- Wages (builder payouts) ----------
public class Wage
{
    public int Id { get; set; }

    [MaxLength(50)]
    public string BuilderUserId { get; set; } = null!;

    public int? ComputerId { get; set; }

    [JsonIgnore]
    public Computer? Computer { get; set; }

    [Column(TypeName = "decimal(10,2)")]
    public decimal Amount { get; set; }

    public DateTime? PaidDate { get; set; }

    [MaxLength(50)]
    public string? PaidMethod { get; set; }

    [MaxLength(2000)]
    public string? Notes { get; set; }
}

// ---------- Computer shares (advisory profit-split percentages for wage entry) ----------
public class ComputerShare
{
    public int Id { get; set; }

    public int ComputerId { get; set; }

    [JsonIgnore]
    public Computer? Computer { get; set; }

    [MaxLength(50)]
    public string BuilderUserId { get; set; } = null!;

    /// <summary>Percent of share base (e.g. 25.50 = 25.5%).</summary>
    [Column(TypeName = "decimal(5,2)")]
    public decimal Percentage { get; set; }
}

// ---------- Messenger bridge (Facebook Marketplace conversations) ----------
// The Chrome extension (see /messenger-extension) scrapes messages from
// messenger.com and posts them to /api/messenger/ingest. Outbound replies
// are queued in MessengerOutbox and delivered to the extension via a poll.

/// <summary>One Facebook Messenger conversation (Marketplace or regular).</summary>
public class MessengerThread
{
    public int Id { get; set; }

    /// <summary>
    /// Facebook's internal thread id (the value in the messenger.com/t/{id} URL).
    /// Unique per conversation.
    /// </summary>
    [MaxLength(100)]
    public string FbThreadId { get; set; } = null!;

    /// <summary>Display name of the other party (buyer / seller / group name).</summary>
    [MaxLength(200)]
    public string? CounterpartyName { get; set; }

    /// <summary>Facebook profile URL of the counterparty, if scraped.</summary>
    [MaxLength(500)]
    public string? CounterpartyUrl { get; set; }

    /// <summary>Marketplace listing title shown at the top of the thread, if any.</summary>
    [MaxLength(300)]
    public string? ListingTitle { get; set; }

    /// <summary>Marketplace listing URL, if scraped.</summary>
    [MaxLength(500)]
    public string? ListingUrl { get; set; }

    /// <summary>Optional link to a build this conversation is about.</summary>
    public int? ComputerId { get; set; }

    [JsonIgnore]
    public Computer? Computer { get; set; }

    public DateTime? LastMessageDate { get; set; }

    public DateTime CreatedDate { get; set; } = DateTime.UtcNow;

    /// <summary>True until the newest incoming message has been marked read.</summary>
    public bool Unread { get; set; }

    [JsonIgnore]
    public List<MessengerMessage> Messages { get; set; } = new();
}

/// <summary>A single message inside a MessengerThread.</summary>
public class MessengerMessage
{
    public int Id { get; set; }

    public int ThreadId { get; set; }

    [JsonIgnore]
    public MessengerThread? Thread { get; set; }

    /// <summary>
    /// Facebook's internal message id if the extension could extract one
    /// (mid.$...); otherwise a stable client-generated hash of thread + timestamp
    /// + sender + text. Used for idempotent ingest.
    /// </summary>
    [MaxLength(200)]
    public string ExternalId { get; set; } = null!;

    /// <summary>"incoming" (from counterparty) or "outgoing" (sent by me).</summary>
    [MaxLength(10)]
    public string Direction { get; set; } = "incoming";

    [MaxLength(200)]
    public string? SenderName { get; set; }

    [MaxLength(8000)]
    public string Text { get; set; } = "";

    /// <summary>
    /// Facebook / CDN URL for a photo, GIF, or video when the scraper
    /// could see one. Encrypted chats often have no durable host URL.
    /// </summary>
    [MaxLength(1000)]
    public string? MediaUrl { get; set; }

    public DateTime Timestamp { get; set; }

    public DateTime CreatedDate { get; set; } = DateTime.UtcNow;

    /// <summary>Optional raw JSON blob the extension captured (quick replies, reactions, etc.).</summary>
    [MaxLength(4000)]
    public string? RawJson { get; set; }

    [JsonIgnore]
    public List<MessengerAttachment> Attachments { get; set; } = new();
}

/// <summary>Attachment (typically image) captured on an incoming message.</summary>
public class MessengerAttachment
{
    public int Id { get; set; }

    public int MessageId { get; set; }

    [JsonIgnore]
    public MessengerMessage? Message { get; set; }

    [MaxLength(100)]
    public string ContentType { get; set; } = "image/jpeg";

    [JsonIgnore]
    public byte[] Data { get; set; } = Array.Empty<byte>();

    /// <summary>Original CDN URL, kept for debugging even though the bytes are stored locally.</summary>
    [MaxLength(1000)]
    public string? SourceUrl { get; set; }

    public int? Width { get; set; }

    public int? Height { get; set; }

    public DateTime CreatedDate { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// Outbound reply queued by the app for the Chrome extension to send. The
/// extension polls GET /api/messenger/outbox for entries with Status=pending,
/// sends them, then POSTs to /api/messenger/outbox/{id}/ack.
/// </summary>
public class MessengerOutbox
{
    public int Id { get; set; }

    public int ThreadId { get; set; }

    [JsonIgnore]
    public MessengerThread? Thread { get; set; }

    [MaxLength(4000)]
    public string Text { get; set; } = "";

    /// <summary>"pending", "sending", "sent", "failed".</summary>
    [MaxLength(20)]
    public string Status { get; set; } = "pending";

    /// <summary>Attempt counter (extension increments on retry).</summary>
    public int Attempts { get; set; }

    /// <summary>Error message if Status = failed.</summary>
    [MaxLength(1000)]
    public string? Error { get; set; }

    /// <summary>Who queued the reply (user id) — null if generated by an auto-responder.</summary>
    [MaxLength(50)]
    public string? QueuedByUserId { get; set; }

    /// <summary>If populated, this reply was created by the given auto-responder rule.</summary>
    public int? RuleId { get; set; }

    [JsonIgnore]
    public MessengerRule? Rule { get; set; }

    public DateTime CreatedDate { get; set; } = DateTime.UtcNow;

    public DateTime? SentDate { get; set; }
}

/// <summary>
/// Auto-responder rule. Rules are evaluated in ascending <see cref="OrderIndex"/>
/// against the newest incoming message per thread after ingest. The first rule
/// that matches (and isn't in cooldown for that thread) fires and enqueues a
/// canned reply into <see cref="MessengerOutbox"/>.
/// </summary>
public class MessengerRule
{
    public int Id { get; set; }

    [MaxLength(100)]
    public string Name { get; set; } = null!;

    public bool Enabled { get; set; } = true;

    /// <summary>"contains" (case-insensitive substring), "equals" (trimmed, ci), "regex", or "any" (fires on every message).</summary>
    [MaxLength(20)]
    public string MatchType { get; set; } = "contains";

    /// <summary>Ignored when <see cref="MatchType"/> = "any".</summary>
    [MaxLength(500)]
    public string? MatchText { get; set; }

    /// <summary>
    /// Response body. Supports simple {counterparty}, {listing}, {build}, and
    /// {price} placeholders substituted at fire time.
    /// </summary>
    [MaxLength(4000)]
    public string ResponseText { get; set; } = null!;

    /// <summary>Lower = evaluated first. Ties broken by Id.</summary>
    public int OrderIndex { get; set; }

    /// <summary>
    /// Minutes to wait before this rule can fire again in the same thread.
    /// 0 = no cooldown. Prevents "hi", "hi", "hi" from triggering three replies.
    /// </summary>
    public int CooldownMinutes { get; set; } = 30;

    /// <summary>
    /// When true, only fires on threads that have <see cref="MessengerThread.ComputerId"/>
    /// set. Handy for "yes it's available" replies you only want to send for
    /// active listings.
    /// </summary>
    public bool RequireLinkedBuild { get; set; }

    public DateTime CreatedDate { get; set; } = DateTime.UtcNow;

    public DateTime? LastFiredDate { get; set; }
}
