using BenBotInventory.Server.Authorization;
using BenBotInventory.Server.Data;
using BenBotInventory.Server.Models;
using BenBotInventory.Server.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Cryptography;
using System.Text;

namespace BenBotInventory.Server.Controllers;

// ---------- DTOs ----------

/// <summary>
/// Bulk payload posted by the Chrome extension whenever it observes new
/// activity. Contains thread metadata plus any new messages seen in the DOM.
/// Ingest is idempotent: server dedupes on (FbThreadId, ExternalId).
/// </summary>
public record IngestPayload(
    string FbThreadId,
    string? CounterpartyName,
    string? CounterpartyUrl,
    string? ListingTitle,
    string? ListingUrl,
    bool? Unread,
    List<IngestMessage>? Messages,
    List<string>? VisibleMediaExternalIds
);

public record IngestMessage(
    string? ExternalId,
    string Direction,          // "incoming" | "outgoing"
    string? SenderName,
    string Text,
    DateTime Timestamp,
    string? RawJson,
    List<IngestAttachment>? Attachments,
    string? MediaUrl
);

/// <summary>
/// Image (or other) attachment captured by the extension. <c>DataBase64</c>
/// is the raw base64-encoded body of the file (no data-URL prefix).
/// </summary>
public record IngestAttachment(
    string ContentType,
    string DataBase64,
    string? SourceUrl,
    int? Width,
    int? Height
);

public record OutboxAckRequest(string Status, string? Error, string? ExternalId);

public record OutboxItemDto(
    int Id,
    int ThreadId,
    string FbThreadId,
    string Text,
    int Attempts
);

[ApiController]
[Route("api/messenger")]
public class MessengerController : ControllerBase
{
    /// <summary>Hard cap per attachment (2 MB). Larger images are dropped.</summary>
    private const int MaxAttachmentBytes = 2 * 1024 * 1024;

    /// <summary>Hard cap on attachments per message.</summary>
    private const int MaxAttachmentsPerMessage = 5;

    private readonly AppDbContext _db;
    private readonly MessengerRuleEngine _rules;

    public MessengerController(AppDbContext db, MessengerRuleEngine rules)
    {
        _db = db;
        _rules = rules;
    }

    // ================================================================
    //                   Extension-facing endpoints
    //           (protected by the shared X-Bot-Token header)
    // ================================================================

    /// <summary>Health check the extension calls to verify config.</summary>
    [HttpGet("ping")]
    [BotTokenAuthorize]
    public ActionResult<object> Ping() => new { ok = true, time = DateTime.UtcNow };

