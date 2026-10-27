using BenBotInventory.Server.Authorization;
using BenBotInventory.Server.Data;
using BenBotInventory.Server.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace BenBotInventory.Server.Controllers;

[ApiController]
[Route("api/reports")]
[Authorize(Policy = PermissionPolicies.Level3)]
public class ReportsController : ControllerBase
{
    private readonly AppDbContext _db;

    public ReportsController(AppDbContext db)
    {
        _db = db;
    }

    /// <summary>
    /// Monthly sales summary for a calendar year, matching the spreadsheet TAXES rows:
    /// total sales (gross), exempt sales, total before tax, tax due, and profit
    /// (pretax revenue minus parts cost minus wages). Sales months are keyed by
    /// Computer.SoldDate. By default wages are keyed by Wage.PaidDate; with
    /// wagesBySaleDate=true, month wages are the wages assigned to computers
    /// sold that month (regardless of when paid).
    /// eBay sales (status "Sold eBay") are reported only in EbaySales — they do
    /// not change Total Sales, tax due, parts, wages-by-sale-date, or profit.
    /// </summary>
    [HttpGet("monthly")]
    public async Task<ActionResult<object>> GetMonthlySummary(
        [FromQuery] int? year = null,
        [FromQuery] bool wagesBySaleDate = false)
    {
        var saleYears = await _db.Computers.AsNoTracking()
            .Where(c => ComputerStatus.SoldStatuses.Contains(c.Status) && c.SoldDate != null)
            .Select(c => c.SoldDate!.Value.Year)
            .Distinct()
            .ToListAsync();
        var wageYears = await _db.Wages.AsNoTracking()
            .Where(w => w.PaidDate != null)
            .Select(w => w.PaidDate!.Value.Year)
            .Distinct()
            .ToListAsync();

        var availableYears = saleYears.Union(wageYears)
            .OrderByDescending(y => y)
            .ToList();

        var selectedYear = year
            ?? (availableYears.Count > 0 ? availableYears[0] : DateTime.UtcNow.Year);

        // Range filters so SoldDate / PaidDate indexes can be used.
        var yearStart = new DateTime(selectedYear, 1, 1);
        var yearEnd = new DateTime(selectedYear + 1, 1, 1);

        // Aggregate parts/payments in SQL — avoid Include graphs (cartesian explode).
        var sold = await _db.Computers.AsNoTracking()
            .Where(c => ComputerStatus.SoldStatuses.Contains(c.Status)
                        && c.SoldDate != null
                        && c.SoldDate >= yearStart
                        && c.SoldDate < yearEnd)
            .Select(c => new
            {
                c.Id,
                c.Name,
                c.Status,
                NameParts = c.Parts.Select(p => new
                {
                    p.Type, p.Manufacturer, p.ModelNumber, p.Color
                }).ToList(),
                c.SoldDate,
                c.CustomerName,
                c.Price,
                c.Tax,
                PartsCost = (c.Parts.Sum(p => (decimal?)(p.Cost ?? 0)) ?? 0) + (c.BulkCost ?? 0),
                Collected = c.Payments.Sum(p => (decimal?)(p.Type == "refund" ? -p.Amount : p.Amount)) ?? 0,
                PaymentFees = c.Payments.Sum(p => (decimal?)(p.Fee ?? 0)) ?? 0
            })
            .ToListAsync();

        // Per-sale wages are all wages linked to that computer (any paid date),
        // matching the previous Include(c => c.Wages) behavior.
        var soldIds = sold.Select(c => c.Id).ToList();
        var computerWagesRows = await _db.Wages.AsNoTracking()
            .Where(w => w.ComputerId != null && soldIds.Contains(w.ComputerId.Value))
            .Select(w => new
            {
                ComputerId = w.ComputerId!.Value,
                w.Id,
                w.BuilderUserId,
                w.Amount,
                w.PaidDate,
                w.PaidMethod
            })
            .ToListAsync();

        var wagesLookup = computerWagesRows
            .GroupBy(w => w.ComputerId)
            .ToDictionary(
                g => g.Key,
                g => g.OrderBy(w => w.PaidDate).ThenBy(w => w.Id).ToList());

        var shareRows = await _db.ComputerShares.AsNoTracking()
            .Where(s => soldIds.Contains(s.ComputerId))
            .Select(s => new { s.ComputerId, s.BuilderUserId, s.Percentage })
            .ToListAsync();
        var sharesLookup = shareRows
            .GroupBy(s => s.ComputerId)
            .ToDictionary(g => g.Key, g => g.ToList());

        Dictionary<int, decimal> wagesByMonth;
        if (wagesBySaleDate)
        {
            // Attribute wages to the month the assigned computer was sold.
            // eBay sales stay out of every column except EbaySales.
            wagesByMonth = sold
                .Where(c => !ComputerStatus.IsEbaySold(c.Status))
                .GroupBy(c => c.SoldDate!.Value.Month)
                .ToDictionary(
                    g => g.Key,
                    g => g.Sum(c =>
                        wagesLookup.TryGetValue(c.Id, out var ws) ? ws.Sum(w => w.Amount) : 0m));
        }
        else
        {
            var wagesPaidInYear = await _db.Wages.AsNoTracking()
                .Where(w => w.PaidDate != null && w.PaidDate >= yearStart && w.PaidDate < yearEnd)
                .Select(w => new { w.Amount, Month = w.PaidDate!.Value.Month })
                .ToListAsync();

            wagesByMonth = wagesPaidInYear
                .GroupBy(w => w.Month)
                .ToDictionary(g => g.Key, g => g.Sum(w => w.Amount));
        }

        var soldByMonth = sold
            .GroupBy(c => c.SoldDate!.Value.Month)
            .ToDictionary(g => g.Key, g => g.ToList());

        var months = Enumerable.Range(1, 12).Select(month =>
        {
            if (!soldByMonth.TryGetValue(month, out var inMonth))
                inMonth = new();
            var wagesTotal = wagesByMonth.TryGetValue(month, out var wt) ? wt : 0m;

            decimal totalSales = 0;
            decimal ebaySales = 0;
            decimal exemptSales = 0;
            decimal totalBeforeTax = 0;
            decimal taxDue = 0;
            decimal partsCost = 0;
            decimal grossProfit = 0;
            var regularSoldCount = 0;

            var sales = inMonth.Select(c =>
            {
                // Prefer Price+Tax as a pair (tax was computed from Price). Fall
                // back to money collected when Price is unset. Always round to
                // cents so pretax + tax equals the gross with no float dust.
                var price = MoneyMath.Round2(
                    c.Price is decimal p && p != 0 ? p
                    : c.Collected != 0 ? c.Collected
                    : 0m);
                var tax = MoneyMath.Round2(c.Tax ?? 0);
                var cost = MoneyMath.Round2(c.PartsCost);
                var fees = MoneyMath.Round2(c.PaymentFees);
                var isEbay = ComputerStatus.IsEbaySold(c.Status);
                var isExempt = !isEbay && tax == 0m;

                // Snap tax to the inclusive 9.25% formula when it only differs by
                // a few cents — typical Σ of per-payment rounded taxes vs tax-of-total.
                // Larger gaps (manual / non-standard rates) are left alone.
                if (!isEbay && !isExempt && price != 0)
                {
                    var formulaTax = MoneyMath.TaxFromInclusiveAmount(price) ?? tax;
                    if (Math.Abs(formulaTax - tax) <= 0.05m)
                        tax = formulaTax;
                }

                var pretax = MoneyMath.Round2(price - tax);
                var saleProfit = MoneyMath.Round2(pretax - cost - fees);

                wagesLookup.TryGetValue(c.Id, out var ws);
                var computerWages = (ws ?? [])
                    .Select(w => new
                    {
                        w.Id,
                        w.BuilderUserId,
                        w.Amount,
                        w.PaidDate,
                        w.PaidMethod
                    })
                    .ToList();
                var computerWagesTotal = MoneyMath.Round2(computerWages.Sum(w => w.Amount));
                var wagesJosh = MoneyMath.Round2(
                    computerWages.Where(w => IsJosh(w.BuilderUserId)).Sum(w => w.Amount));

                sharesLookup.TryGetValue(c.Id, out var computerShares);
                var shares = computerShares ?? [];
                var joshShares = shares.Where(s => IsJosh(s.BuilderUserId)).ToList();
                decimal? joshSharePercentage = joshShares.Count > 0
                    ? joshShares.Sum(s => s.Percentage)
                    : null;

                var shareRecipientIds = shares
                    .Select(s => s.BuilderUserId)
                    .ToHashSet(StringComparer.OrdinalIgnoreCase);
                var nonShareWages = computerWages
                    .Where(w => !shareRecipientIds.Contains(w.BuilderUserId))
                    .Sum(w => w.Amount);
                var shareBase = saleProfit - nonShareWages;
                decimal? joshShareAmount = joshSharePercentage is decimal jp
                    ? MoneyMath.Round2(shareBase * (jp / 100m))
                    : null;

                // eBay remits sales tax. Those sales are tracked only in EbaySales
                // and must not change Total Sales, tax, parts, wages, or profit.
                if (isEbay)
                {
                    ebaySales += price;
                }
                else
                {
                    regularSoldCount++;
                    totalSales += price;
                    if (isExempt)
                        exemptSales += price;
                    else
                        totalBeforeTax += pretax;
                    taxDue += tax;
                    partsCost += cost;
                    grossProfit += saleProfit;
                }

                return new
                {
                    c.Id,
                    Name = ComputerDisplayName.From(c.Name, c.NameParts.Select(p =>
                        new ComputerDisplayName.PartBits(p.Type, p.Manufacturer, p.ModelNumber, p.Color))),
                    SoldDate = c.SoldDate,
                    c.CustomerName,
                    Price = price,
                    Tax = isEbay ? 0m : tax,
                    IsExempt = isExempt,
                    IsEbay = isEbay,
                    BeforeTax = pretax,
                    PartsCost = cost,
                    PaymentFees = fees,
                    WagesTotal = computerWagesTotal,
                    Wages = computerWages,
                    WagesJosh = wagesJosh,
                    JoshSharePercentage = joshSharePercentage,
                    JoshShareAmount = joshShareAmount,
                    Profit = saleProfit
                };
            })
            .OrderBy(s => s.SoldDate)
            .ThenBy(s => s.Name)
            .ToList();

            var wagesMonth = MoneyMath.Round2(wagesTotal);
            return new
            {
                Month = month,
                MonthName = System.Globalization.CultureInfo.CurrentCulture.DateTimeFormat.GetMonthName(month),
                SoldCount = regularSoldCount,
                TotalSales = MoneyMath.Round2(totalSales),
                EbaySales = MoneyMath.Round2(ebaySales),
                ExemptSales = MoneyMath.Round2(exemptSales),
                TotalBeforeTax = MoneyMath.Round2(totalBeforeTax),
                TaxDue = MoneyMath.Round2(taxDue),
                PartsCost = MoneyMath.Round2(partsCost),
                Wages = wagesMonth,
                Profit = MoneyMath.Round2(grossProfit - wagesMonth),
                Sales = sales
            };
        }).ToList();

        var yearTotals = new
        {
            SoldCount = months.Sum(m => m.SoldCount),
            TotalSales = MoneyMath.Round2(months.Sum(m => m.TotalSales)),
            EbaySales = MoneyMath.Round2(months.Sum(m => m.EbaySales)),
            ExemptSales = MoneyMath.Round2(months.Sum(m => m.ExemptSales)),
            TotalBeforeTax = MoneyMath.Round2(months.Sum(m => m.TotalBeforeTax)),
            TaxDue = MoneyMath.Round2(months.Sum(m => m.TaxDue)),
            PartsCost = MoneyMath.Round2(months.Sum(m => m.PartsCost)),
            Wages = MoneyMath.Round2(months.Sum(m => m.Wages)),
            Profit = MoneyMath.Round2(months.Sum(m => m.Profit))
        };

        return new
        {
            Year = selectedYear,
            WagesBySaleDate = wagesBySaleDate,
            AvailableYears = availableYears.Count > 0
                ? availableYears
                : new List<int> { selectedYear },
            Months = months,
            YearTotals = yearTotals
        };
    }

    private static bool IsJosh(string builderUserId) =>
        builderUserId.StartsWith("Josh B", StringComparison.OrdinalIgnoreCase);
}
