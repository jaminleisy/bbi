using BenBotInventory.Server.Authorization;
using BenBotInventory.Server.Data;
using BenBotInventory.Server.Models;
using BenBotInventory.Server.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace BenBotInventory.Server.Controllers;

public record TestMatchRequest(string Text);

[ApiController]
[Route("api/messenger/rules")]
[Authorize(Policy = PermissionPolicies.Level3)]
public class MessengerRulesController : ControllerBase
{
    private static readonly HashSet<string> ValidMatchTypes = new(StringComparer.OrdinalIgnoreCase)
    { "contains", "equals", "regex", "any" };

    private readonly AppDbContext _db;

    public MessengerRulesController(AppDbContext db)
    {
        _db = db;
    }

    [HttpGet]
    public async Task<ActionResult<IEnumerable<MessengerRule>>> List()
    {
        return await _db.MessengerRules.AsNoTracking()
            .OrderBy(r => r.OrderIndex).ThenBy(r => r.Id)
            .ToListAsync();
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<MessengerRule>> Get(int id)
    {
        var rule = await _db.MessengerRules.FindAsync(id);
        return rule is null ? NotFound() : rule;
    }

    [HttpPost]
    public async Task<ActionResult<MessengerRule>> Create(MessengerRule rule)
    {
        rule.Id = 0;
        rule.CreatedDate = DateTime.UtcNow;
        rule.LastFiredDate = null;
        var err = Validate(rule);
        if (err is not null) return BadRequest(new { message = err });

        _db.MessengerRules.Add(rule);
        await _db.SaveChangesAsync();
        return CreatedAtAction(nameof(Get), new { id = rule.Id }, rule);
    }

    [HttpPut("{id:int}")]
    public async Task<ActionResult<MessengerRule>> Update(int id, MessengerRule rule)
    {
        var existing = await _db.MessengerRules.FindAsync(id);
        if (existing is null) return NotFound();

        var err = Validate(rule);
        if (err is not null) return BadRequest(new { message = err });

        existing.Name = rule.Name;
        existing.Enabled = rule.Enabled;
        existing.MatchType = rule.MatchType;
        existing.MatchText = rule.MatchText;
        existing.ResponseText = rule.ResponseText;
        existing.OrderIndex = rule.OrderIndex;
        existing.CooldownMinutes = rule.CooldownMinutes;
        existing.RequireLinkedBuild = rule.RequireLinkedBuild;
        await _db.SaveChangesAsync();
        return existing;
    }

    [HttpDelete("{id:int}")]
    public async Task<ActionResult> Delete(int id)
    {
        var existing = await _db.MessengerRules.FindAsync(id);
        if (existing is null) return NotFound();
        _db.MessengerRules.Remove(existing);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    /// <summary>
    /// Preview: does this rule (as sent, unsaved) match the supplied text?
    /// Handy for the settings UI when editing regexes.
    /// </summary>
    [HttpPost("test-match")]
    public ActionResult<object> TestMatch([FromBody] TestMatchRuleRequest req)
    {
        var matches = MessengerRuleEngine.Matches(req.Rule, req.Text);
        return new { matches };
    }

    private static string? Validate(MessengerRule r)
    {
        if (string.IsNullOrWhiteSpace(r.Name)) return "Name is required.";
        if (string.IsNullOrWhiteSpace(r.ResponseText)) return "ResponseText is required.";
        if (!ValidMatchTypes.Contains(r.MatchType ?? ""))
            return "MatchType must be one of: contains, equals, regex, any.";
        if (!string.Equals(r.MatchType, "any", StringComparison.OrdinalIgnoreCase)
            && string.IsNullOrWhiteSpace(r.MatchText))
            return "MatchText is required when MatchType is not 'any'.";
        if (r.CooldownMinutes < 0) return "CooldownMinutes must be ≥ 0.";
        return null;
    }
}

public record TestMatchRuleRequest(MessengerRule Rule, string Text);