    /// <summary>
    /// Push observed messages + thread metadata. Upserts the thread by
    /// FbThreadId and inserts any messages whose (ThreadId, ExternalId)
    /// is not already stored.
    /// </summary>
    [HttpPost("ingest")]
    [BotTokenAuthorize]
    public async Task<ActionResult<object>> Ingest(IngestPayload payload)
    {
        if (string.IsNullOrWhiteSpace(payload.FbThreadId))
            return BadRequest(new { message = "FbThreadId is required." });

        var incoming = payload.Messages ?? new List<IngestMessage>();

        var thread = await _db.MessengerThreads
            .FirstOrDefaultAsync(t => t.FbThreadId == payload.FbThreadId);

        var usableName = MessengerText.IsUsableName(payload.CounterpartyName)
            ? payload.CounterpartyName!.Trim()
            : null;

        if (thread is null && incoming.Count == 0 && usableName is null)
            return Ok(new { threadId = 0, fbThreadId = payload.FbThreadId, inserted = 0, skipped = "empty scrape" });

        if (thread is null)
        {
            thread = new MessengerThread
            {
                FbThreadId = payload.FbThreadId,
                CounterpartyName = usableName,
                CounterpartyUrl = payload.CounterpartyUrl,
                ListingTitle = payload.ListingTitle,
                ListingUrl = payload.ListingUrl,
                Unread = payload.Unread ?? false
            };
            _db.MessengerThreads.Add(thread);
            await _db.SaveChangesAsync();
        }
        else
        {
            // Don't clobber a real name with null, and never persist
            // "Messenger | Facebook" / other tab-title junk.
            if (usableName is not null) thread.CounterpartyName = usableName;
            else if (!MessengerText.IsUsableName(thread.CounterpartyName))
                thread.CounterpartyName = null;
            if (!string.IsNullOrWhiteSpace(payload.CounterpartyUrl))  thread.CounterpartyUrl  = payload.CounterpartyUrl;
            if (!string.IsNullOrWhiteSpace(payload.ListingTitle))     thread.ListingTitle     = payload.ListingTitle;
            if (!string.IsNullOrWhiteSpace(payload.ListingUrl))       thread.ListingUrl       = payload.ListingUrl;
            if (payload.Unread is not null)                            thread.Unread           = payload.Unread.Value;
        }

        var existingRows = await _db.MessengerMessages
            .Where(m => m.ThreadId == thread.Id)
            .ToListAsync();
        var inserted = 0;
        var insertedIncoming = 0;
        foreach (var msg in incoming)
        {
            var cleaned = MessengerText.CleanMessage(msg.Text, msg.Direction, msg.SenderName);
            if (cleaned is null) continue;

            var text = cleaned.Value.Text;
            var direction = cleaned.Value.Outgoing ? "outgoing" : "incoming";
            var senderName = cleaned.Value.Sender;
            if (usableName is null && MessengerText.IsUsableName(senderName) && direction == "incoming")
            {
                usableName = senderName;
                thread.CounterpartyName = senderName;
            }

            var hasAttachments = (msg.Attachments?.Count ?? 0) > 0;
            if (string.IsNullOrWhiteSpace(text)
                && string.IsNullOrWhiteSpace(msg.RawJson)
                && !hasAttachments)
                continue;

            var externalId = !string.IsNullOrWhiteSpace(msg.ExternalId)
                ? msg.ExternalId!
                : HashExternalId(payload.FbThreadId, msg.Timestamp, senderName, text);

            var mediaUrl = SanitizeHttpUrl(msg.MediaUrl);

            var match = existingRows.FirstOrDefault(m => m.ExternalId == externalId)
                ?? existingRows.FirstOrDefault(m => m.Text == text && m.Direction == direction);
            if (match is not null)
            {
                if (match.ExternalId != externalId)
                    match.ExternalId = externalId;
                if (match.Timestamp != msg.Timestamp)
                    match.Timestamp = msg.Timestamp;
                if (mediaUrl is not null)
                    match.MediaUrl = mediaUrl;
                if (hasAttachments && match.Id != 0
                    && !await _db.MessengerAttachments.AnyAsync(a => a.MessageId == match.Id))
                    AddAttachments(match.Id, msg.Attachments!);
                continue;
            }

            var record = new MessengerMessage
            {
                ThreadId = thread.Id,
                ExternalId = externalId,
                Direction = direction,
                SenderName = senderName,
                Text = text,
                Timestamp = msg.Timestamp,
                RawJson = msg.RawJson,
                MediaUrl = mediaUrl
            };
            _db.MessengerMessages.Add(record);
            existingRows.Add(record);
            await _db.SaveChangesAsync(); // need the Id for attachment FKs
            inserted++;
            if (record.Direction == "incoming") insertedIncoming++;

            if (hasAttachments)
                AddAttachments(record.Id, msg.Attachments!);
        }

        var dropping = new HashSet<MessengerMessage>();
        if (payload.VisibleMediaExternalIds is not null)
        {
            var keep = payload.VisibleMediaExternalIds
                .Where(id => !string.IsNullOrWhiteSpace(id))
                .ToHashSet(StringComparer.Ordinal);
            foreach (var row in existingRows.Where(m =>
                m.Id != 0 && MessengerText.IsMediaNote(m.Text) && !keep.Contains(m.ExternalId)))
                dropping.Add(row);
        }

        foreach (var row in existingRows.Where(m => MessengerText.IsScrapedChrome(m.Text)))
            dropping.Add(row);

        if (dropping.Count > 0)
            _db.MessengerMessages.RemoveRange(dropping);

        // Any incoming message flips the thread to unread; the UI clears it via /read.
        if (insertedIncoming > 0) thread.Unread = true;

        await _db.SaveChangesAsync();

        thread.LastMessageDate = await _db.MessengerMessages
            .Where(m => m.ThreadId == thread.Id)
            .Select(m => (DateTime?)m.Timestamp)
            .MaxAsync();
        await _db.SaveChangesAsync();

        return new
        {
            threadId = thread.Id,
            fbThreadId = thread.FbThreadId,
            inserted,
            totalMessages = await _db.MessengerMessages.CountAsync(m => m.ThreadId == thread.Id)
        };
    }

    private void AddAttachments(int messageId, List<IngestAttachment> attachments)
    {
        foreach (var a in attachments.Take(MaxAttachmentsPerMessage))
        {
            var bytes = DecodeBase64(a.DataBase64);
            if (bytes is null || bytes.Length == 0 || bytes.Length > MaxAttachmentBytes)
                continue;

            _db.MessengerAttachments.Add(new MessengerAttachment
            {
                MessageId = messageId,
                ContentType = string.IsNullOrWhiteSpace(a.ContentType) ? "image/jpeg" : a.ContentType,
                Data = bytes,
                SourceUrl = SanitizeHttpUrl(a.SourceUrl),
                Width = a.Width,
                Height = a.Height
            });
        }
    }

