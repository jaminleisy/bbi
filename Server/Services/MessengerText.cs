using System.Text.RegularExpressions;

namespace BenBotInventory.Server.Services;

/// <summary>
/// Normalizes text the Chrome extension scrapes from messenger.com.
/// Facebook's accessibility tree prefixes bubbles with
/// "Enter, Message sent {when} by {name}: {body}" and emits date dividers
/// as their own rows. Marketplace tabs often report the document title
/// ("Messenger | Facebook") as the counterparty.
/// </summary>
public static class MessengerText
{
    private static readonly Regex A11yMessage = new(
        @"^(?:Enter,\s*)?Message sent\s+(?<when>.+?)\s+by\s+(?<sender>[^:]+):\s*(?<body>[\s\S]*)$",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private static readonly Regex DateDivider = new(
        @"^(?:(?:today|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+)?\d{1,2}:\d{2}\s*(?:am|pm)?$",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private static readonly Regex LongDateDivider = new(
        @"^(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},\s+\d{4}(?:,\s+\d{1,2}:\d{2}\s*(?:am|pm)?)?$",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private static readonly Regex JunkName = new(
        @"^(?:messenger|facebook|instagram|marketplace)(?:\s*[|\-–—]\s*(?:messenger|facebook|instagram|marketplace))*$",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    public readonly record struct ParsedMessage(string Text, string? Sender, bool Outgoing);

    public static bool IsUsableName(string? name)
        => !string.IsNullOrWhiteSpace(name) && !JunkName.IsMatch(name.Trim());

    public static bool IsDateDivider(string? text)
    {
        var t = (text ?? "").Trim();
        if (t.Length == 0 || t.Length > 80) return false;
        return DateDivider.IsMatch(t) || LongDateDivider.IsMatch(t);
    }

    private static readonly Regex MediaNote = new(
        @"^\[\s*(?:\d+\s+)?(?:photos?|videos?|gifs?)\s*\]$",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    public static bool IsScrapedChrome(string? text)
    {
        var t = (text ?? "").Trim();
        if (IsDateDivider(t)) return true;
        return A11yMessage.IsMatch(t);
    }

    public static bool IsMediaNote(string? text)
        => MediaNote.IsMatch((text ?? "").Trim());

    /// <summary>
    /// Strip the a11y prefix when present. Returns null if the text is a
    /// date divider or empty after cleaning (caller should drop the row).
    /// </summary>
    public static ParsedMessage? CleanMessage(string? text, string? direction, string? senderName)
    {
        var raw = (text ?? "").Trim();
        if (raw.Length == 0) return new ParsedMessage("", senderName, direction == "outgoing");
        if (IsDateDivider(raw)) return null;

        var m = A11yMessage.Match(raw);
        if (m.Success)
        {
            var sender = m.Groups["sender"].Value.Trim();
            var body = m.Groups["body"].Value.Trim();
            if (body.Length == 0 || IsDateDivider(body)) return null;
            var outgoing = sender.Equals("You", StringComparison.OrdinalIgnoreCase)
                           || sender.Equals("me", StringComparison.OrdinalIgnoreCase);
            return new ParsedMessage(body, outgoing ? "me" : sender, outgoing);
        }

        return new ParsedMessage(raw, senderName, direction == "outgoing");
    }
}
