using BenBotInventory.Server.Data;
using BenBotInventory.Server.Models;
using Microsoft.EntityFrameworkCore;
using System.Text.RegularExpressions;

namespace BenBotInventory.Server.Services;

/// <summary>
/// A copyable reply produced by a matching <see cref="MessengerRule"/>.
/// Nothing is sent automatically — the user pastes this into Messenger.
/// </summary>
public record ReplySuggestion(
    int RuleId,
    string RuleName,
    string Text,
    int IncomingMessageId,
    string IncomingText
);

/// <summary>
/// Evaluates enabled <see cref="MessengerRule"/>s against the newest incoming
/// message in a thread and returns copyable reply suggestions. Invoked when
/// the user opens a thread, not when the extension ingests.
/// </summary>
public class MessengerRuleEngine
{
    private readonly AppDbContext _db;

    public MessengerRuleEngine(AppDbContext db)
    {
        _db = db;
    }

    /// <summary>
    /// Suggestions for the newest incoming message, in rule order.
    /// Empty when the thread has no incoming message or no rule matches.
    /// </summary>
    public async Task<IReadOnlyList<ReplySuggestion>> SuggestAsync(
        int threadId, CancellationToken ct = default)
    {
        var thread = await _db.MessengerThreads
            .Include(t => t.Computer!).ThenInclude(c => c.Parts)
            .FirstOrDefaultAsync(t => t.Id == threadId, ct);
        if (thread is null) return Array.Empty<ReplySuggestion>();

        var lastIncoming = await _db.MessengerMessages
            .Where(m => m.ThreadId == threadId && m.Direction == "incoming")
            .OrderByDescending(m => m.Timestamp)
            .FirstOrDefaultAsync(ct);
        if (lastIncoming is null) return Array.Empty<ReplySuggestion>();

        var rules = await _db.MessengerRules
            .Where(r => r.Enabled)
            .OrderBy(r => r.OrderIndex).ThenBy(r => r.Id)
            .ToListAsync(ct);

        var suggestions = new List<ReplySuggestion>();
        foreach (var rule in rules)
        {
            if (rule.RequireLinkedBuild && thread.ComputerId is null) continue;
            if (!Matches(rule, lastIncoming.Text)) continue;

            var body = Expand(rule.ResponseText, thread, lastIncoming);
            if (string.IsNullOrWhiteSpace(body)) continue;

            suggestions.Add(new ReplySuggestion(
                rule.Id,
                rule.Name,
                body,
                lastIncoming.Id,
                lastIncoming.Text ?? ""));
        }

        return suggestions;
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
        var build = thread.Computer is not null
            ? ComputerDisplayName.From(thread.Computer)
            : thread.ListingTitle ?? "";
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
