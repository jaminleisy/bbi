using BenBotInventory.Server.Data;
using BenBotInventory.Server.Models;
using Microsoft.EntityFrameworkCore;

namespace BenBotInventory.Server.Services;

/// <summary>
/// Display name for a computer: stored name when set, otherwise case/GPU labels
/// (or "Unnamed - {one part}" when neither is assigned).
/// </summary>
public static class ComputerDisplayName
{
    public readonly record struct PartBits(
        string Type, string? Manufacturer, string? ModelNumber, string? Color);

    public static string From(string? storedName, IEnumerable<PartBits> parts)
    {
        var stored = storedName?.Trim();
        if (!string.IsNullOrEmpty(stored)) return stored;

        var list = parts as IList<PartBits> ?? parts.ToList();
        var caseLabel = FirstOfType(list, "case") is { } casePart ? Label(casePart) : "";
        var gpuLabel = FirstOfType(list, "gpu") is { } gpuPart ? Label(gpuPart) : "";
        if (!string.IsNullOrEmpty(caseLabel) && !string.IsNullOrEmpty(gpuLabel))
            return $"{caseLabel} - {gpuLabel}";
        if (!string.IsNullOrEmpty(caseLabel)) return caseLabel;
        if (!string.IsNullOrEmpty(gpuLabel)) return gpuLabel;

        var other = list
            .OrderBy(p => PartTypeOrder.Rank(p.Type))
            .ThenBy(p => p.Type, StringComparer.OrdinalIgnoreCase)
            .Select(Label)
            .FirstOrDefault(l => !string.IsNullOrEmpty(l));
        return string.IsNullOrEmpty(other) ? "Unnamed" : $"Unnamed - {other}";
    }

    public static string From(Computer computer) =>
        From(computer.Name, computer.Parts.Select(ToBits));

    public static PartBits ToBits(Part p) =>
        new(p.Type, p.Manufacturer, p.ModelNumber, p.Color);

    /// <summary>
    /// Display names for computers whose stored name is already known to be blank.
    /// Loads only those computers' parts (one query).
    /// </summary>
    public static async Task<Dictionary<int, string>> MapUnnamedAsync(
        AppDbContext db, IEnumerable<int> unnamedComputerIds)
    {
        var ids = unnamedComputerIds.Distinct().ToList();
        if (ids.Count == 0) return new Dictionary<int, string>();

        var partsByComputer = await LoadPartsAsync(db, ids);
        return ids.ToDictionary(
            id => id,
            id => From(null, partsByComputer.TryGetValue(id, out var bits) ? bits : Array.Empty<PartBits>()));
    }

    public static async Task<Dictionary<int, string>> MapAsync(
        AppDbContext db, IEnumerable<int> computerIds)
    {
        var ids = computerIds.Distinct().ToList();
        if (ids.Count == 0) return new Dictionary<int, string>();

        var names = await db.Computers.AsNoTracking()
            .Where(c => ids.Contains(c.Id))
            .Select(c => new { c.Id, c.Name })
            .ToListAsync();

        var unnamedIds = names
            .Where(c => string.IsNullOrWhiteSpace(c.Name))
            .Select(c => c.Id)
            .ToList();
        var partsByComputer = unnamedIds.Count == 0
            ? new Dictionary<int, List<PartBits>>()
            : await LoadPartsAsync(db, unnamedIds);

        return names.ToDictionary(
            c => c.Id,
            c => From(
                c.Name,
                partsByComputer.TryGetValue(c.Id, out var bits) ? bits : Array.Empty<PartBits>()));
    }

    private static async Task<Dictionary<int, List<PartBits>>> LoadPartsAsync(
        AppDbContext db, List<int> computerIds)
    {
        var partRows = await db.Parts.AsNoTracking()
            .Where(p => p.ComputerId != null && computerIds.Contains(p.ComputerId.Value))
            .Select(p => new
            {
                ComputerId = p.ComputerId!.Value,
                p.Type, p.Manufacturer, p.ModelNumber, p.Color
            })
            .ToListAsync();

        var map = new Dictionary<int, List<PartBits>>();
        foreach (var p in partRows)
        {
            if (!map.TryGetValue(p.ComputerId, out var list))
            {
                list = [];
                map[p.ComputerId] = list;
            }
            list.Add(new PartBits(p.Type, p.Manufacturer, p.ModelNumber, p.Color));
        }
        return map;
    }

    private static PartBits? FirstOfType(IEnumerable<PartBits> parts, string type)
    {
        foreach (var p in parts)
        {
            if (string.Equals(p.Type, type, StringComparison.OrdinalIgnoreCase))
                return p;
        }
        return null;
    }

    private static string Label(PartBits part)
    {
        var mfr = part.Manufacturer?.Trim() ?? "";
        var model = part.ModelNumber?.Trim() ?? "";
        var color = part.Color?.Trim() ?? "";
        var modelText = !string.IsNullOrEmpty(model) && !string.IsNullOrEmpty(color)
            ? $"{model} ({color})"
            : !string.IsNullOrEmpty(color) && string.IsNullOrEmpty(model)
                ? $"({color})"
                : model;
        var label = string.Join(" ", new[] { mfr, modelText }.Where(s => !string.IsNullOrEmpty(s)));
        return label;
    }
}
