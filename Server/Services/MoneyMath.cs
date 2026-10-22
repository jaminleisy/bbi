namespace BenBotInventory.Server.Services;

/// <summary>Currency helpers — always work in cents with AwayFromZero rounding.</summary>
public static class MoneyMath
{
    public const decimal TaxInclusiveDivisor = 1.0925m;

    public static decimal Round2(decimal value) =>
        Math.Round(value, 2, MidpointRounding.AwayFromZero);

    /// <summary>Tax portion of a tax-inclusive total: amount − amount / 1.0925.</summary>
    public static decimal? TaxFromInclusiveAmount(decimal? amount)
    {
        if (amount is null) return null;
        var n = amount.Value;
        return Round2(n - n / TaxInclusiveDivisor);
    }
}
