namespace BenBotInventory.Server.Services;

/// <summary>Computer.Status helpers for sold / marketplace-facilitator sales.</summary>
public static class ComputerStatus
{
    public const string Sold = "Sold";
    public const string SoldEbay = "Sold eBay";

    /// <summary>Statuses that mean the computer has been sold (any channel).</summary>
    public static readonly string[] SoldStatuses = [Sold, SoldEbay];

    public static bool IsSold(string? status) =>
        status == Sold || status == SoldEbay;

    public static bool IsEbaySold(string? status) =>
        status == SoldEbay;
}
