using BenBotInventory.Server.Data;
using BenBotInventory.Server.Models;
using Microsoft.EntityFrameworkCore;
using System.Text.RegularExpressions;

namespace BenBotInventory.Server.Services;

/// <summary>
/// Evaluates enabled <see cref="MessengerRule"/>s against the newest incoming
/// message in a thread and enqueues an auto-reply into <see cref="MessengerOutbox"/>
/// when the first matching, non-cooldown rule fires. Invoked synchronously
/// from the ingest endpoint so the reply is queued before the extension's
/// next outbox poll.
/// </summary>
public class MessengerRuleEngine
{
    private readonly AppDbContext _db;
    private readonly ILogger<MessengerRuleEngine> _log;

    public MessengerRuleEngine(AppDbContext db, ILogger<MessengerRuleEngine> log)
    {
        _db = db;
        _log = log;
    }

    /// <summary>
    /// Process rules for a single thread. Returns the enqueued outbox id if a
    /// rule fired, otherwise null.
    /// </summary>
    public async Task<int?> ProcessThreadAsync(int threadId, CancellationToken ct = default)
    {
        var thread = await _db.MessengerThreads
            .Include(t => t.Computer)
            .FirstOrDefaultAsync(t => t.Id == threadId, ct);
        if (thread is null) return null;

        // The message we react to is the newest INCOMING message. Ignoring
        // outgoing messages avoids echo-loops with our own replies.
        var lastIncoming = await _db.MessengerMessages
            .Where(m => m.ThreadId == threadId && m.Direction == "incoming")
            .OrderByDescending(m => m.Timestamp)
            .FirstOrDefaultAsync(ct);
        if (lastIncoming is null) return null;

        var rules = await _db.MessengerRules
            .Where(r => r.Enabled)
            .OrderBy(r => r.OrderIndex).ThenBy(r => r.Id)
            .ToListAsync(ct);
        if (rules.Count == 0) return null;

        foreach (var rule in rules)
        {
            if (rule.RequireLinkedBuild && thread.ComputerId is null) continue;
            if (!Matches(rule, lastIncoming.Text)) continue;

            // Cooldown check — per-thread, per-rule.
            if (rule.CooldownMinutes > 0)
            {
                var cutoff = DateTime.UtcNow.AddMinutes(-rule.CooldownMinutes);
                var recent = await _db.MessengerOutbox
                    .AnyAsync(o => o.ThreadId == threadId
                                && o.RuleId == rule.Id
                                && o.CreatedDate >= cutoff, ct);
                if (recent) continue;
            }

            var body = Expand(rule.ResponseText, thread, lastIncoming);
            if (string.IsNullOrWhiteSpace(body)) continue;

            _db.MessengerOutbox.Add(new MessengerOutbox
            {
                ThreadId = threadId,
                Text = body,
                Status = "pending",
                RuleId = rule.Id,
                QueuedByUserId = null   // auto-generated
            });
            rule.LastFiredDate = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);

            _log.LogInformation("Auto-responder rule {RuleId} '{RuleName}' fired on thread {ThreadId}",
                rule.Id, rule.Name, threadId);
            return rule.Id;
        }

        return null;
    }

    /// <summary>Public matcher so the UI's "test match" endpoint can preview behavior.</summary>
    public static bool Matches(MessengerRule rule, string? incomingText)
    {
        var text = incomingText ?? "";
        var pattern = rule.MatchText ?? "";
        return rule.MatchType?.ToLowerInvariant() switch
        {
            "any" => true,
            "equals" => string.Equals(text.Trim(), pattern.Trim(), StringComparison.OrdinalIgnoreCase),
            "regex" => SafeRegexMatch(pattern, text),
            _ => !string.IsNullOrEmpty(pattern)
                 && text.Contains(pattern, StringComparison.OrdinalIgnoreCase)
        };
    }

    private static bool SafeRegexMatch(string pattern, string text)
    {
        if (string.IsNullOrEmpty(pattern)) return false;
        try
        {
            // Cap runtime so a pathological pattern can't wedge the server.
            return Regex.IsMatch(text, pattern,
                RegexOptions.IgnoreCase | RegexOptions.CultureInvariant,
                TimeSpan.FromMilliseconds(200));
        }
        catch { return false; }
    }

    /// <summary>
    /// Substitute {counterparty} {listing} {build} {price} {text} in the
    /// response body. Unknown placeholders are left untouched.
    /// </summary>
    public static string Expand(string template, MessengerThread thread, MessengerMessage incoming)
    {
        if (string.IsNullOrEmpty(template)) return template;
        var counterparty = thread.CounterpartyName ?? "there";
        var listing = thread.ListingTitle ?? "the item";
        var build = thread.Computer?.Name ?? thread.ListingTitle ?? "";
        var price = thread.Computer?.Price?.ToString("0.##") ?? "";
        var text = incoming.Text ?? "";

        return template
            .Replace("{counterparty}", counterparty, StringComparison.OrdinalIgnoreCase)
            .Replace("{listing}", listing, StringComparison.OrdinalIgnoreCase)
            .Replace("{build}", build, StringComparison.OrdinalIgnoreCase)
            .Replace("{price}", price, StringComparison.OrdinalIgnoreCase)
            .Replace("{text}", text, StringComparison.OrdinalIgnoreCase);
    }
}
