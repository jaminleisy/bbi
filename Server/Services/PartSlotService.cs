using BenBotInventory.Server.Data;
using BenBotInventory.Server.Models;
using Microsoft.EntityFrameworkCore;

namespace BenBotInventory.Server.Services;

public record PlaceholderRequest(string Type, string Description);
public record ReplaceWithPartRequest(int PartId);
public record ReplaceWithPlaceholderRequest(string Description);
public record ReplacePartWithPartRequest(int NewPartId);

/// <summary>Shared logic for planned-part placeholders and same-type part swaps.</summary>
public class PartSlotService
{
    private readonly AppDbContext _db;

    public PartSlotService(AppDbContext db) => _db = db;

    public static object ToDto(PartPlaceholder ph) => new
    {
        ph.Id,
        ph.ComputerId,
        ph.Type,
        ph.Description
    };

    public async Task<(PartPlaceholder? ph, string? error)> AddPlaceholderAsync(
        int computerId, PlaceholderRequest request)
    {
        var type = request.Type?.Trim() ?? "";
        var description = request.Description?.Trim() ?? "";
        if (string.IsNullOrEmpty(type))
            return (null, "Type is required.");
        if (string.IsNullOrEmpty(description))
            return (null, "Description is required.");
        if (description.Length > 200)
            return (null, "Description must be at most 200 characters.");

        if (!await _db.PartTypes.AnyAsync(t => t.Type == type))
            return (null, $"Unknown part type '{type}'.");

        var ph = new PartPlaceholder
        {
            ComputerId = computerId,
            Type = type,
            Description = description
        };
        _db.PartPlaceholders.Add(ph);
        await _db.SaveChangesAsync();
        return (ph, null);
    }

    public async Task<(PartPlaceholder? ph, string? error)> UpdatePlaceholderAsync(
        int computerId, int phId, PlaceholderRequest request)
    {
        var ph = await _db.PartPlaceholders
            .FirstOrDefaultAsync(p => p.Id == phId && p.ComputerId == computerId);
        if (ph is null) return (null, "notfound");

        var type = request.Type?.Trim() ?? "";
        var description = request.Description?.Trim() ?? "";
        if (string.IsNullOrEmpty(type))
            return (null, "Type is required.");
        if (string.IsNullOrEmpty(description))
            return (null, "Description is required.");
        if (description.Length > 200)
            return (null, "Description must be at most 200 characters.");
        if (!await _db.PartTypes.AnyAsync(t => t.Type == type))
            return (null, $"Unknown part type '{type}'.");

        ph.Type = type;
        ph.Description = description;
        await _db.SaveChangesAsync();
        return (ph, null);
    }

    public async Task<string?> DeletePlaceholderAsync(int computerId, int phId)
    {
        var ph = await _db.PartPlaceholders
            .FirstOrDefaultAsync(p => p.Id == phId && p.ComputerId == computerId);
        if (ph is null) return "notfound";
        _db.PartPlaceholders.Remove(ph);
        await _db.SaveChangesAsync();
        return null;
    }

    public async Task<string?> ReplacePlaceholderWithPartAsync(
        int computerId, int phId, int partId)
    {
        var ph = await _db.PartPlaceholders
            .FirstOrDefaultAsync(p => p.Id == phId && p.ComputerId == computerId);
        if (ph is null) return "notfound";

        var part = await _db.Parts.FirstOrDefaultAsync(p => p.Id == partId);
        if (part is null) return "Part not found.";
        if (part.ComputerId is not null && part.ComputerId != computerId)
            return $"Part '{part.Manufacturer} {part.ModelNumber}' is already assigned to another computer.";
        if (!string.Equals(part.Type, ph.Type, StringComparison.OrdinalIgnoreCase))
            return $"Part type '{part.Type}' does not match placeholder type '{ph.Type}'.";

        part.ComputerId = computerId;
        _db.PartPlaceholders.Remove(ph);
        await _db.SaveChangesAsync();
        return null;
    }

    public async Task<(PartPlaceholder? ph, string? error)> ReplacePartWithPlaceholderAsync(
        int computerId, int partId, string description)
    {
        var part = await _db.Parts
            .FirstOrDefaultAsync(p => p.Id == partId && p.ComputerId == computerId);
        if (part is null) return (null, "notfound");

        var text = description?.Trim() ?? "";
        if (string.IsNullOrEmpty(text))
            return (null, "Description is required.");
        if (text.Length > 200)
            return (null, "Description must be at most 200 characters.");

        part.ComputerId = null;
        var ph = new PartPlaceholder
        {
            ComputerId = computerId,
            Type = part.Type,
            Description = text
        };
        _db.PartPlaceholders.Add(ph);
        await _db.SaveChangesAsync();
        return (ph, null);
    }

    public async Task<string?> ReplacePartWithPartAsync(
        int computerId, int partId, int newPartId)
    {
        if (partId == newPartId)
            return "New part must be different from the current part.";

        var oldPart = await _db.Parts
            .FirstOrDefaultAsync(p => p.Id == partId && p.ComputerId == computerId);
        if (oldPart is null) return "notfound";

        var newPart = await _db.Parts.FirstOrDefaultAsync(p => p.Id == newPartId);
        if (newPart is null) return "Replacement part not found.";
        if (newPart.ComputerId is not null)
            return $"Part '{newPart.Manufacturer} {newPart.ModelNumber}' is already assigned.";
        if (!string.Equals(newPart.Type, oldPart.Type, StringComparison.OrdinalIgnoreCase))
            return $"Replacement part type '{newPart.Type}' must match '{oldPart.Type}'.";

        oldPart.ComputerId = null;
        newPart.ComputerId = computerId;
        await _db.SaveChangesAsync();
        return null;
    }
}