    private static string? SanitizeHttpUrl(string? url)
    {
        if (string.IsNullOrWhiteSpace(url)) return null;
        var t = url.Trim();
        if (t.Length > 1000) t = t[..1000];
        if (!Uri.TryCreate(t, UriKind.Absolute, out var u)) return null;
        if (u.Scheme != Uri.UriSchemeHttp && u.Scheme != Uri.UriSchemeHttps) return null;
        return t;
    }

    private static byte[]? DecodeBase64(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        // Strip a data-URL prefix if the extension included one.
        var comma = s.IndexOf(',');
        if (comma > 0 && s.StartsWith("data:")) s = s[(comma + 1)..];
        try { return Convert.FromBase64String(s); }
        catch { return null; }
    }

    /// <summary>Extension long-polls this for queued replies to send.</summary>
    [HttpGet("outbox")]
    [BotTokenAuthorize]
    public async Task<ActionResult<IEnumerable<OutboxItemDto>>> Outbox(
        [FromQuery] int limit = 5)
    {
        limit = Math.Clamp(limit, 1, 25);

        var items = await _db.MessengerOutbox
            .Where(o => o.Status == "pending")
            .OrderBy(o => o.CreatedDate)
            .Take(limit)
            .Join(_db.MessengerThreads,
                o => o.ThreadId,
                t => t.Id,
                (o, t) => new OutboxItemDto(o.Id, o.ThreadId, t.FbThreadId, o.Text, o.Attempts))
            .ToListAsync();

        // Mark them as sending so a second poll doesn't hand them out again.
        if (items.Count > 0)
        {
            var ids = items.Select(i => i.Id).ToArray();
            await _db.MessengerOutbox
                .Where(o => ids.Contains(o.Id))
                .ExecuteUpdateAsync(s => s
                    .SetProperty(o => o.Status, "sending")
                    .SetProperty(o => o.Attempts, o => o.Attempts + 1));
        }

        return items;
    }

    /// <summary>
    /// Extension reports the outcome of a queued send. On success also stores
    /// the outgoing message so it appears in the thread history.
    /// </summary>
    [HttpPost("outbox/{id:int}/ack")]
    [BotTokenAuthorize]
    public async Task<ActionResult> Ack(int id, OutboxAckRequest req)
    {
        var item = await _db.MessengerOutbox.FindAsync(id);
        if (item is null) return NotFound();

        if (req.Status == "sent")
        {
            item.Status = "sent";
            item.SentDate = DateTime.UtcNow;
            item.Error = null;

            // Also record the outgoing message so the thread stays a
            // complete transcript. Dedup on the ExternalId the extension
            // returns (or a fallback hash).
            var externalId = !string.IsNullOrWhiteSpace(req.ExternalId)
                ? req.ExternalId!
                : HashExternalId(item.Id.ToString(), item.SentDate.Value, "me", item.Text);

            var exists = await _db.MessengerMessages
                .AnyAsync(m => m.ThreadId == item.ThreadId && m.ExternalId == externalId);
            if (!exists)
            {
                _db.MessengerMessages.Add(new MessengerMessage
                {
                    ThreadId = item.ThreadId,
                    ExternalId = externalId,
                    Direction = "outgoing",
                    SenderName = "me",
                    Text = item.Text,
                    Timestamp = item.SentDate.Value
                });
                var thread = await _db.MessengerThreads.FindAsync(item.ThreadId);
                if (thread is not null) thread.LastMessageDate = item.SentDate;
            }
        }
        else if (req.Status == "retry")
        {
            item.Status = "pending";
            item.Error = req.Error;
        }
        else
        {
            item.Status = "failed";
            item.Error = req.Error;
        }

        await _db.SaveChangesAsync();
        return NoContent();
    }

    // ================================================================
    //             User-facing endpoints (JWT-authenticated)
    // ================================================================

