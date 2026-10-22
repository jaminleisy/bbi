namespace BenBotInventory.Server.Services;

/// <summary>
/// Canonical display order for part types: preferred sequence, then misc,
/// then any other types alphabetically.
/// </summary>
public static class PartTypeOrder
{
    private static readonly string[] Preferred =
    [
        "case", "psu", "gpu", "mobo", "cpu", "cpuCooler", "storage", "ram", "misc"
    ];

    public static int Rank(string? type)
    {
        if (string.IsNullOrWhiteSpace(type)) return int.MaxValue;
        for (var i = 0; i < Preferred.Length; i++)
        {
            if (string.Equals(Preferred[i], type, StringComparison.OrdinalIgnoreCase))
                return i;
        }
        return Preferred.Length;
    }

    public static IEnumerable<T> OrderByPartType<T>(this IEnumerable<T> items, Func<T, string?> typeSelector)
        => items
            .OrderBy(x => Rank(typeSelector(x)))
            .ThenBy(x => typeSelector(x) ?? "", StringComparer.OrdinalIgnoreCase);
}