    /// <summary>List threads, newest activity first.</summary>
    [HttpGet("threads")]
    [Authorize]
    public async Task<ActionResult<IEnumerable<object>>> Threads(
        [FromQuery] bool unreadOnly = false,
        [FromQuery] int limit = 100)
    {
        limit = Math.Clamp(limit, 1, 500);
        var q = _db.MessengerThreads.AsNoTracking().AsQueryable();
        if (unreadOnly) q = q.Where(t => t.Unread);

        return await q
            .OrderByDescending(t => t.LastMessageDate ?? t.CreatedDate)
            .Take(limit)
            .Select(t => new
            {
                t.Id,
                t.FbThreadId,
                t.CounterpartyName,
                t.CounterpartyUrl,
                t.ListingTitle,
                t.ListingUrl,
                t.ComputerId,
                t.LastMessageDate,
                t.Unread,
                LastMessage = _db.MessengerMessages
                    .Where(m => m.ThreadId == t.Id)
                    .OrderByDescending(m => m.Timestamp)
                    .Select(m => new { m.Direction, m.Text, m.Timestamp })
                    .FirstOrDefault(),
                PendingReplies = _db.MessengerOutbox
                    .Count(o => o.ThreadId == t.Id && (o.Status == "pending" || o.Status == "sending"))
            })
            .ToListAsync();
    }

    /// <summary>Messages inside one thread, oldest first.</summary>
    [HttpGet("threads/{id:int}/messages")]
    [Authorize]
    public async Task<ActionResult<IEnumerable<object>>> ThreadMessages(int id)
    {
        if (!await _db.MessengerThreads.AnyAsync(t => t.Id == id)) return NotFound();
        return await _db.MessengerMessages.AsNoTracking()
            .Where(m => m.ThreadId == id)
            .OrderBy(m => m.Timestamp)
            .Select(m => new
            {
                m.Id,
                m.Direction,
                m.SenderName,
                m.Text,
                m.Timestamp,
                m.MediaUrl,
                Attachments = _db.MessengerAttachments
                    .Where(a => a.MessageId == m.Id)
                    .Select(a => new { a.Id, a.ContentType, a.Width, a.Height, a.SourceUrl })
                    .ToList()
            })
            .ToListAsync();
    }

    /// <summary>Return the raw bytes of an attachment for inline display.</summary>
    [HttpGet("attachments/{id:int}")]
    [Authorize]
    public async Task<IActionResult> GetAttachment(int id)
    {
        var a = await _db.MessengerAttachments.AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == id);
        if (a is null) return NotFound();
        Response.Headers.CacheControl = "private, max-age=86400";
        return File(a.Data, a.ContentType);
    }

    /// <summary>How many threads are currently unread — cheap query for the toolbar badge.</summary>
    [HttpGet("unread-count")]
    [Authorize]
    public async Task<ActionResult<object>> UnreadCount()
    {
        var count = await _db.MessengerThreads.CountAsync(t => t.Unread);
        return new { count };
    }

    /// <summary>
    /// Copyable reply suggestions for the newest incoming message, produced
    /// when the user opens the thread. The extension never sends these.
    /// </summary>
    [HttpGet("threads/{id:int}/suggestions")]
    [Authorize]
    public async Task<ActionResult<IEnumerable<ReplySuggestion>>> Suggestions(int id)
    {
        if (!await _db.MessengerThreads.AnyAsync(t => t.Id == id)) return NotFound();
        return Ok(await _rules.SuggestAsync(id));
    }

    /// <summary>Mark a thread read (typically after the UI shows it).</summary>
    [HttpPost("threads/{id:int}/read")]
    [Authorize]
    public async Task<ActionResult> MarkRead(int id)
    {
        var t = await _db.MessengerThreads.FindAsync(id);
        if (t is null) return NotFound();
        t.Unread = false;
        await _db.SaveChangesAsync();
        return NoContent();
    }

    /// <summary>Delete a thread and its messages (use after a bad scrape).</summary>
    [HttpDelete("threads/{id:int}")]
    [Authorize]
    public async Task<ActionResult> DeleteThread(int id)
    {
        var t = await _db.MessengerThreads.FindAsync(id);
        if (t is null) return NotFound();
        _db.MessengerThreads.Remove(t);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    /// <summary>Link (or unlink) a thread to one of your builds.</summary>
    [HttpPost("threads/{id:int}/link")]
    [Authorize]
    public async Task<ActionResult> LinkComputer(int id, [FromBody] int? computerId)
    {
        var t = await _db.MessengerThreads.FindAsync(id);
        if (t is null) return NotFound();
        if (computerId is not null && !await _db.Computers.AnyAsync(c => c.Id == computerId))
            return BadRequest(new { message = $"Unknown computer id '{computerId}'." });
        t.ComputerId = computerId;
        await _db.SaveChangesAsync();
        return NoContent();
    }

    // ================================================================

    private static string HashExternalId(string threadId, DateTime ts, string? sender, string? text)
    {
        var canon = $"{threadId}|{ts.ToUniversalTime():O}|{sender}|{text}";
        var bytes = SHA1.HashData(Encoding.UTF8.GetBytes(canon));
        return "sha1:" + Convert.ToHexString(bytes).ToLowerInvariant();
    }
}
